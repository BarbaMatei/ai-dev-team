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

const FAKE = (log, write) => `import fs from 'node:fs';
const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(a) + '\\n');
const shot = a.find((x) => x.startsWith('--screenshot=')).slice('--screenshot='.length);
${write ? "fs.writeFileSync(shot, Buffer.from('12345678'));" : ''}
`;

function setup(write = true, browser) {
  const dir = path.join(base, `p ${n++}`);
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  const fake = path.join(dir, 'fake-browser.mjs');
  const log = path.join(dir, 'argv.log');
  fs.writeFileSync(fake, FAKE(log, write));
  const cfg = { e2e: { baseUrl: 'http://localhost:4200', browser: browser ?? [process.execPath, fake] } };
  fs.writeFileSync(path.join(dir, '.claude', 'ai-dev-team.json'), JSON.stringify(cfg));
  return { dir, log, out: path.join(dir, 'out dir') };
}

function run(dir, args, extraEnv = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (Object.keys(extraEnv).some((x) => x.toLowerCase() === k.toLowerCase())) delete env[k];
  Object.assign(env, extraEnv);
  for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
  return spawnSync(process.execPath, [script, ...args], { cwd: dir, env, encoding: 'utf8', timeout: 40000 });
}

function slugs(routes) {
  const { dir, out } = setup();
  const r = run(dir, [out, ...routes, '--viewports', '390x844']);
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
  const { dir, out } = setup();
  const r = run(dir, [out, '/', '/prices-x', '--viewports', '390x844,1280x800']);
  assert.equal(r.status, 0, r.stderr);
  const names = ['root@390x844.png', 'root@1280x800.png', 'prices-x@390x844.png', 'prices-x@1280x800.png'];
  assert.deepEqual(r.stdout.trim().split(/\r?\n/).sort(), names.map((f) => path.join(out, f)).sort());
  assert.deepEqual(fs.readdirSync(out).sort(), [...names].sort());
});

test('the browser gets the window size, the screenshot path and the full url', () => {
  const { dir, log, out } = setup();
  const r = run(dir, [out, '/a/b?x=1', '--viewports', '390x844', '--wait', '1234']);
  assert.equal(r.status, 0, r.stderr);
  const argv = JSON.parse(fs.readFileSync(log, 'utf8').trim());
  assert.ok(argv.includes('--window-size=390,844'));
  assert.ok(argv.includes('http://localhost:4200/a/b?x=1'));
  assert.ok(argv.includes('--virtual-time-budget=1234'));
  assert.ok(argv.includes('--headless=new'));
  assert.ok(argv.includes(`--screenshot=${path.join(out, 'a-b@390x844.png')}`));
  assert.ok(argv.some((a) => a.startsWith('--user-data-dir=')));
});

test('a full http(s) route is used as is', () => {
  const { dir, log, out } = setup();
  const r = run(dir, [out, 'https://example.test/x?y=2', '--viewports', '390x844']);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(JSON.parse(fs.readFileSync(log, 'utf8').trim()).includes('https://example.test/x?y=2'));
});

test('a browser that writes nothing exits 1', () => {
  const { dir, out } = setup(false);
  const r = run(dir, [out, '/x', '--viewports', '390x844']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /e2e: no screenshot for http:\/\/localhost:4200\/x/);
});

test('a configured browser that does not exist exits 2', () => {
  const { dir, out } = setup(true, path.join(base, 'no-such-browser.exe'));
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
  assert.match(r.stderr, /e2e: no screenshot for/);
});

test('with e2e.browser unset and no browser anywhere the detection fails', async (t) => {
  if (process.platform !== 'win32' && ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge'].some((n) => fs.existsSync('/usr/bin/' + n))) t.skip('a real browser is installed');
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
