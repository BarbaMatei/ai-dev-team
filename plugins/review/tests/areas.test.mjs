import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { base, git, put, repo, run as runScript } from './helpers.mjs';
import { loadAreas } from '../scripts/lib/project.mjs';

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'areas.mjs');
const run = (dir, ...args) => runScript(script, dir, args);
after(() => fs.rmSync(base, { recursive: true, force: true }));

const cfg = { areas: { auth: ['src/auth/*.ts'] }, triggers: ['pay'] };
const files = {
  '.claude/rules/pay.md': '---\npaths:\n  - "src/pay/**"\n---\n# Pay rules\n',
  'src/pay/seed.ts': 'x\n',
  'src/pay/b.ts': 'const a = Math.round(1.5);\n',
  'src/pay/dir with space/d.ts': 'd\n',
  'src/auth/seed.ts': 'x\n',
  'src/other/c.ts': 'const c = Math.round(2.5);\n',
};

test('touched lists the area, rule file and trigger', () => {
  const dir = repo(files, cfg);
  put(dir, 'src/pay/a.ts', 'a\n');
  git(dir, ['add', '-A']);
  const r = run(dir, 'touched');
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.out.trim().split('\n'), ['pay\t1 file(s)\t.claude/rules/pay.md', 'trigger: yes (pay)']);
});

test('touched with only a config area has no trigger and "-" rule file', () => {
  const dir = repo(files, cfg);
  put(dir, 'src/auth/x.ts', 'x\n');
  const r = run(dir, 'touched');
  assert.deepEqual(r.out.trim().split('\n'), ['auth\t1 file(s)\t-', 'trigger: no']);
});

test('untracked and unstaged changes count; outside-area files are not listed', () => {
  const dir = repo(files, cfg);
  put(dir, 'src/pay/new.ts', 'n\n');
  put(dir, 'src/pay/seed.ts', 'changed\n');
  put(dir, 'src/other/z.ts', 'z\n');
  const r = run(dir, 'touched');
  assert.deepEqual(r.out.trim().split('\n'), ['pay\t2 file(s)\t.claude/rules/pay.md', 'trigger: yes (pay)']);
});

test('touched diffs against an explicit base across commits', () => {
  const dir = repo(files, cfg);
  const baseSha = git(dir, ['rev-parse', 'HEAD']).trim();
  put(dir, 'src/pay/n.ts', 'n\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'more']);
  const r = run(dir, 'touched', '--base', baseSha);
  assert.match(r.out, /^pay\t1 file\(s\)/);
});

test('touched without any resolvable base exits 2', () => {
  const dir = repo(files, cfg);
  git(dir, ['branch', '-m', 'trunk']);
  const r = run(dir, 'touched');
  assert.equal(r.code, 2);
  assert.match(r.err, /review: cannot find a base; pass --base <ref>/);
});

test('files lists tracked files of the area, including spaced paths', () => {
  const dir = repo(files, cfg);
  put(dir, 'src/pay/untracked.ts', 'u\n');
  const r = run(dir, 'files', 'pay');
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.out.trim().split('\n').sort(), ['src/pay/b.ts', 'src/pay/dir with space/d.ts', 'src/pay/seed.ts']);
});

test('files with an unknown area exits 2 and lists known names', () => {
  const dir = repo(files, cfg);
  const r = run(dir, 'files', 'nope');
  assert.equal(r.code, 2);
  assert.match(r.err, /review: unknown area 'nope'; known: pay, auth/);
});

test('nearby splits matches into the touched area and elsewhere', () => {
  const dir = repo(files, cfg);
  put(dir, 'src/pay/a.ts', 'a\n');
  const r = run(dir, 'nearby', '--pattern', 'Math\\.round\\(');
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.out.trim().split('\n'), [
    'in bolt area (1):',
    'src/pay/b.ts:1: const a = Math.round(1.5);',
    'elsewhere (1):',
    'src/other/c.ts:1: const c = Math.round(2.5);',
  ]);
});

test('nearby skips binary and oversized files and reports spaced paths', () => {
  const dir = repo(files, cfg);
  put(dir, 'src/pay/dir with space/e.ts', 'Math.round(\n');
  fs.writeFileSync(path.join(dir, 'src', 'other', 'bin.dat'), Buffer.concat([Buffer.from([0]), Buffer.from('Math.round(')]));
  fs.writeFileSync(path.join(dir, 'src', 'other', 'big.txt'), 'Math.round(\n' + 'x'.repeat(1024 * 1024 + 1));
  const r = run(dir, 'nearby', '--pattern', 'Math\\.round\\(');
  assert.ok(r.out.includes('src/pay/dir with space/e.ts:1: Math.round('));
  assert.ok(!r.out.includes('bin.dat') && !r.out.includes('big.txt'));
});

test('nearby rejects an invalid regex with exit 2', () => {
  const dir = repo(files, cfg);
  const r = run(dir, 'nearby', '--pattern', '(');
  assert.equal(r.code, 2);
  assert.match(r.err, /^review: /);
});

test('without a rules dir the config areas still work', () => {
  const dir = repo({ 'src/auth/seed.ts': 'x\n' }, { areas: { auth: ['src/auth/*.ts'] } });
  assert.equal(run(dir, 'files', 'auth').out.trim(), 'src/auth/seed.ts');
});

test('config area with a rule file name adds globs; bare and single-quoted items parse', () => {
  const dir = repo({ '.claude/rules/pay.md': "---\npaths:\n  - 'a/**'\n  - b/*.ts\n---\n" });
  const [pay] = loadAreas(dir, { areas: { pay: ['c/**'] } });
  assert.deepEqual(pay, { name: 'pay', globs: ['a/**', 'b/*.ts', 'c/**'], ruleFile: '.claude/rules/pay.md' });
});

test('a rule file without paths is an area with no globs', () => {
  const dir = repo({ '.claude/rules/misc.md': '# just text\n' });
  assert.deepEqual(loadAreas(dir, {}), [{ name: 'misc', globs: [], ruleFile: '.claude/rules/misc.md' }]);
});

test('config errors give one review: line and exit 2', () => {
  for (const bad of ['{nope', { areas: { a: 'x' } }, { triggers: 'x' }, { rulesDir: 3 }]) {
    const dir = repo({}, bad);
    const r = run(dir, 'touched');
    assert.equal(r.code, 2);
    assert.match(r.err, /^review: \.claude\/ai-dev-team\.json: .+\n$/);
  }
});

test('missing subcommand prints usage and exits 2', () => {
  const dir = repo({});
  assert.equal(run(dir).code, 2);
  assert.equal(run(dir, 'bogus').code, 2);
});
