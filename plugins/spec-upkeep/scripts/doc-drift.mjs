#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { projectRoot, loadConfig, globToRegExp, matchesAny, toPosix } from './lib/project.mjs';
import { extractCitations, stripLine, EXT, NOLINE_CMDS } from './lib/citations.mjs';

const DEFAULT_FILES = ['CLAUDE.md', 'AGENTS.md', '.claude/rules/**/*.md', 'memory-bank/standards/**/*.md'];
const MAX_BYTES = 1024 * 1024;

function fail(msg) {
  process.stderr.write(`spec-upkeep: ${msg}\n`);
  process.exit(2);
}

function settings(root) {
  let dd;
  try {
    dd = loadConfig(root).docDrift ?? {};
    const strings = (v) => v === undefined || (Array.isArray(v) && v.every((s) => typeof s === 'string'));
    if (dd === null || typeof dd !== 'object' || Array.isArray(dd)) throw new Error('.claude/ai-dev-team.json: docDrift must be an object');
    for (const k of ['files', 'ignore']) {
      if (!strings(dd[k])) throw new Error(`.claude/ai-dev-team.json: docDrift.${k} must be an array of strings`);
    }
  } catch (e) {
    fail(e.message);
  }
  return { files: dd.files ?? DEFAULT_FILES, ignore: new Set(dd.ignore ?? []) };
}

function trackedFiles(root) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
  const r = spawnSync('git', ['ls-files', '-z'], { cwd: root, env, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) fail('git ls-files failed; run inside a git repository');
  return r.stdout.split('\0').filter(Boolean).map(toPosix).filter((f) => fs.existsSync(path.join(root, f)));
}

function makeIndex(root, tracked) {
  const byPart = new Map();
  const dirs = new Set();
  for (const f of tracked) {
    const parts = f.split('/');
    for (let j = 1; j < parts.length; j++) for (let i = 0; i < j; i++) dirs.add(parts.slice(i, j).join('/'));
    for (let i = 0; i < parts.length; i++) {
      const key = parts.slice(i).join('/');
      if (!byPart.has(key)) byPart.set(key, f);
    }
  }
  const lineCache = new Map();
  const lines = (rel) => {
    if (!lineCache.has(rel)) {
      const t = fs.readFileSync(path.join(root, rel), 'utf8');
      lineCache.set(rel, t === '' ? 0 : t.replace(/\r?\n$/, '').split(/\r?\n/).length);
    }
    return lineCache.get(rel);
  };
  const onDisk = (p, docDir) => [docDir, ''].map((d) => path.posix.join(d, p)).find((c) => fs.existsSync(path.join(root, c)));
  const globRes = new Map();
  const globHit = (g) => {
    if (!globRes.has(g)) {
      const re = globToRegExp(g);
      globRes.set(g, tracked.some((f) => re.test(f) || (!g.includes('/') && re.test(f.split('/').pop()))));
    }
    return globRes.get(g);
  };
  const tails = new Set(tracked.map((f) => f.split('/').pop()));
  const extHit = (p) => [...tails].some((b) => b.endsWith(p));
  return { byPart, dirs, lines, onDisk, globHit, extHit };
}

function words(root, tracked) {
  const set = new Set();
  for (const f of tracked) {
    if (/\.md$/i.test(f)) continue;
    const full = path.join(root, f);
    let st;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (!st.isFile() || st.size > MAX_BYTES) continue;
    const text = fs.readFileSync(full, 'utf8');
    if (text.includes('\0')) continue;
    for (const w of text.match(/[A-Za-z_]\w*/g) ?? []) set.add(w);
  }
  return set;
}

function main() {
  const i = process.argv.indexOf('--root');
  const root = i > 0 && process.argv[i + 1] ? path.resolve(process.argv[i + 1]) : projectRoot(process.cwd());
  const cfg = settings(root);
  const tracked = trackedFiles(root);
  const idx = makeIndex(root, tracked);
  let wordSet = null;
  let deps = null;
  const manifests = () => tracked.filter((f) => f.split('/').pop() === 'package.json').map((f) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
    } catch {
      return {};
    }
  });

  const pathProblem = (raw, docDir, { link = false } = {}) => {
    let p = link ? raw : stripLine(raw);
    p = p.replace(/^\.\//, '').replace(/\/$/, '');
    if (link) p = p.replace(/^\//, '');
    if (/[*?]/.test(p)) return idx.globHit(p) ? null : 'no match';
    const disk = idx.onDisk(p, docDir);
    const file = disk && fs.statSync(path.join(root, disk)).isFile() ? disk : idx.byPart.get(p);
    if (!disk && !file && !idx.dirs.has(p) && !(/^\.[^/]+$/.test(p) && idx.extHit(p))) {
      deps ??= new Set(manifests().flatMap((m) => [...Object.keys(m.dependencies ?? {}), ...Object.keys(m.devDependencies ?? {})]));
      return !p.includes('/') && EXT.test(p) && deps.has(p) ? null : 'no such file';
    }
    const n = link ? null : /:(\d+)(?:-\d+)?$/.exec(raw);
    if (n && file && idx.lines(file) < Number(n[1])) return `line ${n[1]} past end of ${file} (${idx.lines(file)} lines)`;
    return null;
  };

  const commandProblem = (text, docDir) => {
    const [cmd, sub, third, ...rest] = text.split(/\s+/);
    if (cmd === 'npm' && (sub === 'test' || sub === 'start' || (sub === 'run' && third))) {
      const script = sub === 'run' ? third : sub;
      if (!manifests().some((m) => m.scripts?.[script] !== undefined)) return `npm script ${script} not found`;
    }
    if (NOLINE_CMDS.has(cmd)) return null;
    for (const a of [sub, third, ...rest].filter(Boolean).map((t) => t.replace(/^["']|["']$/g, ''))) {
      if (/^(-|http|@)/.test(a) || !(a.includes('/') || EXT.test(a) || a.startsWith('.'))) continue;
      if (pathProblem(a, docDir)) return `no such file ${a}`;
    }
    return null;
  };

  const symbolProblem = (text) => {
    wordSet ??= words(root, tracked);
    const miss = text.replace(/\(\)$/, '').split('.').find((s) => s.length >= 3 && !wordSet.has(s));
    return miss ? `symbol ${miss} not in code` : null;
  };

  const docs = tracked.filter((f) => matchesAny(f, cfg.files));
  let total = 0;
  const bad = [];
  const badFiles = new Set();
  for (const doc of docs) {
    const docDir = path.posix.dirname(doc) === '.' ? '' : path.posix.dirname(doc);
    for (const c of extractCitations(fs.readFileSync(path.join(root, doc), 'utf8'))) {
      if (cfg.ignore.has(c.text)) continue;
      total++;
      let why = null;
      if (c.kind === 'path') why = pathProblem(c.text, docDir);
      else if (c.kind === 'command') why = commandProblem(c.text, docDir);
      else if (c.kind === 'symbol') why = symbolProblem(c.text);
      else {
        let t = c.text.replace(/[#?].*$/, '');
        try {
          t = decodeURIComponent(t);
        } catch {}
        why = t === '' ? null : pathProblem(t, docDir, { link: true });
      }
      if (why) {
        bad.push(`${doc}:${c.line}: ${c.kind} \`${c.text}\` — ${why}`);
        badFiles.add(doc);
      }
    }
  }
  if (bad.length) {
    process.stdout.write(`${bad.join('\n')}\ndoc-drift: ${bad.length} stale reference(s) in ${badFiles.size} file(s)\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`doc-drift: clean (${total} references in ${docs.length} files)\n`);
}

main();
