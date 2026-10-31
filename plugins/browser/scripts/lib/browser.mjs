import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { connect } from './cdp.mjs';
import { killTree } from './proc.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PATH_NAMES = ['google-chrome', 'chromium', 'chromium-browser', 'msedge', 'chrome'];
const isFile = (p) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

const IGNORED = new Set(['EventSource', 'WebSocket']);
export const fail = (msg, code = 1) => Object.assign(new Error(msg), { code });

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
  if (cfg.exe) {
    const [exe, ...args] = Array.isArray(cfg.exe) ? cfg.exe : [cfg.exe];
    if (!isFile(exe)) throw Object.assign(new Error(`browser: browser.exe not found: ${exe}`), { code: 2 });
    return { exe, args };
  }
  const exe = [process.env.CHROME_PATH, ...standardPaths()].find((p) => p && isFile(p)) ?? onPath();
  if (!exe) throw Object.assign(new Error('browser: no Chromium-based browser found; set browser.exe'), { code: 2 });
  return { exe, args: [] };
}

export async function launch(browser) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-profile-'));
  const flags = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--disable-background-networking', '--disable-component-update', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'];
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
  const read = () => {
    try {
      const [port, wsPath] = fs.readFileSync(portFile, 'utf8').split(/\r?\n/);
      return port && wsPath ? [port, wsPath] : null;
    } catch {
      return null;
    }
  };
  const limit = Date.now() + (Number(process.env.BROWSER_START_TIMEOUT_MS) || 15000);
  let found = read();
  while (!found && !exited && Date.now() < limit) {
    await sleep(100);
    found = read();
  }
  try {
    if (!found) throw new Error('no port');
    const cdp = await connect(`ws://127.0.0.1:${found[0]}${found[1]}`);
    const shutdown = async () => {
      let timer;
      await Promise.race([cdp.send('Browser.close').catch(() => {}), new Promise((r) => (timer = setTimeout(r, 3000)))]);
      clearTimeout(timer);
      cdp.close();
      await cleanup();
    };
    return { cdp, shutdown };
  } catch {
    if (proc.pid && !exited) await killTree(proc.pid);
    await cleanup();
    throw fail('browser: browser did not start');
  }
}

export async function openPage(cdp) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const net = { open: new Set(), skip: new Set(), last: Date.now(), loaded: null };
  cdp.on((method, p, sid) => {
    if (sid !== sessionId) return;
    if (method === 'Network.requestWillBeSent') (IGNORED.has(p.type) ? net.skip : net.open).add(p.requestId);
    else if (method === 'Network.loadingFinished' || method === 'Network.loadingFailed') net.open.delete(p.requestId);
    else if (method === 'Page.loadEventFired') return net.loaded?.();
    else return;
    net.last = Date.now();
  });
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Network.enable', {}, sessionId);
  return { net, sessionId, closed: cdp.closed, send: (m, p) => cdp.send(m, p, sessionId) };
}

export async function shoot(page, url, file, [w, h], wait) {
  try {
    await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 768 });
    const { net } = page;
    net.open.clear();
    net.skip.clear();
    const loaded = new Promise((res, rej) => {
      net.loaded = res;
      page.closed.then(() => rej(new Error('connection closed')));
    });
    loaded.catch(() => {});
    const nav = await page.send('Page.navigate', { url });
    if (nav.errorText) return false;
    let timer;
    const timeout = new Promise((r) => (timer = setTimeout(r, 30000, 'timeout')));
    const outcome = await Promise.race([loaded, timeout]);
    clearTimeout(timer);
    if (outcome === 'timeout') return false;
    net.last = Date.now();
    const end = Date.now() + wait;
    while (Date.now() < end && !(net.open.size === 0 && Date.now() - net.last >= 500)) await sleep(50);
    const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
    if (!data) return false;
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    return fs.statSync(file).size > 0;
  } catch {
    return false;
  }
}
