import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { projectRoot } from '../scripts/lib/project.mjs';

const script = fileURLToPath(new URL('../scripts/app.mjs', import.meta.url));
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e app-'));
const dirs = [];
const servers = [];

after(() => {
  for (const d of dirs) {
    run(d, ['down']);
    const key = crypto.createHash('sha1').update(projectRoot(d)).digest('hex').slice(0, 12);
    fs.rmSync(path.join(os.tmpdir(), 'ai-dev-team-e2e', key), { recursive: true, force: true });
  }
  for (const s of servers) s.kill();
  fs.rmSync(base, { recursive: true, force: true });
});

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

const listens = (port) =>
  new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port });
    s.on('connect', () => (s.destroy(), resolve(true)));
    s.on('error', () => resolve(false));
  });

function run(dir, args) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
  return spawnSync(process.execPath, [script, ...args], { cwd: dir, env, encoding: 'utf8', timeout: 40000 });
}

const FILES = {
  'srv.mjs': `import http from 'node:http';
http.createServer((q, r) => r.end('ok')).listen(Number(process.argv[2]), '127.0.0.1');
`,
  'tcp.mjs': `import net from 'node:net';
net.createServer().listen(Number(process.argv[2]), '127.0.0.1');
`,
  'parent.mjs': `import { spawn } from 'node:child_process';
import http from 'node:http';
spawn(process.execPath, [process.argv[4], process.argv[3]], { stdio: 'ignore' });
http.createServer((q, r) => r.end('ok')).listen(Number(process.argv[2]), '127.0.0.1');
`,
  'late.mjs': `import http from 'node:http';
setTimeout(() => http.createServer((q, r) => r.end('ok')).listen(Number(process.argv[2]), '127.0.0.1'), 5000);
`,
  'quit.mjs': `console.log('quit-line-marker');
`,
  'hang.mjs': `console.log('pid=' + process.pid);
console.log('last-line-marker');
setInterval(() => {}, 1000);
`,
};

function project(e2e) {
  const dir = fs.mkdtempSync(path.join(base, 'my proj-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, '.claude'));
  for (const [n, t] of Object.entries(FILES)) fs.writeFileSync(path.join(dir, n), t);
  configure(dir, e2e);
  return dir;
}

const configure = (dir, e2e) => fs.writeFileSync(path.join(dir, '.claude', 'ai-dev-team.json'), JSON.stringify({ e2e }));
const q = (p) => `"${p}"`;
const cmd = (dir, file, ...args) => `${q(process.execPath)} ${q(path.join(dir, file))} ${args.join(' ')}`;
const url = (port) => `http://127.0.0.1:${port}/`;
const statePath = (dir) => {
  const key = crypto.createHash('sha1').update(projectRoot(dir)).digest('hex').slice(0, 12);
  return path.join(os.tmpdir(), 'ai-dev-team-e2e', key, 'state.json');
};
const bootNow = () => Math.round(Date.now() / 1000 - os.uptime());
const lines = (r) => r.stdout.trim().split(/\r?\n/);

test('up starts the entries in order, status sees them, down stops them with their ports', async () => {
  const [pa, pb] = [await freePort(), await freePort()];
  const dir = project({});
  const boot = [
    { name: 'a', command: cmd(dir, 'srv.mjs', pa), ready: url(pa) },
    { name: 'b', command: cmd(dir, 'srv.mjs', pb), ready: url(pb) },
  ];
  configure(dir, { baseUrl: `http://127.0.0.1:${pb}`, timeoutSec: 20, boot });
  const up = run(dir, ['up']);
  assert.equal(up.status, 0, up.stderr);
  assert.deepEqual(lines(up), [`ready a ${url(pa)}`, `ready b ${url(pb)}`, `base http://127.0.0.1:${pb}`]);
  assert.deepEqual(lines(run(dir, ['status'])), [`a ready ${url(pa)}`, `b ready ${url(pb)}`]);
  const down = run(dir, ['down']);
  assert.equal(down.status, 0, down.stderr);
  assert.deepEqual(lines(down), ['stopped a', 'stopped b']);
  assert.equal(await listens(pa), false);
  assert.equal(await listens(pb), false);
  assert.deepEqual(lines(run(dir, ['status'])), [`a down ${url(pa)}`, `b down ${url(pb)}`]);
  assert.equal(run(dir, ['down']).stdout.trim(), 'e2e: nothing to stop');
});

test('an entry already listening is reused and left running by down', async () => {
  const port = await freePort();
  const dir = project({ baseUrl: url(port), boot: [{ name: 'web', ready: url(port) }] });
  const server = spawn(process.execPath, [path.join(dir, 'srv.mjs'), String(port)], { stdio: 'ignore' });
  servers.push(server);
  for (let i = 0; i < 40 && !(await listens(port)); i++) await new Promise((r) => setTimeout(r, 250));
  const up = run(dir, ['up']);
  assert.equal(up.status, 0, up.stderr);
  assert.deepEqual(lines(up), ['reuse web', `base ${url(port)}`]);
  assert.equal(run(dir, ['down']).stdout.trim(), 'e2e: nothing to stop');
  assert.equal(await listens(port), true);
});

test('an entry with no command and nothing listening fails with a clear message', async () => {
  const port = await freePort();
  const dir = project({ baseUrl: url(port), boot: [{ name: 'api', ready: url(port) }] });
  const up = run(dir, ['up']);
  assert.equal(up.status, 1);
  assert.equal(up.stderr.trim(), `e2e: api not ready at ${url(port)} and has no command; start it first`);
});

test('a timeout prints the log tail and stops what this call started', async () => {
  const [pa, pb] = [await freePort(), await freePort()];
  const dir = project({});
  const boot = [
    { name: 'a', command: cmd(dir, 'srv.mjs', pa), ready: url(pa) },
    { name: 'b', command: cmd(dir, 'hang.mjs'), ready: url(pb) },
  ];
  configure(dir, { baseUrl: url(pb), timeoutSec: 2, boot });
  const up = run(dir, ['up']);
  assert.equal(up.status, 1);
  assert.match(up.stderr, /e2e: b not ready after 2s; last log lines:/);
  assert.match(up.stderr, /last-line-marker/);
  assert.equal(await listens(pa), false);
  const pid = Number(/pid=(\d+)/.exec(up.stderr)[1]);
  assert.throws(() => process.kill(pid, 0), 'the hung process must be dead');
  assert.equal(run(dir, ['down']).stdout.trim(), 'e2e: nothing to stop');
});

test('a process that exits before it is ready stops the wait at once and shows its output', async () => {
  const port = await freePort();
  const dir = project({});
  configure(dir, { baseUrl: url(port), timeoutSec: 30, boot: [{ name: 'q', command: cmd(dir, 'quit.mjs'), ready: url(port) }] });
  const started = Date.now();
  const up = run(dir, ['up']);
  assert.equal(up.status, 1);
  assert.ok(Date.now() - started < 15000, 'must not wait for timeoutSec');
  assert.match(up.stderr, /e2e: q exited before ready; last log lines:/);
  assert.match(up.stderr, /quit-line-marker/);
});

test('a boot entry whose working directory is missing logs the spawn error', async () => {
  const port = await freePort();
  const dir = project({});
  const boot = [{ name: 'w', command: cmd(dir, 'quit.mjs'), cwd: 'no-such-dir', ready: url(port) }];
  configure(dir, { baseUrl: url(port), timeoutSec: 30, boot });
  const up = run(dir, ['up']);
  assert.equal(up.status, 1);
  assert.match(up.stderr, /exited before ready/);
  assert.match(up.stderr, /ENOENT|no-such-dir/);
});

test('down kills the whole process tree', async () => {
  const [pa, pc] = [await freePort(), await freePort()];
  const dir = project({});
  const boot = [{ name: 'app', command: cmd(dir, 'parent.mjs', pa, pc, q(path.join(dir, 'srv.mjs'))), ready: url(pa) }];
  configure(dir, { baseUrl: url(pa), timeoutSec: 20, boot });
  assert.equal(run(dir, ['up']).status, 0);
  for (let i = 0; i < 40 && !(await listens(pc)); i++) await new Promise((r) => setTimeout(r, 250));
  assert.equal(await listens(pc), true);
  assert.deepEqual(lines(run(dir, ['down'])), ['stopped app']);
  assert.equal(await listens(pa), false);
  assert.equal(await listens(pc), false);
});

test('tcp:// readiness works', async () => {
  const port = await freePort();
  const dir = project({});
  const boot = [{ name: 'db', command: cmd(dir, 'tcp.mjs', port), ready: `tcp://127.0.0.1:${port}` }];
  configure(dir, { baseUrl: url(port), timeoutSec: 20, boot });
  const up = run(dir, ['up']);
  assert.equal(up.status, 0, up.stderr);
  assert.match(up.stdout, new RegExp(`ready db tcp://127.0.0.1:${port}`));
  assert.deepEqual(lines(run(dir, ['down'])), ['stopped db']);
  assert.equal(await listens(port), false);
});

test('an invalid e2e.boot exits 2 with one line', () => {
  const dir = project({ baseUrl: 'http://127.0.0.1:1', boot: 'nope' });
  const r = run(dir, ['up']);
  assert.equal(r.status, 2);
  assert.equal(r.stderr.trim().split(/\r?\n/).length, 1);
  assert.match(r.stderr, /e2e\.boot must be an array/);
});

test('an up that was cut off leaves no orphan: the next up replaces it and down stops everything', async () => {
  const port = await freePort();
  const dir = project({});
  configure(dir, { baseUrl: url(port), timeoutSec: 30, boot: [{ name: 'late', command: cmd(dir, 'late.mjs', port), ready: url(port) }] });
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
  const first = spawn(process.execPath, [script, 'up'], { cwd: dir, env, stdio: 'ignore' });
  for (let i = 0; i < 40 && !fs.existsSync(statePath(dir)); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(fs.existsSync(statePath(dir)), 'state.json must exist while the first up waits');
  first.kill();
  await new Promise((r) => first.on('exit', r));
  const second = run(dir, ['up']);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /ready late/);
  assert.deepEqual(lines(run(dir, ['down'])), ['stopped late']);
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(await listens(port), false);
});

function bystander() {
  const win = process.platform === 'win32';
  const p = spawn(win ? 'ping' : 'sleep', win ? ['-n', '30', '127.0.0.1'] : ['30'], { stdio: 'ignore', windowsHide: true });
  servers.push(p);
  return p;
}

function writeState(dir, boot, pid) {
  fs.mkdirSync(path.dirname(statePath(dir)), { recursive: true });
  fs.writeFileSync(statePath(dir), JSON.stringify({ boot, started: [{ name: 'web', pid }] }));
}

test('down ignores a state file written before the last reboot', () => {
  const dir = project({ baseUrl: 'http://127.0.0.1:1', boot: [{ name: 'web', ready: 'http://127.0.0.1:1/' }] });
  const p = bystander();
  writeState(dir, bootNow() - 86400, p.pid);
  const down = run(dir, ['down']);
  assert.equal(down.stdout.trim(), 'e2e: nothing to stop');
  assert.doesNotThrow(() => process.kill(p.pid, 0), 'the unrelated process must survive');
});

test('down never kills a live pid that is not a node process', () => {
  const dir = project({ baseUrl: 'http://127.0.0.1:1', boot: [{ name: 'web', ready: 'http://127.0.0.1:1/' }] });
  const p = bystander();
  writeState(dir, bootNow(), p.pid);
  const down = run(dir, ['down']);
  assert.equal(down.stdout.trim(), 'gone web');
  assert.doesNotThrow(() => process.kill(p.pid, 0), 'the unrelated process must survive');
});

test('duplicate or unsafe boot names exit 2 with one line', () => {
  const entry = (name) => ({ name, ready: 'http://127.0.0.1:1/' });
  for (const [boot, re] of [
    [[entry('a'), entry('a')], /duplicate/],
    [[entry('../x')], /boot\[0\]\.name/],
  ]) {
    const r = run(project({ baseUrl: 'http://127.0.0.1:1', boot }), ['status']);
    assert.equal(r.status, 2);
    assert.equal(r.stderr.trim().split(/\r?\n/).length, 1);
    assert.match(r.stderr, re);
  }
});
