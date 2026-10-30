#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './lib/cdp.mjs';
import { loadE2e } from './lib/config.mjs';
import { killTree } from './lib/proc.mjs';
import { projectRoot } from './lib/project.mjs';

const PATH_NAMES = ['google-chrome', 'chromium', 'chromium-browser', 'msedge', 'chrome'];
const isFile = (p) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

function slugFor(route) {
  let p = route;
  if (/^https?:\/\//.test(p)) p = new URL(p).pathname;
  p = p.split(/[?#]/)[0].toLowerCase();
  const slug = p.split('/').filter(Boolean).join('-').replace(/[^a-z0-9-]/g, '-');
  return slug || 'root';
}

function standardPaths() {
  const e = process.env;
  if (process.platform === 'win32') {
    const roots = [e.ProgramFiles, e['ProgramFiles(x86)'], e.LOCALAPPDATA].filter(Boolean);
    const rel = ['Google\\Chrome\\Application\\chrome.exe', 'Microsoft\\Edge\\Application\\msedge.exe', 'Chromium\\Application\\chrome.exe'];
    return roots.flatMap((r) => rel.map((x) => path.join(r, x)));
  }
  if (process.platform === 'darwin') {
    return ['Google Chrome', 'Chromium', 'Microsoft Edge'].map((n) => `/Applications/${n}.app/Contents/MacOS/${n}`);
  }
  return ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge'].map((n) => `/usr/bin/${n}`);
}

function onPath() {
  const exts = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE').split(';') : [''];
  for (const dir of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    for (const n of PATH_NAMES) for (const x of exts) if (isFile(path.join(dir, n + x))) return path.join(dir, n + x);
  }
  return null;
}

export function findBrowser(cfg) {
  if (cfg.browser) {
    const [exe, ...args] = Array.isArray(cfg.browser) ? cfg.browser : [cfg.browser];
    if (!isFile(exe)) throw Object.assign(new Error(`e2e: browser not found: ${exe}`), { code: 2 });
    return { exe, args };
  }
  const exe = [process.env.CHROME_PATH, ...standardPaths()].find((p) => p && isFile(p)) ?? onPath();
  if (!exe) throw Object.assign(new Error('e2e: no Chromium-based browser found; set e2e.browser'), { code: 2 });
  return { exe, args: [] };
}

function parseArgs(argv) {
  const routes = [];
  let viewports = '390x844,1280x800';
  let wait = 5000;
  let outDir;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--viewports') viewports = argv[++i] ?? '';
    else if (argv[i] === '--wait') wait = Number(argv[++i]);
    else if (outDir === undefined) outDir = argv[i];
    else routes.push(argv[i]);
  }
  const sizes = viewports.split(',').map((v) => /^(\d+)x(\d+)$/.exec(v.trim()));
  if (!outDir || !routes.length || sizes.some((s) => !s) || !Number.isFinite(wait)) {
    throw Object.assign(new Error('usage: shots.mjs <out-dir> <route>... [--viewports 390x844,1280x800] [--wait 5000]'), { code: 2 });
  }
  return { outDir: path.resolve(outDir), routes, sizes: sizes.map((s) => [Number(s[1]), Number(s[2])]), wait };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg, code = 1) => Object.assign(new Error(msg), { code });

async function launch(browser) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-profile-'));
  const flags = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'];
  const proc = spawn(browser.exe, [...browser.args, ...flags], { stdio: 'ignore', windowsHide: true, detached: process.platform !== 'win32' });
  let exited = false;
  proc.on('exit', () => (exited = true));
  proc.on('error', () => (exited = true));
  const cleanup = async () => {
    if (!exited && proc.pid) {
      for (let i = 0; i < 30 && !exited; i++) await sleep(100);
      if (!exited) await killTree(proc.pid);
    }
    for (let i = 0; i < 5; i++) {
      try {
        fs.rmSync(profile, { recursive: true, force: true });
        break;
      } catch {
        await sleep(200);
      }
    }
  };
  const portFile = path.join(profile, 'DevToolsActivePort');
  const limit = Date.now() + (Number(process.env.E2E_START_TIMEOUT_MS) || 15000);
  while (!fs.existsSync(portFile) && !exited && Date.now() < limit) await sleep(100);
  const [port, wsPath] = fs.existsSync(portFile) ? fs.readFileSync(portFile, 'utf8').split(/\r?\n/) : [];
  try {
    if (!port || !wsPath) throw new Error('no port');
    return { cdp: await connect(`ws://127.0.0.1:${port}${wsPath}`), cleanup };
  } catch {
    if (proc.pid && !exited) await killTree(proc.pid);
    await cleanup();
    throw fail('e2e: browser did not start');
  }
}

async function openPage(cdp) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const net = { inflight: 0, last: Date.now(), loaded: null };
  cdp.on((method, _p, sid) => {
    if (sid !== sessionId) return;
    if (method === 'Network.requestWillBeSent') net.inflight++;
    else if (method === 'Network.loadingFinished' || method === 'Network.loadingFailed') net.inflight = Math.max(0, net.inflight - 1);
    else if (method === 'Page.loadEventFired') return net.loaded?.();
    else return;
    net.last = Date.now();
  });
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Network.enable', {}, sessionId);
  return { net, send: (m, p) => cdp.send(m, p, sessionId) };
}

async function shoot(page, url, file, [w, h], wait) {
  try {
    await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 768 });
    const { net } = page;
    net.inflight = 0;
    const loaded = new Promise((r) => (net.loaded = r));
    const nav = await page.send('Page.navigate', { url });
    if (nav.errorText) return false;
    let timer;
    const timeout = new Promise((r) => (timer = setTimeout(r, 30000, 'timeout')));
    const outcome = await Promise.race([loaded, timeout]);
    clearTimeout(timer);
    if (outcome === 'timeout') return false;
    net.last = Date.now();
    const end = Date.now() + wait;
    while (Date.now() < end && !(net.inflight === 0 && Date.now() - net.last >= 500)) await sleep(50);
    const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
    if (!data) return false;
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    return fs.statSync(file).size > 0;
  } catch {
    return false;
  }
}

async function main() {
  let session;
  try {
    const { outDir, routes, sizes, wait } = parseArgs(process.argv.slice(2));
    const rewritten = routes.find((r) => /^[A-Za-z]:[\/]/.test(r));
    if (rewritten !== undefined) {
      throw Object.assign(new Error(`e2e: route "${rewritten}" looks like a path Git Bash rewrote; run with MSYS_NO_PATHCONV=1 or pass a full http(s):// address`), { code: 2 });
    }
    const cfg = loadE2e(projectRoot(process.cwd()));
    const browser = findBrowser(cfg);
    fs.mkdirSync(outDir, { recursive: true });
    const urls = routes.map((route) => {
      if (/^https?:\/\//.test(route)) return route;
      if (!cfg.baseUrl) throw Object.assign(new Error('.claude/ai-dev-team.json: e2e.baseUrl is not set'), { code: 2 });
      return cfg.baseUrl.replace(/\/+$/, '') + (route.startsWith('/') ? '' : '/') + route;
    });
    session = await launch(browser);
    const page = await openPage(session.cdp);
    for (const [i, route] of routes.entries()) {
      for (const size of sizes) {
        const file = path.join(outDir, `${slugFor(route)}@${size[0]}x${size[1]}.png`);
        fs.rmSync(file, { force: true });
        if (!(await shoot(page, urls[i], file, size, wait))) throw fail(`e2e: no screenshot for ${urls[i]}`);
        process.stdout.write(`${file}\n`);
      }
    }
  } catch (e) {
    process.exitCode = typeof e.code === 'number' ? e.code : 2;
    process.stderr.write(`${e.message}\n`);
  } finally {
    if (session) {
      await session.cdp.send('Browser.close').catch(() => {});
      session.cdp.close();
      await session.cleanup();
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
