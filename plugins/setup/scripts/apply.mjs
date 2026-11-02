import fs from 'node:fs';
import path from 'node:path';
import { createFile, hookLine, lf } from './lib/files.mjs';

const usage = (msg) => {
  console.error(`apply: ${msg}`);
  process.exit(2);
};

function walk(dir, rel = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? walk(path.join(dir, e.name), r) : [r];
  });
}

const args = process.argv.slice(2);
const write = args.includes('--write');
const rest = args.filter((a) => a !== '--write');
const unknown = rest.find((a) => a.startsWith('--'));
if (unknown) usage(`unknown option ${unknown}`);
if (rest.length !== 1) usage('usage: node apply.mjs <staging-folder> [--write]');
const stage = rest[0];
if (!fs.existsSync(stage) || !fs.statSync(stage).isDirectory()) usage(`${stage} is not a folder`);

const root = process.cwd();
const created = [];
for (const rel of walk(stage).sort()) {
  const content = fs.readFileSync(path.join(stage, ...rel.split('/')), 'utf8');
  const target = path.join(root, ...rel.split('/'));
  let state = 'create';
  if (fs.existsSync(target)) state = lf(fs.readFileSync(target, 'utf8')) === lf(content) ? 'same' : 'differs';
  if (state === 'create') {
    created.push(rel);
    if (write) createFile(root, rel, content);
  }
  console.log(`${state} ${rel}`);
}
if (write) {
  const line = hookLine(root, created);
  if (line) console.log(line);
}
