#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadE2e } from './lib/config.mjs';
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

function alive(pid) {
  try {
    process.kill(process.platform === 'win32' ? pid : -pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function killTree(pid) {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    return;
  }
  for (let i = 0; i < 20 && alive(pid); i++) await sleep(100);
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {}
}

function stateFiles(root) {
  const key = crypto.createHash('sha1').update(root).digest('hex').slice(0, 12);
  const dir = path.join(os.tmpdir(), 'ai-dev-team-e2e', key);
  return { dir, file: path.join(dir, 'state.json') };
}

function readState(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { started: [] };
  }
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
    await killTree(p.pid);
    stopped.push(p.name);
  }
  st.started = st.started.filter((x) => names && !names.includes(x.name));
  return stopped;
}

async function up(root, cfg, st, paths) {
  if (!cfg.baseUrl) throw new Error('.claude/ai-dev-team.json: e2e.baseUrl is not set');
  fs.mkdirSync(paths.dir, { recursive: true });
  const mine = [];
  const fail = async (msg) => {
    process.stderr.write(`${msg}\n`);
    await stopAll(st, mine);
    fs.writeFileSync(paths.file, JSON.stringify(st));
    process.exit(1);
  };
  for (const e of cfg.boot) {
    if (await isReady(e.ready)) {
      out(`reuse ${e.name}`);
      continue;
    }
    if (!e.command) await fail(`e2e: ${e.name} not ready at ${e.ready} and has no command; start it first`);
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
    st.started = st.started.filter((x) => x.name !== e.name);
    st.started.push({ name: e.name, pid: child.pid });
    mine.push(e.name);
    fs.writeFileSync(paths.file, JSON.stringify(st));
    const deadline = Date.now() + cfg.timeoutSec * 1000;
    let ready = false;
    while (!ready && !exited && Date.now() < deadline) {
      await sleep(500);
      ready = await isReady(e.ready);
    }
    if (!ready) {
      const why = exited ? 'exited before ready' : `not ready after ${cfg.timeoutSec}s`;
      await fail(`e2e: ${e.name} ${why}; last log lines:\n${logTail(log)}`);
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
    cfg = loadE2e(root);
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
    if (!stopped.length) out('e2e: nothing to stop');
    for (const n of stopped) out(`stopped ${n}`);
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
