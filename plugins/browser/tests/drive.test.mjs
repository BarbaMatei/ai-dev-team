import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/drive.mjs', import.meta.url));
const fake = fileURLToPath(new URL('./fake-cdp.mjs', import.meta.url));
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'browser drive-'));
after(() => fs.rmSync(base, { recursive: true, force: true }));
let n = 0;

const val = (v) => ({ result: { type: 'object', value: v } });
const calls = (log) =>
  fs
    .readFileSync(log, 'utf8')
    .trim()
    .split(/\r?\n/)
    .map((l) => JSON.parse(l));

function setup(steps, { baseUrl = 'http://localhost:9', cdp = {}, doc = {} } = {}) {
  const dir = path.join(base, `p ${n++}`);
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  const browser = { exe: [process.execPath, fake], ...(baseUrl && { baseUrl }) };
  fs.writeFileSync(path.join(dir, '.claude', 'ai-dev-team.json'), JSON.stringify({ browser }));
  const file = path.join(dir, 'steps.json');
  fs.writeFileSync(file, JSON.stringify({ ...doc, steps }));
  const log = path.join(dir, 'cdp.log');
  const env = { FAKE_CDP_LOG: log };
  if (Object.keys(cdp).length) {
    env.FAKE_CDP_SCRIPT = path.join(dir, 'cdp.json');
    fs.writeFileSync(env.FAKE_CDP_SCRIPT, JSON.stringify(cdp));
  }
  return { dir, file, log, out: path.join(dir, 'out dir'), env };
}

function run(t) {
  const env = { ...process.env, ...t.env };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
  return spawnSync(process.execPath, [script, t.file, t.out], { cwd: t.dir, env, encoding: 'utf8', timeout: 40000 });
}

const lines = (r) => r.stdout.trim().split(/\r?\n/);

test('a step with an unknown action exits 2 naming the step before any browser starts', () => {
  const t = setup([{ go: '/' }, { clik: '#a' }]);
  const r = run(t);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /step 2: unknown action "clik"/);
  assert.equal(fs.existsSync(t.log), false);
});

test('a relative go is navigated as baseUrl plus route', () => {
  const t = setup([{ go: '/auth/login' }]);
  const r = run(t);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(lines(r).includes('step 1 go /auth/login'), r.stdout);
  assert.deepEqual(
    calls(t.log).filter((c) => c.method === 'Page.navigate').map((c) => c.params.url),
    ['http://localhost:9/auth/login'],
  );
});

test('a relative go without browser.baseUrl exits 2', () => {
  const t = setup([{ go: '/x' }], { baseUrl: null });
  const r = run(t);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /step 1: .*browser\.baseUrl/);
  assert.equal(fs.existsSync(t.log), false);
});

test('click waits for the element, then presses and releases the left button at its centre', () => {
  const t = setup([{ click: '#go' }], {
    cdp: { replies: { 'Runtime.evaluate': [val(null), val({ x: 10, y: 20, width: 100, height: 40 })] } },
  });
  const r = run(t);
  assert.equal(r.status, 0, r.stderr);
  const mouse = calls(t.log).filter((c) => c.method === 'Input.dispatchMouseEvent');
  assert.deepEqual(
    mouse.map((c) => [c.params.type, c.params.x, c.params.y, c.params.button]),
    [
      ['mousePressed', 60, 40, 'left'],
      ['mouseReleased', 60, 40, 'left'],
    ],
  );
});

test('a click point covered by another element is a note, not a failure', () => {
  const t = setup([{ click: '#go' }], {
    cdp: { replies: { 'Runtime.evaluate': [val({ x: 0, y: 0, width: 10, height: 10, cover: 'div#modal.shade' })] } },
  });
  const r = run(t);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(lines(r).includes('note 1 click point covered by div#modal.shade'), r.stdout);
});

test('a wait whose element never appears fails within its timeoutMs, saves fail-2.png and exits 1', () => {
  const t = setup([{ go: '/' }, { wait: '#nope', timeoutMs: 300 }]);
  const start = Date.now();
  const r = run(t);
  assert.ok(Date.now() - start < 5000);
  assert.equal(r.status, 1);
  assert.ok(lines(r).includes('fail 2 wait #nope: not found after 300 ms'), r.stdout);
  assert.ok(fs.existsSync(path.join(t.out, 'fail-2.png')));
});

test('type focuses the field and inserts the text unchanged', () => {
  const text = 'Ștefan Țepeș – ăîâ';
  const t = setup([{ type: '#name', text }], { cdp: { replies: { 'Runtime.evaluate': [val(true)] } } });
  const r = run(t);
  assert.equal(r.status, 0, r.stderr);
  const c = calls(t.log);
  const insert = c.filter((x) => x.method === 'Input.insertText');
  assert.deepEqual(
    insert.map((x) => x.params.text),
    [text],
  );
  assert.ok(c.findIndex((x) => x.method === 'Runtime.evaluate') < c.findIndex((x) => x.method === 'Input.insertText'));
});

test('press Enter sends keyDown and keyUp with key Enter', () => {
  const t = setup([{ press: 'Enter' }]);
  const r = run(t);
  assert.equal(r.status, 0, r.stderr);
  const keys = calls(t.log).filter((c) => c.method === 'Input.dispatchKeyEvent');
  assert.deepEqual(
    keys.map((c) => [c.params.type, c.params.key, c.params.windowsVirtualKeyCode]),
    [
      ['keyDown', 'Enter', 13],
      ['keyUp', 'Enter', 13],
    ],
  );
});

test('upload sets the files by absolute path resolved from the steps file folder', () => {
  const t = setup([{ upload: '#file', files: ['a.jpg'] }], {
    cdp: { replies: { 'DOM.getDocument': [{ root: { nodeId: 1 } }], 'DOM.querySelector': [{ nodeId: 7 }] } },
  });
  fs.writeFileSync(path.join(t.dir, 'a.jpg'), 'x');
  const r = run(t);
  assert.equal(r.status, 0, r.stderr);
  const set = calls(t.log).filter((c) => c.method === 'DOM.setFileInputFiles');
  assert.equal(set.length, 1);
  assert.deepEqual(set[0].params, { files: [path.join(t.dir, 'a.jpg')], nodeId: 7 });
});

test('upload of a file that does not exist exits 2 before any browser starts', () => {
  const t = setup([{ upload: '#file', files: ['missing.jpg'] }]);
  const r = run(t);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /step 1: .*missing\.jpg/);
  assert.equal(fs.existsSync(t.log), false);
});

test('eval prints the returned value as one JSON line', () => {
  const t = setup([{ eval: '({a:1})' }], { cdp: { replies: { 'Runtime.evaluate': [val({ a: 1 })] } } });
  const r = run(t);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(lines(r).includes('eval 1 {"a":1}'), r.stdout);
});

test('console errors, exceptions, failed requests and API responses are printed; at most 50 API lines', () => {
  const events = [
    { method: 'Runtime.consoleAPICalled', params: { type: 'error', args: [{ type: 'string', value: 'boom' }] } },
    { method: 'Runtime.exceptionThrown', params: { exceptionDetails: { text: 'Uncaught', exception: { description: 'Error: kaboom' } } } },
    { method: 'Network.requestWillBeSent', params: { requestId: 'I1', type: 'Image', request: { method: 'GET', url: 'http://x/i.png' } } },
    { method: 'Network.loadingFailed', params: { requestId: 'I1', type: 'Image', errorText: 'net::ERR_FAILED' } },
  ];
  for (let i = 0; i < 60; i++) {
    const url = `http://x/api/${i}`;
    events.push({ method: 'Network.requestWillBeSent', params: { requestId: `F${i}`, type: 'Fetch', request: { method: 'POST', url } } });
    events.push({ method: 'Network.responseReceived', params: { requestId: `F${i}`, type: 'Fetch', response: { status: 201, url } } });
  }
  const t = setup([{ sleep: 300 }], { cdp: { events: { 'Log.enable': events } } });
  const r = run(t);
  assert.equal(r.status, 0, r.stderr);
  const out = lines(r);
  assert.ok(out.includes('console error boom'), r.stdout);
  assert.ok(out.includes('exception Error: kaboom'), r.stdout);
  assert.ok(out.includes('failed GET http://x/i.png net::ERR_FAILED'), r.stdout);
  assert.equal(out.filter((l) => /^api \d+ /.test(l)).length, 50);
  assert.ok(out.includes('api … 10 more in drive.log'), r.stdout);
  assert.ok(out.includes('api 201 POST http://x/api/0'));
  assert.match(out.at(-1), /^done 1 steps, 60 api requests, log .*drive\.log$/);
  const log = fs.readFileSync(path.join(t.out, 'drive.log'), 'utf8').split(/\r?\n/);
  assert.equal(log.filter((l) => /^api \d+ /.test(l)).length, 60);
});

test('shot writes <out-dir>/<name>.png with the decoded PNG', () => {
  const t = setup([{ shot: 'home' }]);
  const r = run(t);
  assert.equal(r.status, 0, r.stderr);
  const file = path.join(t.out, 'home.png');
  assert.ok(lines(r).includes(`shot ${file}`), r.stdout);
  assert.deepEqual([...fs.readFileSync(file).subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
});

test('a failing step still closes the browser and removes its profile', () => {
  const t = setup([{ wait: '#nope', timeoutMs: 200 }]);
  const r = run(t);
  assert.equal(r.status, 1);
  assert.equal(calls(t.log).at(-1).method, 'Browser.close');
  const profile = fs.readFileSync(`${t.log}.udd`, 'utf8');
  assert.ok(profile.length > 0);
  assert.equal(fs.existsSync(profile), false);
  assert.throws(() => process.kill(Number(fs.readFileSync(`${t.log}.pid`, 'utf8')), 0));
});

test('a protocol error after the browser started exits 1 and closes the browser', () => {
  const t = setup([{ sleep: 10 }], { cdp: { replies: { 'Emulation.setDeviceMetricsOverride': [{ error: 'no emulation' }] } } });
  const r = run(t);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no emulation/);
  assert.equal(calls(t.log).at(-1).method, 'Browser.close');
});

test('an eval of a promise that never settles fails within its timeoutMs with a screenshot', () => {
  const t = setup([{ eval: 'new Promise(() => {})', timeoutMs: 300 }], { cdp: { replies: { 'Runtime.evaluate': [{ hang: true }] } } });
  const start = Date.now();
  const r = run(t);
  assert.ok(Date.now() - start < 5000);
  assert.equal(r.status, 1);
  assert.ok(lines(r).includes('fail 1 eval new Promise(() => {}): evaluation timed out after 300 ms'), r.stdout);
  assert.ok(fs.existsSync(path.join(t.out, 'fail-1.png')));
});

test('until keeps retrying after a JS exception', () => {
  const boom = { exceptionDetails: { text: 'boom', exception: { description: 'ReferenceError: x is not defined' } } };
  const t = setup([{ until: 'x', timeoutMs: 3000 }], { cdp: { replies: { 'Runtime.evaluate': [boom, val(true)] } } });
  const r = run(t);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('until that only throws fails with the last error', () => {
  const boom = { exceptionDetails: { text: 'boom', exception: { description: 'ReferenceError: x is not defined' } } };
  const t = setup([{ until: 'x', timeoutMs: 300 }], { cdp: { replies: { 'Runtime.evaluate': [boom] } } });
  const r = run(t);
  assert.equal(r.status, 1);
  assert.ok(lines(r).includes('fail 1 until x: still falsy after 300 ms: ReferenceError: x is not defined'), r.stdout);
});

test('SIGTERM mid-step closes the browser, removes the profile and exits 143', async (t) => {
  if (process.platform === 'win32') return t.skip('Windows cannot deliver SIGTERM to a handler');
  const c = setup([{ wait: '#nope', timeoutMs: 20000 }]);
  const env = { ...process.env, ...c.env };
  const child = spawn(process.execPath, [script, c.file, c.out], { cwd: c.dir, env, stdio: 'ignore' });
  const done = new Promise((res) => child.on('exit', (code) => res(code)));
  for (let i = 0; i < 100 && !(fs.existsSync(c.log) && fs.readFileSync(c.log, 'utf8').includes('Runtime.evaluate')); i++) await new Promise((r) => setTimeout(r, 100));
  child.kill('SIGTERM');
  assert.equal(await done, 143);
  assert.throws(() => process.kill(Number(fs.readFileSync(`${c.log}.pid`, 'utf8')), 0));
  assert.equal(fs.existsSync(fs.readFileSync(`${c.log}.udd`, 'utf8')), false);
});
