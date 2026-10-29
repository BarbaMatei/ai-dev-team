import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadAreas, loadConfig, matchesAny, projectRoot, toPosix } from './lib/project.mjs';

const USAGE = 'usage: context.mjs brief <topic> [--area <name>] [--gh <cmd>] | check <proposals.md> [--gh <cmd>]';
const SPEC_CAP = 30;
const CODE_CAP = 20;
const ISSUE_CAP = 30;
const AREA_CAP = 50;

function fail(msg) {
  process.stderr.write(`architect: ${msg}\n`);
  process.exit(2);
}

function spawn(cmd, args, cwd) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
  return spawnSync(cmd, args, { cwd, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

const git = (root, args) => spawn('git', ['-c', 'core.quotepath=false', ...args], root);

function tracked(root) {
  const r = git(root, ['ls-files', '-z']);
  if (r.status !== 0) fail(`git ls-files failed: ${(r.stderr || '').split('\n')[0]}`);
  return r.stdout.split('\0').filter(Boolean).map(toPosix);
}

const lineCount = (text) => (text === '' ? 0 : text.replace(/\r?\n$/, '').split(/\r?\n/).length);
const readText = (root, rel) => fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8');

function flag(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function ghJson(gh, root, args) {
  const [exe, ...pre] = [...gh.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
  const r = spawn(exe, [...pre, ...args], root);
  if (r.status !== 0) return null;
  try {
    return JSON.parse(r.stdout);
  } catch {
    return null;
  }
}

function settings(cfg) {
  const a = cfg.architect ?? {};
  if (a === null || typeof a !== 'object' || Array.isArray(a)) fail('.claude/ai-dev-team.json: architect must be an object');
  if (a.specs !== undefined && !(Array.isArray(a.specs) && a.specs.every((s) => typeof s === 'string'))) {
    fail('.claude/ai-dev-team.json: architect.specs must be an array of strings');
  }
  if (a.label !== undefined && typeof a.label !== 'string') fail('.claude/ai-dev-team.json: architect.label must be a string');
  return { specs: a.specs ?? ['memory-bank/intents/*/requirements.md'], label: a.label ?? 'proposal' };
}

function areaSection(root, area, files) {
  const rows = files.filter((f) => matchesAny(f, area.globs)).map((f) => [f, lineCount(readText(root, f))]);
  const total = rows.reduce((s, [, n]) => s + n, 0);
  const out = rows.slice(0, AREA_CAP).map(([f, n]) => `${f} ${n}`);
  if (rows.length > AREA_CAP) out.push(`(+${rows.length - AREA_CAP} more)`);
  out.push(`total: ${rows.length} files, ${total} lines`);
  return out;
}

function specsSection(root, files, globs, topic) {
  const needle = topic.toLowerCase();
  const out = [];
  for (const f of files.filter((x) => matchesAny(x, globs))) {
    const text = readText(root, f);
    if (!text.toLowerCase().includes(needle)) continue;
    const status = /^status:\s*(\S+)/m.exec(text)?.[1] ?? '-';
    const heading = /^# (.*\S)\s*$/m.exec(text)?.[1] ?? path.posix.basename(f);
    out.push(`${f} [${status}] ${heading}`);
  }
  return out.length > SPEC_CAP ? [...out.slice(0, SPEC_CAP), `(+${out.length - SPEC_CAP} more)`] : out;
}

function codeSection(root, topic) {
  const r = git(root, ['grep', '-c', '-i', '-I', '-F', '-e', topic, '--', '.', ':!*.md']);
  const rows = r.status === 0 ? r.stdout.split(/\r?\n/).filter(Boolean).map((l) => [l.slice(0, l.lastIndexOf(':')), Number(l.slice(l.lastIndexOf(':') + 1))]) : [];
  rows.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return rows.slice(0, CODE_CAP).map(([f, n]) => `${f} ${n}`);
}

function issueLines(gh, root, filter) {
  const list = ghJson(gh, root, ['issue', 'list', '--state', 'open', ...filter, '--limit', String(ISSUE_CAP), '--json', 'number,title,labels']);
  if (!Array.isArray(list)) return ['(gh unavailable)'];
  return list.slice(0, ISSUE_CAP).map((i) => `#${i.number} ${i.title} [${(i.labels ?? []).map((l) => l.name ?? l).join(', ')}]`);
}

function brief(root, cfg, args) {
  const topic = args[0];
  if (!topic || topic.startsWith('--')) fail(USAGE);
  const gh = flag(args, '--gh') ?? 'gh';
  const { specs, label } = settings(cfg);
  const files = tracked(root);
  const sections = [];
  const areaName = flag(args, '--area');
  if (areaName !== undefined) {
    const areas = loadAreas(root, cfg, (m) => process.stderr.write(`architect: ${m}\n`));
    const area = areas.find((a) => a.name === areaName);
    if (!area) fail(`unknown area '${areaName}'; known: ${areas.map((a) => a.name).join(', ')}`);
    sections.push(['Area files', areaSection(root, area, files)]);
  }
  sections.push(['Specs', specsSection(root, files, specs, topic)]);
  sections.push(['Code', codeSection(root, topic)]);
  sections.push(['Open issues', issueLines(gh, root, ['--search', topic])]);
  sections.push(['Open proposals', issueLines(gh, root, ['--label', label])]);
  for (const [title, lines] of sections) process.stdout.write(`## ${title}\n${lines.length ? lines.join('\n') : '(none)'}\n\n`);
}

const CITE = /^(.+?)(?::(\d+)(?:-(\d+))?)?$/;
const pathLike = (p) => !/[<>*]/.test(p) && (p.includes('/') || /\.[A-Za-z0-9]+$/.test(p));

function judgeCite(root, set, token) {
  const m = CITE.exec(token);
  const p = m[1].replace(/^\.\//, '');
  if (!pathLike(p)) return null;
  const cite = { text: token, path: p, isCode: !/\.(md|markdown)$/i.test(p) };
  if (!set.has(p)) return { ...cite, bad: 'not a tracked file' };
  const top = Math.max(Number(m[2] ?? 0), Number(m[3] ?? 0));
  if (m[2] !== undefined && (Number(m[2]) < 1 || Number(m[3] ?? m[2]) < Number(m[2]))) return { ...cite, bad: 'invalid line range' };
  const n = top ? lineCount(readText(root, p)) : 0;
  return top > n ? { ...cite, bad: `file has ${n} lines` } : cite;
}

function checkFile(root, args) {
  const file = args[0];
  if (!file || file.startsWith('--')) fail(USAGE);
  if (!fs.existsSync(file)) fail(`no such file: ${file}`);
  const gh = flag(args, '--gh') ?? 'gh';
  const set = new Set(tracked(root));
  const blocks = fs.readFileSync(file, 'utf8').split(/^## /m).slice(1);
  const problems = [];
  const notes = [];
  let ok = 0;
  let ghUp;
  for (const block of blocks) {
    const title = block.split(/\r?\n/, 1)[0].trim();
    const tokens = [...new Set([...block.matchAll(/`([^`\s]+)`/g)].map((m) => m[1]))];
    const cites = tokens.map((t) => judgeCite(root, set, t)).filter(Boolean);
    for (const c of cites) {
      if (c.bad) problems.push(`bad ${c.text} — ${c.bad}`);
      else ok++;
    }
    if (!cites.some((c) => c.isCode && !c.bad)) problems.push(`no-code-cite ${title}`);
    for (const num of new Set([...block.matchAll(/#(\d+)/g)].map((m) => m[1]))) {
      ghUp ??= ghJson(gh, root, ['issue', 'list', '--limit', '1', '--json', 'number']) !== null;
      if (!ghUp) notes.push(`unchecked #${num}`);
      else if (ghJson(gh, root, ['issue', 'view', num, '--json', 'number']) === null) problems.push(`bad #${num} — no such issue`);
      else ok++;
    }
  }
  const out = [...notes, ...problems];
  if (!problems.length) out.push(`cites: ok (${ok})`);
  process.stdout.write(`${out.join('\n')}\n`);
  process.exit(problems.length ? 1 : 0);
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd !== 'brief' && cmd !== 'check') fail(USAGE);
const root = projectRoot(process.cwd());
let cfg;
try {
  cfg = loadConfig(root);
  if (cmd === 'brief') brief(root, cfg, args);
  else checkFile(root, args);
} catch (e) {
  fail(e.message);
}
