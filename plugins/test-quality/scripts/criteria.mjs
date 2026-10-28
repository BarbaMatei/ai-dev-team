import fs from 'node:fs';
import path from 'node:path';
import { toPosix } from './lib/project.mjs';

const unquote = (s) => s.trim().replace(/^["']|["']$/g, '').trim();

function fail(msg) {
  process.stderr.write(`criteria: ${msg}\n`);
  process.exit(2);
}

function readLines(file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) fail(`no such file ${file}`);
  return fs.readFileSync(file, 'utf8').split(/\r?\n/);
}

function boltStories(file, lines) {
  if (lines[0]?.trim() !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end < 0) return null;
  const fm = lines.slice(1, end);
  const scalar = (k) => {
    const m = fm.map((l) => new RegExp(`^${k}:\\s*(.+)$`).exec(l)).find(Boolean);
    return m ? unquote(m[1]) : null;
  };
  const at = fm.findIndex((l) => /^stories:/.test(l));
  const intent = scalar('intent');
  const unit = scalar('unit');
  if (at < 0 || !intent || !unit) return null;
  const rest = fm[at].slice('stories:'.length).trim();
  let items;
  if (rest.startsWith('[')) items = rest.replace(/^\[|\]$/g, '').split(',');
  else {
    items = [];
    for (const l of fm.slice(at + 1)) {
      const m = /^\s*-\s+(.*)$/.exec(l);
      if (!m) break;
      items.push(m[1]);
    }
  }
  const dir = toPosix(path.dirname(file));
  return items.map(unquote).filter(Boolean).map((s) => path.posix.normalize(`${dir}/../../intents/${intent}/units/${unit}/stories/${s}.md`));
}

function criteria(lines) {
  const out = [];
  let level = 0;
  lines.forEach((text, i) => {
    const h = /^(#{1,6})\s+(.*)$/.exec(text);
    if (h) {
      if (level && h[1].length <= level) level = 0;
      if (!level && /acceptance criteria/i.test(h[2])) level = h[1].length;
      return;
    }
    const item = level && /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(text);
    if (!item) return;
    const c = item[1].replace(/^\[[ xX]\]\s*/, '').replace(/\*\*/g, '').trim();
    if (c) out.push([i + 1, c]);
  });
  return out;
}

const inputs = process.argv.slice(2);
if (!inputs.length) fail('usage: criteria.mjs <file>...');
let total = 0;
let count = 0;
for (const input of inputs) {
  const lines = readLines(input);
  for (const f of boltStories(input, lines) ?? [input]) {
    count++;
    for (const [line, c] of criteria(f === input ? lines : readLines(f))) {
      process.stdout.write(`${toPosix(f)}:${line}\t${c}\n`);
      total++;
    }
  }
}
process.stdout.write(`${total} criteria in ${count} file(s)\n`);
