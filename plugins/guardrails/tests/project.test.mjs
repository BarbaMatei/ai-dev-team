import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { globToRegExp, loadConfig, matchesAny, toPosix } from '../scripts/lib/project.mjs';

test('globToRegExp handles ** across depth', () => {
  assert.ok(globToRegExp('docs/**').test('docs/a/b.md'));
  assert.ok(globToRegExp('**/x.ts').test('x.ts'));
  assert.ok(globToRegExp('**/x.ts').test('a/b/x.ts'));
});

test('globToRegExp keeps * within one segment', () => {
  assert.ok(!globToRegExp('src/*.cs').test('src/a/b.cs'));
  assert.ok(globToRegExp('src/*.cs').test('src/a.cs'));
});

test('globToRegExp handles spaces and ?', () => {
  assert.ok(globToRegExp('dir with space/*.ts').test('dir with space/b.ts'));
  assert.ok(globToRegExp('a?.ts').test('ab.ts'));
  assert.ok(!globToRegExp('a?.ts').test('a/.ts'));
});

test('matchesAny and toPosix', () => {
  assert.ok(matchesAny('docs/x.md', ['src/**', 'docs/**']));
  assert.ok(!matchesAny('src/x.md', ['docs/**']));
  assert.equal(toPosix('a\\b\\c'), 'a/b/c');
});

test('loadConfig returns {} when the file is missing', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gr-proj-'));
  try {
    assert.deepEqual(loadConfig(d), {});
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('loadConfig throws a prefixed error on invalid JSON', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gr-proj-'));
  try {
    fs.mkdirSync(path.join(d, '.claude'));
    fs.writeFileSync(path.join(d, '.claude', 'ai-dev-team.json'), '{ nope');
    assert.throws(() => loadConfig(d), (e) => e.message.startsWith('.claude/ai-dev-team.json:'));
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('globToRegExp expands braces, including nested and with **', () => {
  const g = globToRegExp('src/**/*.{ts,tsx}');
  assert.ok(g.test('src/a/b.ts'));
  assert.ok(g.test('src/b.tsx'));
  assert.ok(!g.test('src/b.js'));
  assert.ok(globToRegExp('a/{b,c/{d,e}}.x').test('a/c/e.x'));
  assert.ok(globToRegExp('a{b').test('a{b'));
});
