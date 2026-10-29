import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, loadAreas, matchesAny, projectRoot, toPosix } from './lib/project.mjs';

const USAGE = 'usage: areas.mjs touched [--base <ref>] | files <area> | of <file>... | nearby --pattern <regex> [--max <n>] [--base <ref>]';
const MAX_LINES = 30;
const MAX_BYTES = 1024 * 1024;

function fail(msg) {
  process.stderr.write(`review: ${msg}\n`);
  process.exit(2);
}

function git(cwd, args) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
  return spawnSync('git', args, { cwd, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

function list(root, args) {
  const r = git(root, args);
  if (r.status !== 0) fail(`git ${args.join(' ')}: ${(r.stderr || '').split('\n')[0]}`);
  return r.stdout.split('\0').filter(Boolean).map(toPosix);
}

function findBase(root, explicit) {
  if (explicit) {
    if (git(root, ['rev-parse', '--verify', '--quiet', `${explicit}^{commit}`]).status !== 0) fail(`unknown base ${explicit}`);
    return explicit;
  }
  for (const ref of ['origin/HEAD', 'main']) {
    const r = git(root, ['merge-base', 'HEAD', ref]);
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  }
  return fail('cannot find a base; pass --base <ref>');
}

function changedFiles(root, base) {
  const sets = [
    ['diff', '--name-only', '-z', `${base}...HEAD`],
    ['diff', '--name-only', '-z', '--cached'],
    ['diff', '--name-only', '-z'],
    ['ls-files', '-z', '--others', '--exclude-standard'],
  ];
  return [...new Set(sets.flatMap((a) => list(root, a)))];
}

const tracked = (root) => list(root, ['ls-files', '-z']);
const inArea = (area, files) => files.filter((f) => matchesAny(f, area.globs));

function flag(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function touched(root, areas, cfg, args) {
  const changed = changedFiles(root, findBase(root, flag(args, '--base')));
  const hits = areas.map((a) => [a, inArea(a, changed).length]).filter(([, n]) => n > 0);
  for (const [a, n] of hits) process.stdout.write(`${a.name}\t${n} file(s)\t${a.ruleFile ?? '-'}\n`);
  const trig = hits.map(([a]) => a.name).filter((n) => (cfg.triggers ?? []).includes(n));
  process.stdout.write(trig.length ? `trigger: yes (${trig.join(', ')})\n` : 'trigger: no\n');
}

function listFiles(root, areas, name) {
  const area = areas.find((a) => a.name === name);
  if (!area) fail(`unknown area '${name}'; known: ${areas.map((a) => a.name).join(', ')}`);
  for (const f of inArea(area, tracked(root))) process.stdout.write(`${f}\n`);
}

function of(areas, fileArgs) {
  for (const f of fileArgs) {
    const names = areas.filter((a) => matchesAny(toPosix(f), a.globs)).map((a) => a.name);
    process.stdout.write(`${f}	${names.length ? names.join(',') : '-'}
`);
  }
}

function nearby(root, areas, args) {
  const pattern = flag(args, '--pattern');
  if (pattern === undefined) fail('nearby needs --pattern <regex>');
  let re;
  try {
    re = new RegExp(pattern);
  } catch (e) {
    fail(`invalid --pattern: ${e.message}`);
  }
  const maxArg = args.includes('--max') ? flag(args, '--max') : undefined;
  if (args.includes('--max') && !/^[1-9]\d*$/.test(maxArg ?? '')) fail(USAGE);
  const changed = changedFiles(root, findBase(root, flag(args, '--base')));
  const all = tracked(root);
  const hit = areas.filter((a) => inArea(a, changed).length > 0);
  const near = new Set([...changed, ...hit.flatMap((a) => inArea(a, all))]);
  const candidates = [...new Set([...all, ...list(root, ['ls-files', '-z', '--others', '--exclude-standard'])])];
  const groups = { near: [], other: [] };
  for (const f of candidates) {
    let buf;
    try {
      const abs = path.join(root, ...f.split('/'));
      if (fs.statSync(abs).size > MAX_BYTES) continue;
      buf = fs.readFileSync(abs);
    } catch {
      continue;
    }
    if (buf.subarray(0, 8192).includes(0)) continue;
    buf.toString('utf8').split(/\r?\n/).forEach((text, i) => {
      if (re.test(text)) groups[near.has(f) ? 'near' : 'other'].push(`${f}:${i + 1}: ${text.trim()}`);
    });
  }
  const total = groups.near.length + groups.other.length;
  const max = maxArg === undefined ? undefined : Number(maxArg);
  if (max !== undefined && total > max) {
    process.stderr.write(`review: pattern matched ${total} sites (max ${max}); narrow it\n`);
    process.exit(3);
  }
  for (const [key, title] of [['near', 'in bolt area'], ['other', 'elsewhere']]) {
    process.stdout.write(`${title} (${groups[key].length}):\n`);
    for (const l of groups[key].slice(0, MAX_LINES)) process.stdout.write(`${l}\n`);
  }
}

const [cmd, ...args] = process.argv.slice(2);
if (!['touched', 'files', 'of', 'nearby'].includes(cmd) || ((cmd === 'files' || cmd === 'of') && !args[0])) fail(USAGE);
const root = projectRoot(process.cwd());
let cfg;
let areas;
try {
  cfg = loadConfig(root);
  areas = loadAreas(root, cfg, (m) => process.stderr.write(`review: ${m}\n`));
} catch (e) {
  fail(e.message);
}
if (cmd === 'touched') touched(root, areas, cfg, args);
else if (cmd === 'files') listFiles(root, areas, args[0]);
else if (cmd === 'of') of(areas, args);
else nearby(root, areas, args);
