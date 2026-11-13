import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLocalConfig, projectRoot } from './lib/project.mjs';
import { failingTests, ranNoTest } from './lib/runner.mjs';

export function mutateLine(text, lineNo, replacement) {
  const parts = text === '' ? [] : text.split(/(?<=\n)/);
  if (!Number.isInteger(lineNo) || lineNo < 1 || lineNo > parts.length) {
    throw new Error(`line ${lineNo} is out of range (the file has ${parts.length} lines)`);
  }
  const eol = /\r?\n$/.exec(parts[lineNo - 1])?.[0] ?? '';
  parts[lineNo - 1] = replacement + eol;
  return parts.join('');
}

function fail(message) {
  process.stderr.write(`review: ${message}\n`);
  process.exit(2);
}

function readTest(cfg, kind) {
  const bad = (m) => fail(`.claude/ai-dev-team.json: ${m}`);
  if (cfg.tests !== undefined && (cfg.tests === null || typeof cfg.tests !== 'object' || Array.isArray(cfg.tests))) bad('tests must be an object');
  const kinds = Object.keys(cfg.tests ?? {});
  if (!Object.hasOwn(cfg.tests ?? {}, kind)) fail(`no tests.${kind} in .claude/ai-dev-team.json (known: ${kinds.join(', ') || 'none'})`);
  const t = cfg.tests[kind];
  if (t === null || typeof t !== 'object' || typeof t.command !== 'string' || t.command === '') bad(`tests.${kind}.command must be a string`);
  for (const k of ['cwd', 'buildError']) if (t[k] !== undefined && typeof t[k] !== 'string') bad(`tests.${kind}.${k} must be a string`);
  let buildError = null;
  if (t.buildError) {
    try {
      buildError = new RegExp(t.buildError);
    } catch (e) {
      bad(`tests.${kind}.buildError is not a valid regex: ${e.message}`);
    }
  }
  for (const k of ['format', 'nameArg']) if (t[k] !== undefined && typeof t[k] !== 'string') bad(`tests.${kind}.${k} must be a string`);
  if (t.nameArg !== undefined && !t.nameArg.includes('{name}')) bad(`tests.${kind}.nameArg must contain {name}`);
  if (t.env !== undefined && (t.env === null || typeof t.env !== 'object' || Array.isArray(t.env) || !Object.values(t.env).every((v) => typeof v === 'string'))) bad(`tests.${kind}.env must be an object of strings`);
  return { command: t.command, cwd: t.cwd ?? '', buildError, format: t.format, nameArg: t.nameArg, env: t.env };
}

let current = null;

function runCommand(command, cwd, env) {
  return new Promise((resolve) => {
    const child = spawn(command, { shell: true, cwd, env: { ...process.env, ...env } });
    current = child;
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('error', (e) => resolve({ code: 1, out: `${out}${e.message}\n` }));
    child.on('close', (code) => resolve({ code: code ?? 1, out }));
  });
}

async function main() {
  const args = process.argv.slice(2);
  const val = (n) => {
    const i = args.indexOf(n);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
  };
  const [file, line, kind, test, replaceArg, replaceFile, testName] = ['--file', '--line', '--kind', '--test', '--replace', '--replace-file', '--test-name'].map(val);
  if (file === undefined || line === undefined || kind === undefined || test === undefined) {
    fail('usage: mutate-check.mjs --file <path> --line <n> [--replace <text> | --replace-file <path>] --kind <tests key> --test <filter> [--test-name <name>]  (<filter> replaces {filter} in tests.<kind>.command; <name> replaces {name} in tests.<kind>.nameArg)');
  }
  if (replaceArg !== undefined && replaceFile !== undefined) fail('--replace and --replace-file cannot be combined');
  let replace = replaceArg;
  if (replaceFile !== undefined) {
    if (!fs.existsSync(replaceFile) || !fs.statSync(replaceFile).isFile()) fail(`replace file not found: ${replaceFile}`);
    replace = fs.readFileSync(replaceFile, 'utf8').replace(/^\uFEFF/, '').replace(/\r?\n$/, '');
    if (/[\r\n]/.test(replace)) fail('--replace-file must hold exactly one line');
  }
  if (!/^\d+$/.test(line) || Number(line) < 1) fail('--line must be a positive integer');
  const root = projectRoot(process.cwd());
  let t;
  try {
    t = readTest(loadLocalConfig(root), kind);
  } catch (e) {
    fail(e.message);
  }
  if (testName !== undefined && t.nameArg === undefined) fail('--test-name needs tests.' + kind + '.nameArg');
  if (testName !== undefined && /["`$%]/.test(testName)) fail('--test-name may not contain " ` $ %: pass a part of the name');
  const target = path.resolve(root, file);
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) fail(`file not found: ${file}`);
  const original = fs.readFileSync(target);
  const text = original.toString('utf8');
  let mutant;
  try {
    mutant = mutateLine(text, Number(line), replace ?? '');
  } catch (e) {
    fail(e.message);
  }
  const oldLine = text.split(/(?<=\n)/)[Number(line) - 1].replace(/\r?\n$/, '');
  const newLine = replace ?? '';
  const command = t.command.replaceAll('{filter}', () => test) + (testName === undefined ? '' : ` ${t.nameArg.replaceAll('{name}', () => testName)}`);
  const cwd = path.join(root, t.cwd);
  const say = (verdict, withDiff = true, code = 1, note = []) => {
    process.stdout.write(`${[...(withDiff ? [`- ${oldLine}`, `+ ${newLine}`] : []), ...note, verdict].join('\n')}\n`);
    process.exitCode = code;
  };

  const baseline = await runCommand(command, cwd, t.env);
  if (ranNoTest(baseline.out)) return say(`INVALID: no test ran: --test is the value put in place of {filter} in: ${command}`, false);
  if (baseline.code !== 0) {
    const names = failingTests(baseline.out, t.format);
    return say(`INVALID: the test fails before the line is broken${names.length ? ` (failing: ${names.join(', ')})` : ''}`, false);
  }

  const restore = () => {
    for (let i = 0; ; i++) {
      try {
        return void fs.writeFileSync(target, original);
      } catch (e) {
        if (i >= 4) return e;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
      }
    }
  };
  const onSignal = () => {
    if (current?.pid) {
      if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(current.pid), '/T', '/F']);
      else current.kill();
    }
    if (restore()) process.stderr.write(`review: file NOT restored: ${target}\n`);
    process.exit(130);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  let broken;
  let err;
  try {
    fs.writeFileSync(target, mutant);
    broken = await runCommand(command, cwd, t.env);
  } finally {
    err = restore();
  }
  if (err) return say(`INVALID: file not restored (${target}): ${err.code ?? err.message}`, false);
  if (!fs.readFileSync(target).equals(original)) return say('INVALID: file not restored');

  if (broken.code === 0) return say('NOT GUARDED: the test still passes with this line broken - check that --test matches a test');
  if (t.buildError && broken.out.split(/\r?\n/).some((l) => t.buildError.test(l))) {
    return say('INVALID: build broke, not the test: use --replace with code that compiles');
  }
  const after = await runCommand(command, cwd, t.env);
  if (after.code !== 0) return say('INVALID: the test fails after restoring the file');
  say('GUARDED', true, 0, t.buildError ? [] : [`note: no buildError configured for ${kind} — a build break would look like GUARDED`]);
}

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url))) await main();
