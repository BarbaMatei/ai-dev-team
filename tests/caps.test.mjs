import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.name === 'node_modules' || e.name === '.git') return [];
    return e.isDirectory() ? walk(p) : [p];
  });
}

function lineCount(file) {
  const text = fs.readFileSync(file, 'utf8');
  if (text === '') return 0;
  return text.replace(/\r?\n$/, '').split(/\r?\n/).length;
}

function check(label, files, cap) {
  test(`${label} stay within ${cap} lines`, () => {
    const over = files.map((f) => [path.relative(root, f), lineCount(f)]).filter(([, n]) => n > cap);
    assert.deepEqual(over, []);
  });
}

const plugins = fs.readdirSync(path.join(root, 'plugins'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(root, 'plugins', e.name));
const all = plugins.flatMap((p) => walk(p));

check('SKILL.md files', all.filter((f) => path.basename(f) === 'SKILL.md' && f.split(path.sep).includes('skills')), 100);
check('agent files', all.filter((f) => f.endsWith('.md') && path.basename(path.dirname(f)) === 'agents'), 100);
check('scripts', all.filter((f) => f.endsWith('.mjs') && f.split(path.sep).includes('scripts')), 200);
check('README files', [root, ...plugins].map((d) => path.join(d, 'README.md')).filter((f) => fs.existsSync(f)), 60);
