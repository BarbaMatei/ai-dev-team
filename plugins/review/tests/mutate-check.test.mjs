import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { base, cleanEnv, repo, run as runScript } from './helpers.mjs';
import { mutateLine } from '../scripts/mutate-check.mjs';

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'mutate-check.mjs');
after(() => fs.rmSync(base, { recursive: true, force: true }));

const check = [
  "import fs from 'node:fs';",
  "const l = fs.readFileSync('src.txt', 'utf8').split(/\\r?\\n/);",
  "if (l[1] === '') console.log('BUILD BROKE');",
  "process.exit(l[1] === 'keep' ? 0 : 1);",
  '',
].join('\n');

const proj = (src, tests = { t: { command: 'node check.mjs' } }, extra = {}) =>
  repo({ 'check.mjs': check, 'src.txt': src, ...extra }, { tests });
const base4 = ['--kind', 't', '--test', 'x', '--file', 'src.txt'];
const mc = (dir, args) => runScript(script, dir, [...base4, ...args]);
const read = (dir) => fs.readFileSync(path.join(dir, 'src.txt'));

test('mutateLine keeps CRLF, a missing final newline and every other byte', () => {
  assert.equal(mutateLine('a\r\nb\r\n', 2, 'x'), 'a\r\nx\r\n');
  assert.equal(mutateLine('a\nb\nc', 3, ''), 'a\nb\n');
  assert.equal(mutateLine('a\nb\nc', 1, 'z'), 'z\nb\nc');
});

test('mutateLine throws on an out-of-range line', () => {
  assert.throws(() => mutateLine('a\nb\n', 9, ''), /line/);
  assert.throws(() => mutateLine('a\nb\n', 3, ''), /line/);
  assert.throws(() => mutateLine('', 1, ''), /line/);
});

test('a guarded line gives GUARDED and the file is byte-identical', () => {
  const dir = proj('one\nkeep\nthree\n');
  const before = read(dir);
  const r = mc(dir, ['--line', '2']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.deepEqual(r.out.split('\n'), ['GUARDED', '- keep', '+ ', 'note: no buildError configured for t — a build break would look like GUARDED', '']);
  assert.deepEqual(read(dir), before);
});

test('--replace puts the given text on the line', () => {
  const dir = proj('one\nkeep\nthree\n');
  const r = mc(dir, ['--line', '2', '--replace', 'broken']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.deepEqual(r.out.trimEnd().split('\n'), ['GUARDED', '- keep', '+ broken', 'note: no buildError configured for t — a build break would look like GUARDED']);
});

test('an unguarded line gives NOT GUARDED with the hint', () => {
  const dir = proj('one\nkeep\nthree\n');
  const r = mc(dir, ['--line', '1']);
  assert.equal(r.code, 1);
  assert.match(r.out, /^NOT GUARDED: the test still passes with this line broken - check that --test matches a test$/m);
  assert.ok(r.out.trim().split('\n').length <= 5);
  assert.equal(read(dir).toString(), 'one\nkeep\nthree\n');
});

test('a mutant that breaks the build gives INVALID naming the build', () => {
  const dir = proj('one\nkeep\nthree\n', { t: { command: 'node check.mjs', buildError: 'BUILD BROKE' } });
  const r = mc(dir, ['--line', '2']);
  assert.equal(r.code, 1);
  assert.match(r.out, /^INVALID: build broke, not the test: use --replace with code that compiles$/m);
  assert.equal(read(dir).toString(), 'one\nkeep\nthree\n');
});

test('a failing baseline gives INVALID and the file is never touched', () => {
  const dir = proj('one\nnope\nthree\n');
  const r = mc(dir, ['--line', '2']);
  assert.equal(r.code, 1);
  assert.match(r.out, /^INVALID: /);
  assert.equal(read(dir).toString(), 'one\nnope\nthree\n');
});

test('a CRLF file is restored byte-identical and CR is not shown', () => {
  const dir = proj('one\r\nkeep\r\nthree');
  const before = read(dir);
  const r = mc(dir, ['--line', '2']);
  assert.equal(r.code, 0, r.out + r.err);
  assert.ok(!r.out.includes('\r'));
  assert.deepEqual(read(dir), before);
});

test('a missing test command gives INVALID and the file is intact', () => {
  const dir = proj('one\nkeep\nthree\n', { t: { command: 'node does-not-exist.mjs' } });
  const r = mc(dir, ['--line', '2']);
  assert.equal(r.code, 1);
  assert.match(r.out, /^INVALID/);
  assert.equal(read(dir).toString(), 'one\nkeep\nthree\n');
});

test('a test that fails after the file is restored gives INVALID', () => {
  const flaky = [
    "import fs from 'node:fs';",
    "const n = fs.existsSync('count') ? Number(fs.readFileSync('count', 'utf8')) : 0;",
    "fs.writeFileSync('count', String(n + 1));",
    'process.exit(n === 0 ? 0 : 1);',
    '',
  ].join('\n');
  const dir = proj('one\nkeep\nthree\n', undefined, { 'check.mjs': flaky });
  const r = mc(dir, ['--line', '2']);
  assert.equal(r.code, 1);
  assert.match(r.out, /^INVALID: the test fails after restoring the file$/m);
  assert.equal(read(dir).toString(), 'one\nkeep\nthree\n');
});

test('bad arguments and config give one review: line, exit 2, file untouched', () => {
  const dir = proj('one\nkeep\n');
  const cases = [
    ['--kind', 't', '--test', 'x', '--file', 'src.txt'],
    ['--kind', 't', '--test', 'x', '--file', 'src.txt', '--line', 'x'],
    ['--kind', 't', '--test', 'x', '--file', 'src.txt', '--line', '0'],
    ['--kind', 't', '--test', 'x', '--file', 'src.txt', '--line', '9'],
    ['--kind', 't', '--test', 'x', '--file', 'nope.txt', '--line', '1'],
    ['--kind', 'zzz', '--test', 'x', '--file', 'src.txt', '--line', '1'],
    ['--test', 'x', '--file', 'src.txt', '--line', '1'],
    ['--kind', 't', '--file', 'src.txt', '--line', '1'],
  ];
  for (const args of cases) {
    const r = runScript(script, dir, args);
    assert.equal(r.code, 2, `${args} ${r.out}${r.err}`);
    assert.match(r.err, /^review: [^\n]+\n$/);
  }
  assert.equal(read(dir).toString(), 'one\nkeep\n');
  const bad = repo({ 'src.txt': 'a\n' }, '{nope');
  const r = runScript(script, bad, base4.concat(['--line', '1']));
  assert.equal(r.code, 2);
  assert.match(r.err, /^review: \.claude\/ai-dev-team\.json: /);
});

test('SIGTERM mid-run restores the file', { skip: process.platform === 'win32' }, async () => {
  const slow = [
    "import fs from 'node:fs';",
    "const l = fs.readFileSync('src.txt', 'utf8').split('\\n');",
    "if (l[1] === '') await new Promise((r) => setTimeout(r, 3000));",
    'process.exit(0);',
    '',
  ].join('\n');
  const dir = proj('one\nkeep\nthree\n', undefined, { 'check.mjs': slow });
  const child = spawn(process.execPath, [script, ...base4, '--line', '2'], { cwd: dir, env: cleanEnv(), stdio: 'ignore' });
  const closed = new Promise((res) => child.on('close', (code) => res(code)));
  const file = path.join(dir, 'src.txt');
  for (let i = 0; i < 100 && fs.readFileSync(file, 'utf8') === 'one\nkeep\nthree\n'; i++) await new Promise((r) => setTimeout(r, 50));
  assert.equal(fs.readFileSync(file, 'utf8'), 'one\n\nthree\n');
  child.kill('SIGTERM');
  assert.equal(await closed, 130);
  assert.equal(fs.readFileSync(file, 'utf8'), 'one\nkeep\nthree\n');
});

test('a restore that cannot succeed reports INVALID: file not restored, no stack trace', () => {
  const swap = [
    "import fs from 'node:fs';",
    "const l = fs.readFileSync('src.txt', 'utf8').split('\\n');",
    "if (l[1] === '') { fs.rmSync('src.txt'); fs.mkdirSync('src.txt'); }",
    'process.exit(l[1] === "keep" ? 0 : 1);',
    '',
  ].join('\n');
  const dir = proj('one\nkeep\nthree\n', undefined, { 'check.mjs': swap });
  const r = mc(dir, ['--line', '2']);
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.out, /^INVALID: file not restored \(.*src\.txt\): \w+$/m);
  assert.ok(!/\n\s+at /.test(r.err), r.err);
});

test('scripts run through a symlinked or junctioned folder still do their work', () => {
  const link = path.join(base, 'scripts-link');
  fs.symlinkSync(path.dirname(script), link, 'junction');
  const dir = repo({ 'src.txt': 'a\n' }, {});
  const m = runScript(path.join(link, 'mutate-check.mjs'), dir, []);
  assert.equal(m.code, 2);
  assert.match(m.err, /^review: usage/);
  const d = runScript(path.join(link, 'decisions.mjs'), dir, []);
  assert.equal(d.out.trim(), 'no decisions file configured');
});

test('GUARDED without buildError carries the note, with buildError it does not', () => {
  const src = ['one', 'keep', 'three', ''].join('\n');
  const r = mc(proj(src), ['--line', '2']);
  assert.match(r.out, /^note: no buildError configured for t — a build break would look like GUARDED$/m);
  assert.ok(r.out.trim().split('\n').length <= 5);
  const r2 = mc(proj(src, { t: { command: 'node check.mjs', buildError: 'BUILD BROKE' } }), ['--line', '2', '--replace', 'x']);
  assert.ok(!r2.out.includes('note:'));
});
