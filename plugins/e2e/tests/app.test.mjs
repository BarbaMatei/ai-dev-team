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
  'hang.mjs': `console.log('first-line');
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
  assert.equal(run(dir, ['down']).stdout.trim(), 'e2e: nothing to stop');
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
