import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'pre-commit.mjs');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'gr-pc-'));
let n = 0;
const sk = ['sk', 'live', 'a'.repeat(24)].join('_');

after(() => fs.rmSync(base, { recursive: true, force: true }));

function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_') || k === 'COMMENTS_OK') delete env[k];
  return { ...env, ...extra };
}

function git(cwd, args) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, env: cleanEnv(), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

function repo(config) {
  const dir = path.join(base, `r${n++}`);
  fs.mkdirSync(dir);
  git(dir, ['init', '-q', '-b', 'main']);
  if (config !== undefined) {
    fs.mkdirSync(path.join(dir, '.claude'));
    fs.writeFileSync(path.join(dir, '.claude', 'ai-dev-team.json'), typeof config === 'string' ? config : JSON.stringify(config));
  }
  return dir;
}

function put(dir, rel, content) {
  const f = path.join(dir, ...rel.split('/'));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
  git(dir, ['add', '--', rel]);
}

function run(dir, env = {}) {
  const r = spawnSync(process.execPath, [script], { cwd: dir, env: cleanEnv(env), encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr, err: r.stderr };
}

test('1 secret blocks and never prints the value', () => {
  const d = repo();
  put(d, 'a.cs', `var k = "${sk}";\n`);
  const r = run(d);
  assert.equal(r.code, 1);
  assert.match(r.out, /\[blocked\] potential secret: a\.cs:1/);
  assert.ok(!r.out.includes(sk));
  assert.match(r.out, /Commit blocked \(secret guard\)\. Move the secret out of the repository\./);
});

test('2 COMMENTS_OK does not override the secret check', () => {
  const d = repo();
  put(d, 'a.cs', `var k = "${sk}";\n`);
  assert.equal(run(d, { COMMENTS_OK: '1' }).code, 1);
});

test('3 comment gate blocks, COMMENTS_OK passes', () => {
  const d = repo();
  put(d, 'a.cs', 'int x; // narration\n');
  const r = run(d);
  assert.equal(r.code, 1);
  assert.match(r.out, /COMMENT GATE/);
  assert.ok(r.out.includes('a.cs:1: int x; // narration'));
  assert.match(r.out, /never --no-verify\)\./);
  assert.equal(run(d, { COMMENTS_OK: '1' }).code, 0);
});

test('4 allowPaths skips the secret check', () => {
  const d = repo({ secrets: { allowPaths: ['docs/**'] } });
  put(d, 'docs/x.md', `${sk}\n`);
  assert.equal(run(d).code, 0);
});

test('5 config secret patterns and hint', () => {
  const d = repo({ secrets: { patterns: ['pk_live_[0-9A-Za-z]{16,}'], hint: 'Use the vault.' } });
  put(d, 'a.txt', ['pk', 'live', 'b'.repeat(20)].join('_') + '\n');
  const r = run(d);
  assert.equal(r.code, 1);
  assert.match(r.out, /Use the vault\./);
});

test('6 deletions and binary files pass', () => {
  const d = repo();
  put(d, 'old.cs', 'int y;\n');
  git(d, ['commit', '-q', '-m', 'base']);
  git(d, ['rm', '-q', 'old.cs']);
  put(d, 'b.bin', Buffer.from([0x00, 0xff]));
  assert.equal(run(d).code, 0);
});

test('7 paths with spaces are listed', () => {
  const d = repo();
  put(d, 'dir with space/b.ts', '// note\n');
  const r = run(d);
  assert.equal(r.code, 1);
  assert.ok(r.out.includes('dir with space/b.ts:1'));
});

test('8 CRLF files report the right line', () => {
  const d = repo();
  put(d, 'a.txt', `one\r\nkey ${sk}\r\n`);
  const r = run(d);
  assert.equal(r.code, 1);
  assert.match(r.out, /a\.txt:2/);
});

test('9 invalid config exits 2 with one line', () => {
  const d = repo('{ nope');
  put(d, 'a.cs', 'int x;\n');
  const r = run(d);
  assert.equal(r.code, 2);
  assert.match(r.err, /^guardrails: \.claude\/ai-dev-team\.json: /);
  assert.equal(r.err.trim().split('\n').length, 1);
});

test('10 comment extensions are respected and configurable', () => {
  const d = repo();
  put(d, 'a.md', '// note\n');
  assert.equal(run(d).code, 0);
  const d2 = repo({ comments: { extensions: ['.md'] } });
  put(d2, 'a.md', '// note\n');
  assert.equal(run(d2).code, 1);
});

test('only added lines are checked, with new-file numbers', () => {
  const d = repo();
  put(d, 'a.cs', 'int a;\nint b;\n');
  git(d, ['commit', '-q', '-m', 'base']);
  put(d, 'a.cs', 'int a;\nint b;\nint c; // late\n');
  const r = run(d);
  assert.equal(r.code, 1);
  assert.ok(r.out.includes('a.cs:3: int c; // late'));
});
