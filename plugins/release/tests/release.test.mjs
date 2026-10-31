import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/release.mjs', import.meta.url));
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-'));
let n = 0;

function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_') || k.startsWith('GITHUB_')) delete env[k];
  delete env.EMAIL;
  return env;
}

function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, env: cleanEnv(), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

function put(dir, rel, content) {
  const f = path.join(dir, ...rel.split('/'));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
}

const pkgJson = (v) => `{\n    "name": "x",\n    "version": "${v}"\n}\n`;

function repo(files, config, identity = true) {
  const dir = path.join(base, `r${n++}`);
  fs.mkdirSync(dir);
  git(dir, 'init', '-q', '-b', 'main');
  if (identity) {
    git(dir, 'config', 'user.name', 't');
    git(dir, 'config', 'user.email', 't@example.com');
  }
  if (config !== undefined) put(dir, '.claude/ai-dev-team.json', typeof config === 'string' ? config : JSON.stringify(config));
  for (const [rel, c] of Object.entries(files)) put(dir, rel, c);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'chore: init');
  return dir;
}

function commit(dir, msg, rel = 'src.txt') {
  put(dir, rel, `${msg} ${n++}`);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', msg);
}

function run(dir, args = [], extraEnv = {}) {
  const r = spawnSync(process.execPath, [script, ...args], { cwd: dir, env: { ...cleanEnv(), ...extraEnv }, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const single = (v = '0.1.0') => {
  const dir = repo({ 'package.json': pkgJson(v) }, { release: { versionFile: 'package.json' } });
  git(dir, 'tag', `v${v}`);
  return dir;
};
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');

test('a fix since the last tag releases a patch with a Fixes section', () => {
  const dir = single();
  commit(dir, 'fix: handle empty input');
  const r = run(dir, ['--write']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^release \S+ 0\.1\.1 v0\.1\.1 .+$/m);
  const log = read(dir, 'CHANGELOG.md');
  assert.match(log, /^## 0\.1\.1 \(\d{4}-\d{2}-\d{2}\)$/m);
  assert.match(log, /### Fixes\n\n- handle empty input \([0-9a-f]{7}\)/);
});

test('a feat releases a minor', () => {
  const dir = single();
  commit(dir, 'fix: a');
  commit(dir, 'feat(ui): add a page');
  const r = run(dir, ['--write']);
  assert.match(r.out, / 0\.2\.0 v0\.2\.0 /);
  assert.match(read(dir, 'CHANGELOG.md'), /### Features\n\n- add a page /);
});

test('a breaking change below 1.0 releases a minor and at 1.x a major', () => {
  const zero = single('0.4.0');
  commit(zero, 'feat!: drop the old api');
  assert.match(run(zero, ['--write']).out, / 0\.5\.0 v0\.5\.0 /);
  assert.match(read(zero, 'CHANGELOG.md'), /### Breaking changes\n\n- drop the old api /);

  const one = single('1.2.3');
  put(one, 'b.txt', 'b');
  git(one, 'add', '-A');
  git(one, 'commit', '-q', '-m', 'refactor: rework the core', '-m', 'BREAKING CHANGE: the core api moved');
  assert.match(run(one, ['--write']).out, / 2\.0\.0 v2\.0\.0 /);
});

const multi = () => {
  const dir = repo(
    { 'pkgs/a/package.json': pkgJson('0.1.0'), 'pkgs/b/package.json': pkgJson('0.1.0') },
    { release: { packages: ['pkgs/*'], versionFile: 'package.json', tag: '{name}-v{version}' } },
  );
  git(dir, 'tag', 'a-v0.1.0');
  git(dir, 'tag', 'b-v0.1.0');
  git(dir, 'tag', 'ui-a-v5.0.0');
  return dir;
};

test('a commit touching two packages releases both with their own changelog and tag', () => {
  const dir = multi();
  put(dir, 'pkgs/a/x.txt', '1');
  put(dir, 'pkgs/b/x.txt', '1');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'feat: shared change');
  const r = run(dir, ['--write']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^release a 0\.2\.0 a-v0\.2\.0 /m);
  assert.match(r.out, /^release b 0\.2\.0 b-v0\.2\.0 /m);
  assert.match(read(dir, 'pkgs/a/CHANGELOG.md'), /### Features/);
  assert.match(read(dir, 'pkgs/b/CHANGELOG.md'), /### Features/);
  assert.equal(git(dir, 'log', '-1', '--format=%s'), 'chore(release): a 0.2.0, b 0.2.0');
  assert.equal(git(dir, 'tag', '--list', 'a-v0.2.0'), 'a-v0.2.0');
  assert.equal(git(dir, 'tag', '--list', 'b-v0.2.0'), 'b-v0.2.0');
});

test('an untouched package is not released', () => {
  const dir = multi();
  commit(dir, 'fix: only a', 'pkgs/a/x.txt');
  const r = run(dir, ['--write']);
  assert.match(r.out, /^release a 0\.1\.1 a-v0\.1\.1 /m);
  assert.doesNotMatch(r.out, /^release b /m);
  assert.equal(git(dir, 'tag', '--list', 'b-v0.1.1'), '');
  assert.equal(fs.existsSync(path.join(dir, 'pkgs/b/CHANGELOG.md')), false);
});

test('merge commits, chore(release) commits and non-conventional subjects never count', () => {
  const dir = repo({ 'package.json': pkgJson('0.1.0') }, { release: { versionFile: 'package.json', patch: 'any' } });
  git(dir, 'tag', 'v0.1.0');
  git(dir, 'checkout', '-q', '-b', 'topic');
  commit(dir, 'wip on the topic', 'topic.txt');
  git(dir, 'checkout', '-q', 'main');
  git(dir, 'merge', '--no-ff', '-q', '-m', 'fix: sneaky merge', 'topic');
  commit(dir, 'chore(release): 0.1.0');
  commit(dir, 'feat added things without a type');
  commit(dir, 'Update readme');
  const r = run(dir, ['--write']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out.trim(), 'nothing to release');
  commit(dir, 'feat(release): a real feature');
  assert.match(run(dir).out, /0\.2\.0/);
});

test('with patch "any" a docs commit releases a patch; with the default it releases nothing', () => {
  const dir = repo({ 'package.json': pkgJson('0.1.0') }, { release: { versionFile: 'package.json', patch: 'any' } });
  git(dir, 'tag', 'v0.1.0');
  commit(dir, 'docs: explain it');
  assert.match(run(dir, ['--write']).out, / 0\.1\.1 v0\.1\.1 /);
  assert.match(read(dir, 'CHANGELOG.md'), /### Other changes\n\n- explain it /);

  const plain = single();
  commit(plain, 'docs: explain it');
  assert.equal(run(plain, ['--write']).out.trim(), 'nothing to release');
});

test('a package without a tag releases the version in its version file as "First release."', () => {
  const dir = repo({ 'package.json': pkgJson('0.3.0') }, { release: { versionFile: 'package.json' } });
  const r = run(dir, ['--write']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, / 0\.3\.0 v0\.3\.0 /);
  assert.match(read(dir, 'CHANGELOG.md'), /^## 0\.3\.0 \(.+\)\n\nFirst release\.\n/m);
  assert.equal(read(dir, 'package.json'), pkgJson('0.3.0'));
  assert.equal(git(dir, 'tag', '--list', 'v0.3.0'), 'v0.3.0');
});

test('--write updates the version file, prepends the changelog section, commits once and tags each release', () => {
  const dir = single();
  put(dir, 'CHANGELOG.md', '# Changelog\n\n## 0.1.0 (2026-01-01)\n\nFirst release.\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'docs: add changelog');
  commit(dir, 'fix: one');
  const before = git(dir, 'rev-list', '--count', 'HEAD');
  const r = run(dir, ['--write']);
  assert.equal(r.code, 0, r.err);
  assert.equal(read(dir, 'package.json'), pkgJson('0.1.1'));
  const log = read(dir, 'CHANGELOG.md');
  assert.ok(log.startsWith('# Changelog\n\n## 0.1.1 ('));
  assert.ok(log.indexOf('## 0.1.1') < log.indexOf('## 0.1.0'));
  assert.equal(Number(git(dir, 'rev-list', '--count', 'HEAD')), Number(before) + 1);
  assert.equal(git(dir, 'log', '-1', '--format=%s'), 'chore(release): 0.1.1');
  assert.equal(git(dir, 'cat-file', '-t', 'v0.1.1'), 'tag');
  assert.equal(git(dir, 'rev-parse', 'v0.1.1^{commit}'), git(dir, 'rev-parse', 'HEAD'));
  assert.equal(git(dir, 'status', '--porcelain'), '');
  const notes = r.out.trim().split(' ').slice(4).join(' ');
  assert.equal(notes, path.join(os.tmpdir(), 'release-v0.1.1.md'));
  const body = fs.readFileSync(notes, 'utf8');
  assert.match(body, /^### Fixes/);
  assert.doesNotMatch(body, /^## /m);
});

test('a dirty tree or a missing git identity exits 2 before writing', () => {
  const dirty = single();
  commit(dirty, 'fix: one');
  put(dirty, 'stray.txt', 'x');
  const head = git(dirty, 'rev-parse', 'HEAD');
  const r = run(dirty, ['--write']);
  assert.equal(r.code, 2);
  assert.match(r.err, /^release: the working tree has uncommitted changes\n$/);
  assert.equal(git(dirty, 'rev-parse', 'HEAD'), head);
  assert.equal(read(dirty, 'package.json'), pkgJson('0.1.0'));

  const anon = repo({ 'package.json': pkgJson('0.1.0') }, { release: { versionFile: 'package.json' } }, false);
  git(anon, 'tag', 'v0.1.0');
  commit(anon, 'fix: one');
  const noIdentity = {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: path.join(base, 'no-such-gitconfig'),
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'user.useConfigOnly',
    GIT_CONFIG_VALUE_0: 'true',
  };
  const a = run(anon, ['--write'], noIdentity);
  assert.equal(a.code, 2);
  assert.match(a.err, /^release: set git user\.name and user\.email\n$/);
  assert.equal(read(anon, 'package.json'), pkgJson('0.1.0'));
});

test('invalid release config exits 2 with one line', () => {
  for (const [config, key] of [
    [{ release: { patch: 5 } }, 'release.patch'],
    [{ release: { packages: 'x' } }, 'release.packages'],
    [{ release: { tag: 'nover' } }, 'release.tag'],
    [{ release: { initial: '1.0' } }, 'release.initial'],
    ['{ not json', ''],
  ]) {
    const dir = repo({ 'package.json': pkgJson('0.1.0') }, config);
    const r = run(dir, ['--write']);
    assert.equal(r.code, 2);
    assert.match(r.err, new RegExp(`^\\.claude/ai-dev-team\\.json: ${key.replace('.', '\\.')}.*\\n$`));
    assert.equal(r.err.trim().split('\n').length, 1);
  }
});

test('without --write nothing changes', () => {
  const dir = single();
  commit(dir, 'fix: one');
  const head = git(dir, 'rev-parse', 'HEAD');
  const r = run(dir);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /0\.1\.1/);
  assert.doesNotMatch(r.out, /^release /m);
  assert.equal(git(dir, 'rev-parse', 'HEAD'), head);
  assert.equal(git(dir, 'status', '--porcelain'), '');
  assert.equal(git(dir, 'tag', '--list'), 'v0.1.0');
  assert.equal(read(dir, 'package.json'), pkgJson('0.1.0'));
});

test('a tag with a slash gets a flat notes file name', () => {
  const dir = repo({ 'package.json': pkgJson('0.1.0') }, { release: { versionFile: 'package.json', tag: '{name}/v{version}' } });
  const name = path.basename(dir);
  git(dir, 'tag', `${name}/v0.1.0`);
  commit(dir, 'fix: one');
  const r = run(dir, ['--write']);
  assert.equal(r.code, 0, r.err);
  assert.equal(git(dir, 'tag', '--list', `${name}/v0.1.1`), `${name}/v0.1.1`);
  assert.ok(fs.existsSync(path.join(os.tmpdir(), `release-${name}-v0.1.1.md`)));
});

test('two packages computing the same tag exit 2 naming the tag', () => {
  const dir = repo(
    { 'pkgs/a/package.json': pkgJson('0.1.0'), 'pkgs/b/package.json': pkgJson('0.1.0') },
    { release: { packages: ['pkgs/*'], versionFile: 'package.json' } },
  );
  git(dir, 'tag', 'v0.1.0');
  commit(dir, 'fix: both', 'pkgs/a/x.txt');
  commit(dir, 'fix: both', 'pkgs/b/x.txt');
  const r = run(dir, ['--write']);
  assert.equal(r.code, 2);
  assert.match(r.err, /^release: tag v0\.1\.1 .*\n$/);
  assert.equal(git(dir, 'status', '--porcelain'), '');
});

test('a failing release commit restores every written file', () => {
  const dir = single();
  commit(dir, 'fix: one');
  const hook = path.join(dir, '.git', 'hooks', 'pre-commit');
  fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n');
  fs.chmodSync(hook, 0o755);
  const r = run(dir, ['--write']);
  assert.equal(r.code, 1);
  assert.equal(r.err.trim().split('\n').length, 1);
  assert.equal(read(dir, 'package.json').replaceAll('\r\n', '\n'), pkgJson('0.1.0'));
  assert.equal(fs.existsSync(path.join(dir, 'CHANGELOG.md')), false);
  assert.equal(git(dir, 'status', '--porcelain'), '');
  assert.equal(git(dir, 'tag', '--list'), 'v0.1.0');
});

test('package entries must be folders inside the project without spaces in the name', () => {
  for (const [packages, dirs] of [[['..'], {}], [['package.json'], {}], [['my pkg'], { 'my pkg/x.txt': 'x' }]]) {
    const dir = repo({ 'package.json': pkgJson('0.1.0'), ...dirs }, { release: { packages } });
    const r = run(dir);
    assert.equal(r.code, 2);
    assert.equal(r.err.trim().split('\n').length, 1);
  }
});

test('a CRLF changelog and a CRLF version file keep their line endings', () => {
  const dir = single();
  put(dir, 'package.json', pkgJson('0.1.0').replace(/\n/g, '\r\n'));
  put(dir, 'CHANGELOG.md', '# Changelog\r\n\r\n## 0.1.0 (2026-01-01)\r\n\r\nFirst release.\r\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'docs: crlf');
  commit(dir, 'fix: one');
  assert.equal(run(dir, ['--write']).code, 0);
  for (const f of ['package.json', 'CHANGELOG.md']) assert.doesNotMatch(read(dir, f), /(?<!\r)\n/);
  assert.match(read(dir, 'package.json'), /"version": "0\.1\.1"/);
});

test('with the GitHub repository variables set the changelog lines link to the commit', () => {
  const dir = single();
  commit(dir, 'fix: linked');
  const sha = git(dir, 'rev-parse', 'HEAD');
  const r = run(dir, ['--write'], { GITHUB_SERVER_URL: 'https://example.test', GITHUB_REPOSITORY: 'o/r' });
  assert.equal(r.code, 0, r.err);
  assert.ok(read(dir, 'CHANGELOG.md').includes(`- linked ([${sha.slice(0, 7)}](https://example.test/o/r/commit/${sha}))`));
});
