import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { matchFake } from '../scripts/lib/fakes.mjs';
import { LOCATE } from '../scripts/lib/actions.mjs';

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
  assert.match(out.at(-1), /^done 1 steps, 60 api requests, 0 faked, log .*drive\.log$/);
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

const paused = (requestId, method, url, headers = {}) => ({
  method: 'Fetch.requestPaused',
  params: { requestId, request: { method, url, headers } },
});
const fetchCalls = (log, method) => calls(log).filter((c) => c.method === method);

test('a fake is enabled with its pattern and answers a matching request with its status, JSON body and content type', () => {
  const t = setup([{ sleep: 200 }], {
    doc: { fake: [{ url: 'http://x/api/orders?*', method: 'get', status: 201, json: { items: [1] } }] },
    cdp: { events: { 'Fetch.enable': [paused('R1', 'GET', 'http://x/api/orders?page=2')] } },
  });
  const r = run(t);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(fetchCalls(t.log, 'Fetch.enable')[0].params.patterns, [{ urlPattern: 'http://x/api/orders?*', requestStage: 'Request' }]);
  const [f] = fetchCalls(t.log, 'Fetch.fulfillRequest');
  assert.equal(f.params.requestId, 'R1');
  assert.equal(f.params.responseCode, 201);
  assert.equal(Buffer.from(f.params.body, 'base64').toString(), '{"items":[1]}');
  assert.deepEqual(f.params.responseHeaders, [{ name: 'Content-Type', value: 'application/json' }]);
});

test('a paused request whose method no fake matches continues unchanged', () => {
  const t = setup([{ sleep: 200 }], {
    doc: { fake: [{ url: 'http://x/api/*', method: 'GET', text: 'hi' }] },
    cdp: { events: { 'Fetch.enable': [paused('R1', 'POST', 'http://x/api/orders')] } },
  });
  const r = run(t);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(fetchCalls(t.log, 'Fetch.continueRequest').map((c) => c.params), [{ requestId: 'R1' }]);
  assert.equal(fetchCalls(t.log, 'Fetch.fulfillRequest').length, 0);
});

test('a cross-origin request gets CORS headers for its Origin, and its OPTIONS preflight gets 204', () => {
  const url = 'http://x/api/orders';
  const t = setup([{ sleep: 200 }], {
    doc: { fake: [{ url, method: 'POST', status: 202, json: {} }] },
    cdp: {
      events: {
        'Fetch.enable': [
          paused('R1', 'OPTIONS', url, { Origin: 'http://app', 'Access-Control-Request-Headers': 'authorization' }),
          paused('R2', 'POST', url, { origin: 'http://app' }),
        ],
      },
    },
  });
  const r = run(t);
  assert.equal(r.status, 0, r.stderr);
  const [pre, post] = fetchCalls(t.log, 'Fetch.fulfillRequest').map((c) => c.params);
  const h = (p) => Object.fromEntries(p.responseHeaders.map((x) => [x.name, x.value]));
  assert.equal(pre.responseCode, 204);
  assert.equal(pre.body, '');
  assert.equal(h(pre)['Access-Control-Allow-Headers'], 'authorization');
  assert.equal(h(pre)['Access-Control-Allow-Origin'], 'http://app');
  assert.equal(h(pre)['Access-Control-Allow-Credentials'], 'true');
  assert.equal(h(pre)['Access-Control-Allow-Methods'], 'GET,POST,PUT,PATCH,DELETE');
  assert.equal(post.responseCode, 202);
  assert.equal(h(post)['Access-Control-Allow-Origin'], 'http://app');
  assert.equal(h(post)['Access-Control-Allow-Credentials'], 'true');
  assert.equal(h(post)['Access-Control-Allow-Headers'], '*');
  assert.equal(h(post)['Access-Control-Allow-Methods'], 'GET,POST,PUT,PATCH,DELETE');
});

test("a file fake sends the file's bytes with its type", () => {
  const t = setup([{ sleep: 200 }], {
    doc: { fake: [{ url: 'http://x/img/*', file: 'pic.jpg' }] },
    cdp: { events: { 'Fetch.enable': [paused('R1', 'GET', 'http://x/img/a')] } },
  });
  fs.writeFileSync(path.join(t.dir, 'pic.jpg'), Buffer.from([0xff, 0xd8, 0x01]));
  const r = run(t);
  assert.equal(r.status, 0, r.stderr);
  const [f] = fetchCalls(t.log, 'Fetch.fulfillRequest');
  assert.deepEqual([...Buffer.from(f.params.body, 'base64')], [0xff, 0xd8, 0x01]);
  assert.deepEqual(f.params.responseHeaders, [{ name: 'Content-Type', value: 'image/jpeg' }]);
});

test('each faked request prints a fake line and the done line counts them', () => {
  const t = setup([{ sleep: 200 }], {
    doc: { fake: [{ url: 'http://x/api/*', text: 'ok' }] },
    cdp: { events: { 'Fetch.enable': [paused('R1', 'GET', 'http://x/api/a'), paused('R2', 'PUT', 'http://x/api/b')] } },
  });
  const r = run(t);
  assert.equal(r.status, 0, r.stderr);
  const out = lines(r);
  assert.ok(out.includes('fake GET http://x/api/a'), r.stdout);
  assert.ok(out.includes('fake PUT http://x/api/b'), r.stdout);
  assert.match(out.at(-1), /^done 1 steps, 0 api requests, 2 faked, log /);
});

test('a fake with two body kinds or none exits 2 naming it', () => {
  for (const bad of [{ url: 'http://x/*', json: {}, text: 'a' }, { url: 'http://x/*' }]) {
    const t = setup([{ go: '/' }], { doc: { fake: [{ url: 'http://x/*', text: 'ok' }, bad] } });
    const r = run(t);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /fake 2:/);
    assert.equal(fs.existsSync(t.log), false);
  }
});

test('a fake whose reply cannot be built prints fake-error and fails the request instead of leaving it paused', () => {
  const t = setup([{ sleep: 200 }], {
    doc: { fake: [{ url: 'http://x/img/*', file: 'pic.jpg' }] },
    cdp: { events: { 'Fetch.enable': [paused('R9', 'GET', 'http://x/img/a')] } },
  });
  fs.mkdirSync(path.join(t.dir, 'pic.jpg')); // exists at parse time, but reading a directory throws
  const r = run(t);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(lines(r).some((l) => l.startsWith('fake-error GET http://x/img/a: ')), r.stdout);
  const failed = fetchCalls(t.log, 'Fetch.failRequest').map((c) => c.params);
  assert.deepEqual(failed, [{ requestId: 'R9', errorReason: 'Failed' }]);
  assert.equal(fetchCalls(t.log, 'Fetch.fulfillRequest').length, 0);
});

test('matchFake treats only * and ? as wildcards and matches the whole address', () => {
  const hit = (url, probe) => matchFake([{ url }], probe, 'GET') !== undefined;
  assert.equal(hit('http://a.test/x+y*', 'http://a.test/x+y/more'), true);
  assert.equal(hit('http://a.test/x+y*', 'http://aXtest/x+y/more'), false);
  assert.equal(hit('http://a.test/x+y*', 'http://a.test/xxy'), false);
  assert.equal(hit('http://a.test/x?', 'http://a.test/xa'), true);
  assert.equal(hit('http://a.test/x?', 'http://a.test/x'), false);
  assert.equal(hit('http://a.test/x?', 'http://a.test/xab'), false);
});

test('a fulfil that the browser rejects is a fake-error, not a counted fake', () => {
  const t = setup([{ sleep: 200 }], {
    doc: { fake: [{ url: 'http://x/api/*', text: 'ok' }] },
    cdp: {
      replies: { 'Fetch.fulfillRequest': [{ error: 'Invalid InterceptionId' }] },
      events: { 'Fetch.enable': [paused('R1', 'GET', 'http://x/api/a')] },
    },
  });
  const r = run(t);
  assert.equal(r.status, 0, r.stderr);
  const out = lines(r);
  assert.ok(out.includes('fake-error GET http://x/api/a: Invalid InterceptionId'), r.stdout);
  assert.equal(out.some((l) => l.startsWith('fake GET')), false);
  assert.match(out.at(-1), /^done 1 steps, 0 api requests, 0 faked, log /);
  assert.equal(fetchCalls(t.log, 'Fetch.failRequest').length, 1);
});

test('a rejected continue of an unmatched request is not a fake-error', () => {
  const t = setup([{ sleep: 200 }], {
    doc: { fake: [{ url: 'http://x/api/*', method: 'GET', text: 'ok' }] },
    cdp: {
      replies: { 'Fetch.continueRequest': [{ error: 'Invalid InterceptionId' }] },
      events: { 'Fetch.enable': [paused('R1', 'POST', 'http://x/api/a')] },
    },
  });
  const r = run(t);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(lines(r).some((l) => l.startsWith('fake-error')), false);
  assert.equal(fetchCalls(t.log, 'Fetch.failRequest').length, 0);
});

function locateIn(hit) {
  const scrolls = [];
  const el = {
    getBoundingClientRect: () => ({ x: 10, y: 20, width: 100, height: 40 }),
    scrollIntoView: (o) => scrolls.push(o),
    contains: (x) => x === el,
  };
  const document = { querySelector: () => el, elementFromPoint: () => (hit === 'self' ? el : hit) };
  const result = vm.runInNewContext(LOCATE('#b'), { document, getComputedStyle: () => ({ visibility: 'visible', display: 'block' }) });
  return { result, scrolls };
}

test('click scrolls instantly so smooth scrolling cannot move the element after its position is read', () => {
  const { scrolls } = locateIn('self');
  assert.deepEqual(JSON.parse(JSON.stringify(scrolls)), [{ block: 'center', inline: 'center', behavior: 'instant' }]);
});

test('click is not located while nothing is at its centre yet, so the step retries', () => {
  assert.equal(locateIn(null).result, null);
  assert.equal(locateIn('self').result.cover, null);
});

test('a JavaScript dialog is accepted, logged, and the run continues', () => {
  const t = setup([{ click: '#b' }, { eval: '1' }], {
    cdp: {
      replies: { 'Runtime.evaluate': [val({ x: 10, y: 20, width: 100, height: 40 }), val(1)] },
      events: { 'Input.dispatchMouseEvent': [{ method: 'Page.javascriptDialogOpening', params: { type: 'confirm', message: 'sure?' } }] },
    },
  });
  const r = run(t);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(lines(r).includes('dialog confirm sure?'), r.stdout);
  const [h] = calls(t.log).filter((c) => c.method === 'Page.handleJavaScriptDialog');
  assert.deepEqual(h.params, { accept: true });
});

test('a browser call that never answers fails its step within timeoutMs, exits 1 and closes the browser', () => {
  const t = setup([{ click: '#b', timeoutMs: 300 }], {
    cdp: {
      replies: {
        'Runtime.evaluate': [val({ x: 10, y: 20, width: 100, height: 40 })],
        'Input.dispatchMouseEvent': [{ hang: true }],
      },
    },
  });
  const start = Date.now();
  const r = run(t);
  assert.ok(Date.now() - start < 5000);
  assert.equal(r.status, 1);
  assert.ok(lines(r).some((l) => l.startsWith('fail 1 click #b: Input.dispatchMouseEvent timed out after 300 ms')), r.stdout);
  assert.ok(fs.existsSync(path.join(t.out, 'fail-1.png')));
  assert.equal(calls(t.log).at(-1).method, 'Browser.close');
});

test('a page that never fires its load event fails go within timeoutMs with a screenshot', () => {
  const t = setup([{ go: '/x', timeoutMs: 300 }]);
  t.env.FAKE_CDP_MODE = 'hang';
  const start = Date.now();
  const r = run(t);
  assert.ok(Date.now() - start < 5000);
  assert.equal(r.status, 1);
  assert.ok(lines(r).includes('fail 1 go /x: no load event after 300 ms'), r.stdout);
  assert.ok(fs.existsSync(path.join(t.out, 'fail-1.png')));
});

test('go to another hash of the same document does not wait for a load event', () => {
  const t = setup([{ go: '/a#/two', timeoutMs: 1500 }], { cdp: { replies: { 'Page.navigate': [{ frameId: 'F1' }] } } });
  const r = run(t);
  assert.equal(r.status, 0, r.stderr);
});

test('a failed resource load names its address in the console line', () => {
  const t = setup([{ sleep: 100 }], {
    cdp: { events: { 'Log.enable': [{ method: 'Log.entryAdded', params: { entry: { level: 'error', text: 'Failed to load resource: 404', url: 'http://x/a.png' } } }] } },
  });
  const r = run(t);
  assert.ok(lines(r).includes('console error Failed to load resource: 404 http://x/a.png'), r.stdout);
});

test('console, exception and failed lines are capped at 50 on stdout while drive.log keeps all', () => {
  const ex = { method: 'Runtime.exceptionThrown', params: { exceptionDetails: { text: 'boom' } } };
  const t = setup([{ sleep: 100 }], { cdp: { events: { 'Runtime.enable': Array.from({ length: 60 }, () => ex) } } });
  const r = run(t);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(lines(r).filter((l) => l.startsWith('exception ')).length, 50);
  assert.ok(lines(r).includes('console … 10 more in drive.log'), r.stdout);
  assert.equal(fs.readFileSync(path.join(t.out, 'drive.log'), 'utf8').split('\n').filter((l) => l.startsWith('exception ')).length, 60);
});

test('an unknown top-level key exits 2 before any browser starts', () => {
  const t = setup([{ go: '/' }], { doc: { fakes: [] } });
  const r = run(t);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /steps file: unknown key "fakes"/);
  assert.equal(fs.existsSync(t.log), false);
});

test('text on a step other than type and files on a step other than upload exit 2', () => {
  for (const [step, re] of [
    [{ click: '#a', text: 'x' }, /step 1: "text" is only for type/],
    [{ click: '#a', files: ['a'] }, /step 1: "files" is only for upload/],
  ]) {
    const t = setup([step]);
    const r = run(t);
    assert.equal(r.status, 2);
    assert.match(r.stderr, re);
    assert.equal(fs.existsSync(t.log), false);
  }
});

test('a missing browser.baseUrl with the old e2e key present tells to rename the key', () => {
  const t = setup([{ go: '/x' }], { baseUrl: null });
  fs.writeFileSync(path.join(t.dir, '.claude', 'ai-dev-team.json'), JSON.stringify({ e2e: { baseUrl: 'http://localhost:9' }, browser: { exe: [process.execPath, fake] } }));
  const r = run(t);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /browser\.baseUrl.*; the settings moved from the "e2e" key to "browser": rename the key/);
});
