#!/usr/bin/env node
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBrowser } from './lib/config.mjs';
import { killTree, ours } from './lib/proc.mjs';
import { projectRoot } from './lib/project.mjs';

const SUPERVISE = fileURLToPath(new URL('./supervise.mjs', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (s) => process.stdout.write(`${s}\n`);

function tcpReady(url) {
  const u = new URL(url);
  return new Promise((resolve) => {
    const s = net.connect({ host: u.hostname, port: Number(u.port) });
    const done = (v) => (s.destroy(), resolve(v));
    s.setTimeout(1000, () => done(false));
    s.on('connect', () => done(true));
    s.on('error', () => done(false));
  });
}

async function isReady(url) {
  if (url.startsWith('tcp://')) return tcpReady(url);
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(1500), redirect: 'manual' });
    return r.status < 400;
  } catch {
    return false;
  }
}

function stateFiles(root) {
  const key = crypto.createHash('sha1').update(root).digest('hex').slice(0, 12);
  const dir = path.join(os.tmpdir(), 'ai-dev-team-browser', key);
  return { dir, file: path.join(dir, 'state.json') };
}

const bootTime = () => Math.round(Date.now() / 1000 - os.uptime());

function readState(file) {
  try {
    const st = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Math.abs(st.boot - bootTime()) <= 5 && Array.isArray(st.started)) return st;
  } catch {}
  return { started: [] };
}

function save(st, file) {
  fs.writeFileSync(file, JSON.stringify({ ...st, boot: bootTime() }));
}

function logTail(log) {
  const parts = [];
  const buf = Buffer.alloc(65536);
  try {
    const fd = fs.openSync(log, 'r');
    for (let n; (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0; ) parts.push(Buffer.from(buf.subarray(0, n)));
    fs.closeSync(fd);
  } catch {}
  const text = Buffer.concat(parts).toString('utf8');
  return text.split(/\r?\n/).filter(Boolean).slice(-20).join('\n');
}

async function stopAll(st, names) {
  const stopped = [];
  for (const p of [...st.started].filter((x) => !names || names.includes(x.name))) {
    if (ours(p.pid)) {
      await killTree(p.pid);
      stopped.push(`stopped ${p.name}`);
    } else stopped.push(`gone ${p.name}`);
  }
  st.started = st.started.filter((x) => names && !names.includes(x.name));
  return stopped;
}

async function up(root, cfg, st, paths) {
  if (!cfg.baseUrl) throw new Error('.claude/ai-dev-team.json: browser.baseUrl is not set');
  fs.mkdirSync(paths.dir, { recursive: true });
  const mine = [];
  const fail = async (msg) => {
    process.stderr.write(`${msg}\n`);
    await stopAll(st, mine);
    save(st, paths.file);
    process.exit(1);
  };
  for (const e of cfg.boot) {
    if (await isReady(e.ready)) {
      out(`reuse ${e.name}`);
      st.started = st.started.filter((x) => x.name !== e.name || ours(x.pid));
      save(st, paths.file);
      continue;
    }
    if (!e.command) await fail(`browser: ${e.name} not ready at ${e.ready} and has no command; start it first`);
    for (const old of st.started.filter((x) => x.name === e.name)) if (ours(old.pid)) await killTree(old.pid);
    st.started = st.started.filter((x) => x.name !== e.name);
    const log = path.join(paths.dir, `${e.name}.log`);
    const child = spawn(process.execPath, [SUPERVISE, log, e.command, e.cwd ? path.resolve(root, e.cwd) : root], {
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
      env: { ...process.env, ...e.env },
    });
    let exited = false;
    child.on('exit', () => (exited = true));
    child.unref();
    st.started.push({ name: e.name, pid: child.pid });
    mine.push(e.name);
    save(st, paths.file);
    const deadline = Date.now() + cfg.timeoutSec * 1000;
    let ready = false;
    while (!ready && !exited && Date.now() < deadline) {
      await sleep(500);
      ready = await isReady(e.ready);
    }
    if (!ready) {
      const why = exited ? 'exited before ready' : `not ready after ${cfg.timeoutSec}s`;
      await fail(`browser: ${e.name} ${why}; last log lines:\n${logTail(log)}`);
    }
    out(`ready ${e.name} ${e.ready}`);
  }
  out(`base ${cfg.baseUrl}`);
}

async function main() {
  const [cmd] = process.argv.slice(2);
  if (!['up', 'down', 'status'].includes(cmd)) {
    process.stderr.write('usage: app.mjs up|down|status\n');
    process.exit(2);
  }
  const root = projectRoot(process.cwd());
  let cfg;
  try {
    cfg = loadBrowser(root);
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exit(2);
  }
  const paths = stateFiles(root);
  const st = readState(paths.file);
  if (cmd === 'status') {
    for (const e of cfg.boot) out(`${e.name} ${(await isReady(e.ready)) ? 'ready' : 'down'} ${e.ready}`);
  } else if (cmd === 'down') {
    const stopped = await stopAll(st);
    fs.rmSync(paths.file, { force: true });
    if (!stopped.length) out('browser: nothing to stop');
    for (const l of stopped) out(l);
  } else {
    try {
      await up(root, cfg, st, paths);
    } catch (e) {
      process.stderr.write(`${e.message}\n`);
      process.exit(2);
    }
  }
}

await main();
