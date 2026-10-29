#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadE2e } from './lib/config.mjs';
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
  return { outDir: path.resolve(outDir), routes, sizes: sizes.map((s) => [s[1], s[2]]), wait };
}

function shoot(browser, url, file, [w, h], wait) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-profile-'));
  const flags = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', `--user-data-dir=${profile}`, `--window-size=${w},${h}`, `--virtual-time-budget=${wait}`, `--screenshot=${file}`, url];
  spawnSync(browser.exe, [...browser.args, ...flags], { stdio: 'ignore', windowsHide: true, timeout: wait + 60000 });
  try {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {}
  return isFile(file) && fs.statSync(file).size > 0;
}

function main() {
  try {
    const { outDir, routes, sizes, wait } = parseArgs(process.argv.slice(2));
    const cfg = loadE2e(projectRoot(process.cwd()));
    const browser = findBrowser(cfg);
    fs.mkdirSync(outDir, { recursive: true });
    for (const route of routes) {
      let url = route;
      if (!/^https?:\/\//.test(route)) {
        if (!cfg.baseUrl) throw Object.assign(new Error('.claude/ai-dev-team.json: e2e.baseUrl is not set'), { code: 2 });
        url = cfg.baseUrl.replace(/\/+$/, '') + (route.startsWith('/') ? '' : '/') + route;
      }
      for (const size of sizes) {
        const file = path.join(outDir, `${slugFor(route)}@${size[0]}x${size[1]}.png`);
        fs.rmSync(file, { force: true });
        if (!shoot(browser, url, file, size, wait)) throw Object.assign(new Error(`e2e: no screenshot for ${url}`), { code: 1 });
        process.stdout.write(`${file}\n`);
      }
    }
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exit(typeof e.code === 'number' ? e.code : 2);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
