import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

const scripts = fileURLToPath(new URL('../scripts/', import.meta.url));
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-'));
after(() => fs.rmSync(base, { recursive: true, force: true }));
let n = 0;

const answers = {
  name: 'my-shop',
  language: 'Romanian',
  owner: 'someone',
  ownerType: 'User',
  visibility: 'public',
  stacks: [{ id: 'node', dir: '.', role: 'web' }],
  release: 'semantic-release',
};

function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_') || k.startsWith('GITHUB_')) delete env[k];
  return env;
}

const run = (cwd, script, ...args) => {
  const r = spawnSync(process.execPath, [path.join(scripts, script), ...args], { cwd, env: cleanEnv(), encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

function staging() {
  const dir = path.join(base, `s${n++}`);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'answers.json'), JSON.stringify(answers));
  const r = run(dir, 'render.mjs', 'answers.json', 'out');
  assert.equal(r.code, 0, r.err);
  return path.join(dir, 'out');
}

function project(init = true) {
  const dir = path.join(base, `p${n++}`);
  fs.mkdirSync(dir);
  if (init) spawnSync('git', ['init', '-q'], { cwd: dir, env: cleanEnv() });
  return dir;
}

const gitConfig = (cwd, key) => spawnSync('git', ['config', key], { cwd, env: cleanEnv(), encoding: 'utf8' }).stdout.trim();

test('apply on an empty folder creates every staged file and sets core.hooksPath', () => {
  const stage = staging();
  const dir = project();
  const dry = run(dir, 'apply.mjs', stage);
  assert.equal(dry.code, 0, dry.err);
  assert.deepEqual(dry.out.trim().split('\n'), [
    'create .claude/ai-dev-team.json',
    'create .claude/rules/.gitkeep',
    'create .claude/settings.json',
    'create .editorconfig',
    'create .githooks/pre-commit',
    'create .github/pull_request_template.md',
    'create .github/workflows/ci.yml',
    'create .github/workflows/release.yml',
    'create .github/workflows/secret-scan.yml',
    'create .gitignore',
    'create .releaserc.json',
    'create CLAUDE.md',
  ]);
  assert.ok(!fs.existsSync(path.join(dir, 'CLAUDE.md')), 'dry run writes nothing');
  const r = run(dir, 'apply.mjs', stage, '--write');
  assert.equal(r.code, 0, r.err);
  assert.ok(r.out.includes('create CLAUDE.md\n'));
  assert.ok(r.out.trim().endsWith('hooksPath .githooks'));
  for (const f of ['CLAUDE.md', '.githooks/pre-commit', '.claude/rules/.gitkeep']) assert.ok(fs.existsSync(path.join(dir, f)), f);
  assert.equal(gitConfig(dir, 'core.hooksPath'), '.githooks');
});

test('apply never overwrites an existing file and reports it as differs', () => {
  const stage = staging();
  const dir = project();
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'my own notes\n');
  const r = run(dir, 'apply.mjs', stage, '--write');
  assert.equal(r.code, 0, r.err);
  assert.ok(r.out.split('\n').includes('differs CLAUDE.md'));
  assert.equal(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), 'my own notes\n');
  assert.ok(fs.existsSync(path.join(dir, '.gitignore')));
});

test('an identical existing file is reported as same', () => {
  const stage = staging();
  const dir = project(false);
  fs.copyFileSync(path.join(stage, '.editorconfig'), path.join(dir, '.editorconfig'));
  const crlf = fs.readFileSync(path.join(stage, '.gitignore'), 'utf8').replace(/\n/g, '\r\n');
  fs.writeFileSync(path.join(dir, '.gitignore'), crlf);
  const r = run(dir, 'apply.mjs', stage, '--write');
  assert.equal(r.code, 0, r.err);
  const lines = r.out.split('\n');
  assert.ok(lines.includes('same .editorconfig'));
  assert.ok(lines.includes('same .gitignore'));
  assert.equal(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), crlf);
  assert.ok(lines.some((l) => l.startsWith('hooksPath not set: ')), r.out);
});

test('apply with a missing staging folder exits 2', () => {
  const r = run(project(false), 'apply.mjs', path.join(base, 'nope'));
  assert.equal(r.code, 2);
  assert.match(r.err, /^apply: /);
});
