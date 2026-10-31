#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail, findBrowser, launch, openPage, shoot } from './lib/browser.mjs';
import { loadBrowser } from './lib/config.mjs';
import { projectRoot } from './lib/project.mjs';

function slugFor(route) {
  let p = route;
  if (/^https?:\/\//.test(p)) p = new URL(p).pathname;
  p = p.split(/[?#]/)[0].toLowerCase();
  const slug = p.split('/').filter(Boolean).join('-').replace(/[^a-z0-9-]/g, '-');
  return slug || 'root';
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

async function main() {
  let session;
  try {
    const { outDir, routes, sizes, wait } = parseArgs(process.argv.slice(2));
    const rewritten = routes.find((r) => /^[A-Za-z]:[\\/]/.test(r));
    if (rewritten !== undefined) {
      throw Object.assign(new Error(`browser: route "${rewritten}" looks like a path Git Bash rewrote; run with MSYS_NO_PATHCONV=1 or pass a full http(s):// address`), { code: 2 });
    }
    const cfg = loadBrowser(projectRoot(process.cwd()));
    const browser = findBrowser(cfg);
    fs.mkdirSync(outDir, { recursive: true });
    const urls = routes.map((route) => {
      if (/^https?:\/\//.test(route)) return route;
      if (!cfg.baseUrl) throw Object.assign(new Error('.claude/ai-dev-team.json: browser.baseUrl is not set'), { code: 2 });
      return cfg.baseUrl.replace(/\/+$/, '') + (route.startsWith('/') ? '' : '/') + route;
    });
    session = await launch(browser);
    for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
      process.on(sig, () => session.shutdown().finally(() => process.exit(code)));
    }
    const page = await openPage(session.cdp);
    for (const [i, route] of routes.entries()) {
      for (const size of sizes) {
        const file = path.join(outDir, `${slugFor(route)}@${size[0]}x${size[1]}.png`);
        fs.rmSync(file, { force: true });
        if (!(await shoot(page, urls[i], file, size, wait))) throw fail(`browser: no screenshot for ${urls[i]}`);
        process.stdout.write(`${file}\n`);
      }
    }
  } catch (e) {
    process.exitCode = typeof e.code === 'number' ? e.code : 2;
    process.stderr.write(`${e.message}\n`);
  } finally {
    if (session) {
      await session.shutdown();
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
