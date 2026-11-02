import fs from 'node:fs';
import path from 'node:path';
import { AnswersError } from './lib/answers.mjs';
import { readBlocks, replaceBlock } from './lib/blocks.mjs';
import { createFile, hookLine } from './lib/files.mjs';
import { renderFiles } from './render.mjs';

const fail = (msg) => {
  console.error(msg);
  process.exit(2);
};
const args = process.argv.slice(2);
const write = args.includes('--write');
const unknown = args.find((a) => a !== '--write');
if (unknown) fail(`check: unknown option ${unknown}`);

const root = process.cwd();
const abs = (rel) => path.join(root, ...rel.split('/'));
const stampPath = abs('.claude/ai-dev-team.json');
const noStamp = 'check: no setup stamp; run setup:new';
if (!fs.existsSync(stampPath)) fail(noStamp);
const stampText = fs.readFileSync(stampPath, 'utf8');
let cfg;
try {
  cfg = JSON.parse(stampText);
} catch {
  fail('check: .claude/ai-dev-team.json is not valid JSON');
}
if (cfg === null || typeof cfg.setup !== 'object' || cfg.setup === null) fail(noStamp);

let rendered;
try {
  rendered = renderFiles(cfg.setup);
} catch (e) {
  if (!(e instanceof AnswersError)) throw e;
  fail(`check: setup stamp invalid: ${e.message}`);
}

const lines = [];
const missing = [];
const outdated = [];
for (const f of rendered) {
  if (!fs.existsSync(abs(f.path))) {
    missing.push(f);
    continue;
  }
  const want = readBlocks(f.content);
  if (want.size === 0) continue;
  const have = readBlocks(fs.readFileSync(abs(f.path), 'utf8'));
  for (const [id, body] of want) {
    if (!have.has(id)) lines.push(`block ${f.path} ${id} absent`);
    else if (have.get(id) !== body) {
      lines.push(`block ${f.path} ${id} outdated`);
      outdated.push({ path: f.path, id, body });
    }
  }
}
const current = JSON.parse(rendered.find((f) => f.path === '.claude/ai-dev-team.json').content).setup.version;
const stamp = cfg.setup.version !== current;
const out = [...missing.map((f) => `missing ${f.path}`), ...lines, ...(stamp ? [`stamp ${cfg.setup.version} -> ${current}`] : [])];

if (write) {
  for (const f of missing) createFile(root, f.path, f.content);
  for (const o of outdated) fs.writeFileSync(abs(o.path), replaceBlock(fs.readFileSync(abs(o.path), 'utf8'), o.id, o.body));
  if (stamp) {
    cfg.setup.version = current;
    const eol = stampText.includes('\r\n') ? '\r\n' : '\n';
    fs.writeFileSync(stampPath, JSON.stringify(cfg, null, 2).replace(/\n/g, eol) + eol);
  }
}
console.log(out.length ? out.join('\n') : 'up to date');
if (write) {
  const line = hookLine(root, missing.map((f) => f.path));
  if (line) console.log(line);
}
