import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const script = fileURLToPath(new URL('../scripts/shots.mjs', import.meta.url));
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e shots-'));
after(() => fs.rmSync(base, { recursive: true, force: true }));
let n = 0;

const fake = fileURLToPath(new URL('./fake-cdp.mjs', import.meta.url));

function setup(browser) {
  const dir = path.join(base, `p ${n++}`);
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  const log = path.join(dir, 'cdp.log');
  const cfg = { e2e: { baseUrl: 'http://localhost:4200', browser: browser ?? [process.execPath, fake] } };
  fs.writeFileSync(path.join(dir, '.claude', 'ai-dev-team.json'), JSON.stringify(cfg));
  return { dir, log, out: path.join(dir, 'out dir'), env: { FAKE_CDP_LOG: log } };
}

const calls = (log) =>
  fs
    .readFileSync(log, 'utf8')
    .trim()
    .split(/\r?\n/)
    .map((l) => JSON.parse(l));

function run(dir, args, extraEnv = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (Object.keys(extraEnv).some((x) => x.toLowerCase() === k.toLowerCase())) delete env[k];
  Object.assign(env, extraEnv);
  for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
  return spawnSync(process.execPath, [script, ...args], { cwd: dir, env, encoding: 'utf8', timeout: 40000 });
}

function slugs(routes) {
  const { dir, out, env } = setup();
  const r = run(dir, [out, ...routes, '--viewports', '390x844'], env);
  assert.equal(r.status, 0, r.stderr);
  return fs.readdirSync(out).sort();
}

test('slug turns routes into file-safe names', () => {
  assert.deepEqual(slugs(['/']), ['root@390x844.png']);
  assert.deepEqual(slugs(['/prices-x']), ['prices-x@390x844.png']);
  assert.deepEqual(slugs(['/a/b?x=1#h']), ['a-b@390x844.png']);
  assert.deepEqual(slugs(['/A b/c_d']), ['a-b-c-d@390x844.png']);
  assert.deepEqual(slugs(['https://example.test/shop/cart?x=1']), ['shop-cart@390x844.png']);
});

test('two routes and two viewports give four files, printed one per line', () => {
  const { dir, out, env } = setup();
  const r = run(dir, [out, '/', '/prices-x', '--viewports', '390x844,1280x800'], env);
  assert.equal(r.status, 0, r.stderr);
  const names = ['root@390x844.png', 'root@1280x800.png', 'prices-x@390x844.png', 'prices-x@1280x800.png'];
  assert.deepEqual(r.stdout.trim().split(/\r?\n/).sort(), names.map((f) => path.join(out, f)).sort());
  assert.deepEqual(fs.readdirSync(out).sort(), [...names].sort());
});

test('each viewport is set exactly through the protocol and each route is navigated by full url', () => {
  const { dir, log, out, env } = setup();
  const r = run(dir, [out, '/', '/prices', 'https://example.test/x?y=2', '--viewports', '390x844,1280x800'], env);
  assert.equal(r.status, 0, r.stderr);
  const c = calls(log);
  const metrics = c.filter((x) => x.method === 'Emulation.setDeviceMetricsOverride').map((x) => x.params);
  assert.ok(metrics.some((p) => p.width === 390 && p.height === 844 && p.mobile === true && p.deviceScaleFactor === 1));
  assert.ok(metrics.some((p) => p.width === 1280 && p.height === 800 && p.mobile === false));
  const urls = c.filter((x) => x.method === 'Page.navigate').map((x) => x.params.url);
  assert.deepEqual([...new Set(urls)].sort(), ['http://localhost:4200/', 'http://localhost:4200/prices', 'https://example.test/x?y=2']);
  assert.equal(c.at(-1).method, 'Browser.close');
});

test('the screenshot file holds the decoded PNG', () => {
  const { dir, out, env } = setup();
  const r = run(dir, [out, '/', '--viewports', '390x844'], env);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual([...fs.readFileSync(path.join(out, 'root@390x844.png')).subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
});

test('a route Git Bash rewrote into a Windows path exits 2 before any browser runs', () => {
  const { dir, log, out, env } = setup();
  const r = run(dir, [out, 'C:/Program Files/Git/prices', '--viewports', '390x844'], env);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /MSYS_NO_PATHCONV=1/);
  assert.equal(r.stderr.trim().split(/\r?\n/).length, 1, r.stderr);
  assert.equal(fs.existsSync(log), false);
  assert.deepEqual(fs.existsSync(out) ? fs.readdirSync(out).filter((f) => f.endsWith('.png')) : [], []);
});

test('a browser that never opens the debugging port exits 1 quickly', () => {
  const { dir, out, env } = setup();
  const t = Date.now();
  const r = run(dir, [out, '/x', '--viewports', '390x844'], { ...env, FAKE_CDP_MODE: 'nostart', E2E_START_TIMEOUT_MS: '700' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /e2e: browser did not start/);
  assert.ok(Date.now() - t < 20000);
});

test('a screenshot error exits 1 naming the url', () => {
  const { dir, out, env } = setup();
  const r = run(dir, [out, '/x', '--viewports', '390x844'], { ...env, FAKE_CDP_MODE: 'shoterror' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /e2e: no screenshot for http:\/\/localhost:4200\/x/);
});

test('a configured browser that does not exist exits 2', () => {
  const { dir, out } = setup(path.join(base, 'no-such-browser.exe'));
  const r = run(dir, [out, '/x']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^e2e: browser not found: /);
});

test('an output folder under a file exits 2 with one line and no stack', () => {
  const { dir } = setup();
  const file = path.join(dir, 'a-file');
  fs.writeFileSync(file, 'x');
  const r = run(dir, [path.join(file, 'sub'), '/x']);
  assert.equal(r.status, 2);
  assert.equal(r.stderr.trim().split(/\r?\n/).length, 1, r.stderr);
  assert.doesNotMatch(r.stderr, /\n\s+at /);
});

const unconfigured = () => {
  const s = setup();
  fs.writeFileSync(path.join(s.dir, '.claude', 'ai-dev-team.json'), JSON.stringify({ e2e: { baseUrl: 'http://localhost:4200' } }));
  const empty = path.join(s.dir, 'empty');
  fs.mkdirSync(empty);
  return { ...s, env: { PATH: '', ProgramFiles: empty, 'ProgramFiles(x86)': empty, LOCALAPPDATA: empty } };
};

test('with e2e.browser unset, CHROME_PATH is the browser that runs', () => {
  const { dir, out, env } = unconfigured();
  const r = run(dir, [out, '/x', '--viewports', '390x844'], { ...env, CHROME_PATH: process.execPath });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /e2e: browser did not start/);
});

test('with e2e.browser unset and no browser anywhere the detection fails', async (t) => {
  const mac = process.platform === 'darwin' && fs.existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  if (mac || (process.platform !== 'win32' && ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge'].some((n) => fs.existsSync('/usr/bin/' + n)))) return t.skip('a real browser is installed');
  const { findBrowser } = await import(pathToFileURL(script).href);
  const empty = path.join(base, 'empty');
  fs.mkdirSync(empty, { recursive: true });
  const keys = ['PATH', 'Path', 'ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA', 'CHROME_PATH'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    for (const k of keys) delete process.env[k];
    Object.assign(process.env, { PATH: '', ProgramFiles: empty, 'ProgramFiles(x86)': empty, LOCALAPPDATA: empty, CHROME_PATH: path.join(empty, 'missing') });
    assert.throws(() => findBrowser({}), (e) => e.code === 2 && /no Chromium-based browser found/.test(e.message));
  } finally {
    for (const k of keys) if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
