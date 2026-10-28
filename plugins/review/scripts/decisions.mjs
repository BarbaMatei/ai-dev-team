import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, projectRoot, toPosix } from './lib/project.mjs';

const STOP = new Set(['about', 'after', 'because', 'before', 'being', 'could', 'every', 'other', 'should', 'their', 'there', 'these', 'those', 'which', 'while', 'would', 'where', 'using', 'since', 'still']);

export function splitEntries(md) {
  const rows = md.split(/\r?\n/);
  const head = rows.map((l) => /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l));
  const counts = {};
  for (const h of head) if (h) counts[h[1].length] = (counts[h[1].length] ?? 0) + 1;
  const level = Object.keys(counts).map(Number).sort((a, b) => counts[b] - counts[a] || a - b)[0];
  if (!level) return rows.filter((l) => l.trim()).map((l) => ({ heading: l.trim(), body: l.trim() }));
  const entries = [];
  let cur = null;
  rows.forEach((l, i) => {
    const h = head[i];
    if (h && h[1].length <= level) {
      cur = h[1].length === level ? { heading: h[2], body: '' } : null;
      if (cur) entries.push(cur);
    } else if (cur) cur.body += `${l}\n`;
  });
  return entries;
}

const words = (s) => new Set((s.toLowerCase().match(/[a-z]{5,}/g) ?? []).filter((w) => !STOP.has(w)));

export function scoreEntry(entry, file, text) {
  const hay = `${entry.heading}\n${entry.body}`;
  const stem = path.posix.basename(toPosix(file)).replace(/\.[^.]*$/, '');
  let score = stem.length >= 4 && hay.toLowerCase().includes(stem.toLowerCase()) ? 3 : 0;
  const have = words(hay);
  for (const w of words(text)) if (have.has(w)) score++;
  return score;
}

function main() {
  const args = process.argv.slice(2);
  const val = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
  const fail = (msg) => {
    process.stderr.write(`review: ${msg}\n`);
    process.exit(2);
  };
  const root = projectRoot(process.cwd());
  let cfg;
  try {
    cfg = loadConfig(root);
  } catch (e) {
    fail(e.message);
  }
  if (cfg.decisions === undefined) return process.stdout.write('no decisions file configured\n');
  if (typeof cfg.decisions !== 'string') fail('.claude/ai-dev-team.json: decisions must be a string');
  const file = path.resolve(root, cfg.decisions);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) fail(`decisions file not found: ${cfg.decisions}`);
  const [p, t] = [val('--path') ?? '', val('--text') ?? ''];
  const found = splitEntries(fs.readFileSync(file, 'utf8'))
    .map((e) => [e, scoreEntry(e, p, t)])
    .filter(([, s]) => s >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  if (!found.length) return process.stdout.write('no matching decision\n');
  for (const [e] of found) {
    const link = /\]\(([^)\s]+)/.exec(`${e.heading}\n${e.body}`);
    process.stdout.write(`decision: ${e.heading}${link ? ` (${link[1]})` : ''}\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
