import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseOutput, acquireLock } from '../scripts/scoped-test.mjs';

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'scoped-test.mjs');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'gr-st-'));
let n = 0;

after(() => fs.rmSync(base, { recursive: true, force: true }));

const dotnet = [
  'Failed!  - Failed:     2, Passed:     3, Skipped:     0, Total:     5, Duration: 1 s - App.Tests.dll (net8.0)',
  '  Failed App.Tests.A.B [12 ms]',
  '  Failed App.Tests.A.C [3 ms]',
].join('\n');

test('parseOutput reads a dotnet summary and failing names', () => {
  assert.deepEqual(parseOutput(dotnet, 'dotnet'), { total: 5, passed: 3, failed: 2, failures: ['App.Tests.A.B', 'App.Tests.A.C'] });
});

test('parseOutput reads vitest output with ANSI codes and CRLF', () => {
  const text = ['\x1b[41m\x1b[1m FAIL \x1b[22m\x1b[49m src/app/x.spec.ts > X > adds', '      \x1b[2mTests\x1b[22m  \x1b[31m1 failed\x1b[39m | \x1b[32m4 passed\x1b[39m (5)'].join('\r\n');
  const r = parseOutput(text, 'vitest');
  assert.equal(r.total, 5);
  assert.equal(r.failed, 1);
  assert.equal(r.passed, 4);
  assert.deepEqual(r.failures, ['src/app/x.spec.ts > X > adds']);
});

test('parseOutput returns null for unknown format or no summary', () => {
  assert.equal(parseOutput(dotnet, 'other'), null);
  assert.equal(parseOutput('nothing here', 'dotnet'), null);
});

function project(config, raw) {
  const dir = path.join(base, `p${n++}`);
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'ai-dev-team.json'), raw ?? JSON.stringify(config));
  return dir;
}

function run(dir, args) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
  return spawnSync(process.execPath, [script, ...args], { cwd: dir, env, encoding: 'utf8' });
}

const echo = (s, code = 0) => `node -e "console.log('${s}'); process.exit(${code})"`;

test('CLI prints PASS p/t and exits 0', () => {
  const dir = project({ tests: { unit: { command: echo('Passed!  - Failed: 0, Passed: 3, Skipped: 0, Total: 3'), format: 'dotnet' } } });
  const r = run(dir, ['unit', 'x']);
  assert.equal(r.stdout.trim(), 'PASS 3/3');
  assert.equal(r.status, 0);
});

test('CLI reports NO TESTS RAN with exit 1', () => {
  const dir = project({ tests: { unit: { command: echo('Passed!  - Failed: 0, Passed: 0, Skipped: 0, Total: 0'), format: 'dotnet' } } });
  const r = run(dir, ['unit', 'x']);
  assert.match(r.stdout, /NO TESTS RAN/);
  assert.equal(r.status, 1);
});

test('CLI prints FAIL f/t with failing names and the child exit code', () => {
  const command = `node -e "console.log('Failed!  - Failed: 1, Passed: 2, Skipped: 0, Total: 3'); console.log('  Failed App.Tests.A.B [1 ms]'); process.exit(1)"`;
  const r = run(project({ tests: { unit: { command, format: 'dotnet' } } }), ['unit', 'x']);
  assert.match(r.stdout, /^FAIL 1\/3\n {2}✗ App\.Tests\.A\.B/);
  assert.equal(r.status, 1);
});

test('CLI substitutes {filter} verbatim', () => {
  const dir = project({ tests: { unit: { command: `node -e "console.log('Passed! Failed: 0, Passed: {filter}, Skipped: 0, Total: {filter}')"`, format: 'dotnet' } } });
  assert.equal(run(dir, ['unit', '7']).stdout.trim(), 'PASS 7/7');
});

test('CLI runs in cwd relative to the project root', () => {
  const dir = project({ tests: { unit: { command: `node -e "console.log(require('path').basename(process.cwd()))"`, cwd: 'sub' } } });
  fs.mkdirSync(path.join(dir, 'sub'));
  assert.match(run(dir, ['unit', 'x']).stdout, /sub/);
});

test('CLI prints BUILD FAILED when buildError matches a failing run', () => {
  const dir = project({ tests: { unit: { command: echo('BOOM here', 1), format: 'dotnet', buildError: 'BOOM' } } });
  const r = run(dir, ['unit', 'x']);
  assert.match(r.stdout, /^BUILD FAILED\nBOOM here/);
  assert.notEqual(r.status, 0);
});

test('CLI prints the raw tail when the output is not parsed', () => {
  const dir = project({ tests: { unit: { command: echo('plain line', 3) } } });
  const r = run(dir, ['unit', 'x']);
  assert.match(r.stdout, /plain line/);
  assert.equal(r.status, 3);
});

test('unknown kind names the known kinds and exits 2', () => {
  const dir = project({ tests: { unit: { command: 'x' }, e2e: { command: 'y' } } });
  const r = run(dir, ['nope', 'x']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^guardrails: no tests\.nope in \.claude\/ai-dev-team\.json \(known: unit, e2e\)\n$/);
});

test('missing arguments print usage and exit 2', () => {
  const r = run(project({}), ['unit']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage/i);
});

for (const [label, cfg] of [
  ['invalid json', '{nope'],
  ['tests not an object', JSON.stringify({ tests: [] })],
  ['command missing', JSON.stringify({ tests: { unit: {} } })],
  ['cwd not a string', JSON.stringify({ tests: { unit: { command: 'x', cwd: 1 } } })],
  ['format not a string', JSON.stringify({ tests: { unit: { command: 'x', format: 1 } } })],
  ['buildError invalid regex', JSON.stringify({ tests: { unit: { command: 'x', buildError: '(' } } })],
  ['testLock not boolean', JSON.stringify({ testLock: 'yes', tests: { unit: { command: 'x' } } })],
]) {
  test(`config error (${label}) is one stderr line with exit 2`, () => {
    const r = run(project(null, cfg), ['unit', 'x']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /^guardrails: .+\n$/);
  });
}

test('lock: second acquire waits for the first release', async () => {
  const file = path.join(base, 'a.lock');
  const rel1 = await acquireLock(file, { pollMs: 20, timeoutMs: 5000 });
  let got = false;
  const p2 = acquireLock(file, { pollMs: 20, timeoutMs: 5000 }).then((r) => {
    got = true;
    return r;
  });
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(got, false);
  rel1();
  const rel2 = await p2;
  assert.equal(got, true);
  rel2();
  assert.equal(fs.existsSync(file), false);
});

test('lock: a stale pid is taken over', async () => {
  const file = path.join(base, 'b.lock');
  fs.writeFileSync(file, '999999');
  const rel = await acquireLock(file, { pollMs: 20, timeoutMs: 1000 });
  assert.equal(fs.readFileSync(file, 'utf8'), String(process.pid));
  rel();
});

test('lock: timeout rejects', async () => {
  const file = path.join(base, 'c.lock');
  const rel = await acquireLock(file, { pollMs: 20, timeoutMs: 1000 });
  await assert.rejects(acquireLock(file, { pollMs: 20, timeoutMs: 100 }), /timed out/);
  rel();
});

test('lock: release leaves a file owned by someone else', async () => {
  const file = path.join(base, 'd.lock');
  const rel = await acquireLock(file, { pollMs: 20, timeoutMs: 1000 });
  fs.writeFileSync(file, String(process.pid + 1));
  rel();
  assert.equal(fs.existsSync(file), true);
});

test('lock: parallel acquirers never remove a live holder', async () => {
  const file = path.join(base, 'e.lock');
  fs.writeFileSync(file, String(process.pid));
  let resolved = 0;
  const attempts = [1, 2].map(() => acquireLock(file, { pollMs: 10, timeoutMs: 300 }).then(() => resolved++, () => {}));
  await Promise.all(attempts);
  assert.equal(resolved, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), String(process.pid));
  fs.unlinkSync(file);
});

test('lock: concurrent processes never hold it at the same time', async () => {
  const file = path.join(base, 'f.lock');
  const log = path.join(base, 'f.log');
  const child = path.join(base, 'child.mjs');
  const mod = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'scoped-test.mjs')).href;
  fs.writeFileSync(child, `import fs from 'node:fs';
import { acquireLock } from ${JSON.stringify(mod)};
const release = await acquireLock(${JSON.stringify(file)}, { pollMs: 5, timeoutMs: 60000 });
fs.appendFileSync(${JSON.stringify(log)}, 'start,');
await new Promise((r) => setTimeout(r, 40));
fs.appendFileSync(${JSON.stringify(log)}, 'end,');
release();
`);
  const env = { ...process.env };
  const exits = await Promise.all(
    Array.from({ length: 8 }, () => new Promise((res) => spawn(process.execPath, [child], { env, stdio: ['ignore', 'ignore', 'inherit'] }).on('close', res))),
  );
  assert.deepEqual(exits, Array(8).fill(0));
  const marks = fs.readFileSync(log, 'utf8').split(',').filter(Boolean);
  assert.equal(marks.length, 16);
  marks.forEach((m, i) => assert.equal(m, i % 2 === 0 ? 'start' : 'end'));
});
