import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectRoot, loadConfig } from './lib/project.mjs';

const clean = (text) => text.replace(/\x1b\[[0-9;]*m/g, '').replace(/\r/g, '');

export function parseOutput(text, format) {
  const lines = clean(text).split('\n');
  if (format === 'dotnet') {
    let total = 0;
    let passed = 0;
    let failed = 0;
    let seen = false;
    for (const l of lines) {
      if (!/\bTotal:\s*\d+/.test(l)) continue;
      seen = true;
      const num = (k) => Number(new RegExp(`${k}:\\s*(\\d+)`).exec(l)?.[1] ?? 0);
      total += num('Total');
      passed += num('Passed');
      failed += num('Failed');
    }
    if (!seen) return null;
    const failures = lines.map((l) => /^\s*Failed (\S+)/.exec(l)?.[1]).filter(Boolean);
    return { total, passed, failed, failures: [...new Set(failures)] };
  }
  if (format === 'vitest') {
    const line = lines.find((l) => /^\s*Tests\s+.*\(\d+\)/.test(l));
    if (!line) return null;
    const num = (re) => Number(re.exec(line)?.[1] ?? 0);
    const failures = lines.map((l) => /^\s*FAIL\s+(.+?)\s*$/.exec(l)?.[1]).filter(Boolean);
    return { total: num(/\((\d+)\)/), passed: num(/(\d+) passed/), failed: num(/(\d+) failed/), failures: [...new Set(failures)] };
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function tryLink(file) {
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  fs.writeFileSync(tmp, String(process.pid));
  try {
    fs.linkSync(tmp, file);
    return true;
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    return false;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function readHolder(file) {
  try {
    return { pid: Number.parseInt(fs.readFileSync(file, 'utf8'), 10), mtime: fs.statSync(file).mtimeMs };
  } catch {
    return null;
  }
}

function takeOver(file, stalePid) {
  const moved = `${file}.${process.pid}.stale`;
  try {
    fs.renameSync(file, moved);
  } catch {
    return;
  }
  const now = readHolder(moved);
  fs.rmSync(moved, { force: true });
  if (now && now.pid !== stalePid && Number.isInteger(now.pid) && alive(now.pid)) {
    try {
      fs.writeFileSync(`${moved}.new`, String(now.pid));
      fs.linkSync(`${moved}.new`, file);
    } catch {}
    fs.rmSync(`${moved}.new`, { force: true });
  }
}

export async function acquireLock(file, { pollMs = 2000, timeoutMs = 30 * 60 * 1000, onWait } = {}) {
  const deadline = Date.now() + timeoutMs;
  let announced = false;
  for (;;) {
    if (tryLink(file)) {
      return () => {
        try {
          if (fs.readFileSync(file, 'utf8').trim() === String(process.pid)) fs.unlinkSync(file);
        } catch {}
      };
    }
    const h = readHolder(file);
    if (h && Number.isInteger(h.pid) && h.pid > 0 && !alive(h.pid)) {
      takeOver(file, h.pid);
      continue;
    }
    if (h && !(h.pid > 0) && Date.now() - h.mtime > 10000) {
      takeOver(file, h.pid);
      continue;
    }
    if (Date.now() >= deadline) throw new Error('timed out waiting for the test lock');
    if (!announced && h) {
      announced = true;
      onWait?.(h.pid);
    }
    await sleep(pollMs);
  }
}

function fail(message) {
  process.stderr.write(`guardrails: ${message}\n`);
  process.exit(2);
}

function readTestConfig(cfg, kind) {
  const bad = (m) => fail(`.claude/ai-dev-team.json: ${m}`);
  if (cfg.testLock !== undefined && typeof cfg.testLock !== 'boolean') bad('testLock must be true or false');
  if (cfg.tests === null || typeof cfg.tests !== 'object' || Array.isArray(cfg.tests)) {
    if (cfg.tests !== undefined) bad('tests must be an object');
  }
  const kinds = Object.keys(cfg.tests ?? {});
  const t = cfg.tests?.[kind];
  if (!Object.hasOwn(cfg.tests ?? {}, kind)) fail(`no tests.${kind} in .claude/ai-dev-team.json (known: ${kinds.join(', ') || 'none'})`);
  if (t === null || typeof t !== 'object' || typeof t.command !== 'string' || t.command === '') bad(`tests.${kind}.command must be a string`);
  for (const k of ['cwd', 'format', 'buildError']) if (t[k] !== undefined && typeof t[k] !== 'string') bad(`tests.${kind}.${k} must be a string`);
  let buildError = null;
  if (t.buildError) {
    try {
      buildError = new RegExp(t.buildError);
    } catch (e) {
      bad(`tests.${kind}.buildError is not a valid regex: ${e.message}`);
    }
  }
  return { command: t.command, cwd: t.cwd ?? '', format: t.format ?? '', buildError, lock: cfg.testLock === true };
}

function runCommand(command, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, { shell: true, cwd });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('error', (e) => resolve({ code: 1, out: `${out}${e.message}\n` }));
    child.on('close', (code) => resolve({ code: code ?? 1, out }));
  });
}

function summarize({ code, out }, t) {
  const text = clean(out);
  const lines = text.split('\n');
  if (code !== 0 && t.buildError) {
    const hits = lines.filter((l) => t.buildError.test(l));
    if (hits.length) return { text: ['BUILD FAILED', ...hits.slice(0, 10)].join('\n'), code };
  }
  const r = parseOutput(text, t.format);
  if (r && r.total === 0) return { text: 'NO TESTS RAN (does the filter match a test?)', code: 1 };
  if (r && code === 0) return { text: `PASS ${r.passed}/${r.total}`, code: 0 };
  if (r) return { text: [`FAIL ${r.failed}/${r.total}`, ...r.failures.slice(0, 20).map((f) => `  ✗ ${f}`)].join('\n'), code: code || 1 };
  return { text: lines.join('\n').trimEnd().split('\n').slice(-30).join('\n'), code };
}

async function main() {
  const [kind, filter] = process.argv.slice(2);
  if (!kind || filter === undefined) fail('usage: scoped-test.mjs <kind> <filter>');
  const root = projectRoot(process.cwd());
  let t;
  try {
    t = readTestConfig(loadConfig(root), kind);
  } catch (e) {
    fail(e.message);
  }
  let release = () => {};
  if (t.lock) {
    release = await acquireLock(path.join(os.tmpdir(), 'ai-dev-team-tests.lock'), {
      onWait: (pid) => process.stdout.write(`waiting for the test lock (pid ${pid})\n`),
    }).catch((e) => fail(e.message));
    process.on('exit', release);
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));
  }
  const result = await runCommand(t.command.replaceAll('{filter}', () => filter), path.join(root, t.cwd));
  release();
  const s = summarize(result, t);
  process.stdout.write(`${s.text}\n`);
  process.exitCode = s.code;
}

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url))) await main();
