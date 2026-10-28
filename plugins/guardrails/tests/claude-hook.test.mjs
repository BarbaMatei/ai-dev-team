import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'claude-hook.mjs');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'gr-ch-'));
let n = 0;
const sk = ['sk', 'live', 'a'.repeat(24)].join('_');

after(() => fs.rmSync(base, { recursive: true, force: true }));

function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
  return env;
}

function repo(config) {
  const dir = path.join(base, `dir with space ${n++}`);
  fs.mkdirSync(dir);
  const r = spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, env: cleanEnv(), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  if (config !== undefined) {
    fs.mkdirSync(path.join(dir, '.claude'));
    fs.writeFileSync(path.join(dir, '.claude', 'ai-dev-team.json'), typeof config === 'string' ? config : JSON.stringify(config));
  }
  return dir;
}

function run(mode, stdin) {
  const input = typeof stdin === 'string' ? stdin : JSON.stringify(stdin);
  const r = spawnSync(process.execPath, [script, mode], { input, env: cleanEnv(), encoding: 'utf8' });
  return { code: r.status, err: r.stderr };
}

function call(dir, mode, tool_name, tool_input) {
  const event = mode === 'secrets' ? 'PreToolUse' : 'PostToolUse';
  return run(mode, { cwd: dir, hook_event_name: event, tool_name, tool_input });
}

test('1 Write with a secret blocks with file:line and no value', () => {
  const d = repo();
  const r = call(d, 'secrets', 'Write', { file_path: path.join(d, 'a.cs'), content: `x\n${sk}\n` });
  assert.equal(r.code, 2);
  assert.match(r.err, /a\.cs:2/);
  assert.ok(!r.err.includes(sk));
});

test('2 Edit new_string with a secret blocks', () => {
  const d = repo();
  const r = call(d, 'secrets', 'Edit', { file_path: path.join(d, 'a.cs'), old_string: 'x', new_string: sk });
  assert.equal(r.code, 2);
});

test('3 MultiEdit with a secret blocks', () => {
  const d = repo();
  const r = call(d, 'secrets', 'MultiEdit', { file_path: path.join(d, 'a.cs'), edits: [{ old_string: 'x', new_string: sk }] });
  assert.equal(r.code, 2);
});

test('4 allowPaths skips the secret check', () => {
  const d = repo({ secrets: { allowPaths: ['docs/**'] } });
  const r = call(d, 'secrets', 'Write', { file_path: path.join(d, 'docs', 'a.md'), content: sk });
  assert.equal(r.code, 0);
});

test('5 comments: added comment line is reported', () => {
  const d = repo();
  const r = call(d, 'comments', 'Edit', { file_path: path.join(d, 'a.ts'), old_string: 'let a;', new_string: 'let a;\n// why' });
  assert.equal(r.code, 2);
  assert.match(r.err, /\/\/ why/);
});

test('6 comments: a comment already in old_string is not reported', () => {
  const d = repo();
  const r = call(d, 'comments', 'Edit', { file_path: path.join(d, 'a.ts'), old_string: '  // why\nlet a;', new_string: '// why\nlet b;' });
  assert.equal(r.code, 0);
});

test('7 comments: non-code extension is ignored', () => {
  const d = repo();
  const r = call(d, 'comments', 'Write', { file_path: path.join(d, 'a.md'), content: '// why\n' });
  assert.equal(r.code, 0);
});

test('8 malformed stdin and unknown tool exit 0; invalid config still blocks a secret', () => {
  const d = repo();
  assert.equal(run('secrets', 'not json').code, 0);
  assert.equal(call(d, 'secrets', 'Bash', { command: sk }).code, 0);
  const bad = repo('{ nope');
  assert.equal(call(bad, 'secrets', 'Write', { file_path: path.join(bad, 'a.cs'), content: sk }).code, 2);
});

test('9 comments: MultiEdit and Write count added lines', () => {
  const d = repo();
  const f = path.join(d, 'a.cs');
  assert.equal(call(d, 'comments', 'MultiEdit', { file_path: f, edits: [{ old_string: 'a', new_string: '// n' }] }).code, 2);
  assert.equal(call(d, 'comments', 'Write', { file_path: f, content: 'int x;\n// n\n' }).code, 2);
});
