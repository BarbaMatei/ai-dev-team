import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

const scripts = fileURLToPath(new URL('../scripts/', import.meta.url));
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-'));
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
  env.GIT_CEILING_DIRECTORIES = path.dirname(fs.realpathSync(os.tmpdir()));
  return env;
}

const run = (cwd, script, ...args) => {
  const r = spawnSync(process.execPath, [path.join(scripts, script), ...args], { cwd, env: cleanEnv(), encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

function project() {
  const id = n++;
  const root = path.join(base, `p${id}`);
  const stage = path.join(base, `stage${id}`);
  fs.mkdirSync(root);
  fs.mkdirSync(stage);
  spawnSync('git', ['init', '-q'], { cwd: root, env: cleanEnv() });
  fs.writeFileSync(path.join(stage, 'answers.json'), JSON.stringify(answers));
  assert.equal(run(stage, 'render.mjs', 'answers.json', 'out').code, 0);
  const r = run(root, 'apply.mjs', path.join(stage, 'out'), '--write');
  assert.equal(r.code, 0, r.err);
  return root;
}

const file = (root, p) => path.join(root, ...p.split('/'));
const read = (root, p) => fs.readFileSync(file(root, p), 'utf8');
const bump = (root, version) => {
  const cfg = JSON.parse(read(root, '.claude/ai-dev-team.json'));
  cfg.setup.version = version;
  fs.writeFileSync(file(root, '.claude/ai-dev-team.json'), `${JSON.stringify(cfg, null, 2)}\n`);
};
const current = () => JSON.parse(fs.readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8')).version;

test('check reports missing files and outdated kit blocks', () => {
  const root = project();
  assert.equal(run(root, 'check.mjs').out, 'up to date\n');
  fs.rmSync(file(root, '.editorconfig'));
  fs.rmSync(file(root, '.github/pull_request_template.md'));
  const md = read(root, 'CLAUDE.md');
  fs.writeFileSync(file(root, 'CLAUDE.md'), md.replace('<!-- kit:git -->', '<!-- kit:git -->\nstale line').replace('<!-- kit:replies -->\n', '<!-- kit:replies-old -->\n'));
  bump(root, '0.0.1');
  const r = run(root, 'check.mjs');
  assert.equal(r.code, 0, r.err);
  assert.equal(
    r.out,
    ['missing .editorconfig', 'missing .github/pull_request_template.md', 'block CLAUDE.md git outdated', 'block CLAUDE.md replies absent', `stamp 0.0.1 -> ${current()}`, ''].join('\n'),
  );
});

test('check never reports owner text outside the markers', () => {
  const root = project();
  const md = read(root, 'CLAUDE.md');
  fs.writeFileSync(file(root, 'CLAUDE.md'), `# Totally different title\n\nowner paragraph\n\n${md}\nmore owner text\n`);
  fs.writeFileSync(file(root, '.gitignore'), 'custom\n');
  fs.writeFileSync(file(root, '.github/workflows/ci.yml'), 'name: mine\n');
  const r = run(root, 'check.mjs');
  assert.equal(r.out, 'up to date\n');
  assert.equal(r.code, 0);
});

test('check --write replaces only the marked blocks and keeps CRLF', () => {
  const root = project();
  const orig = read(root, 'CLAUDE.md');
  const stale = orig.replace('<!-- kit:git -->\n', '<!-- kit:git -->\nstale\n').replace(/\n/g, '\r\n');
  fs.writeFileSync(file(root, 'CLAUDE.md'), `# Mine\r\nowner line\r\n${stale}tail\r\n`);
  fs.rmSync(file(root, '.editorconfig'));
  bump(root, '0.0.1');
  const r = run(root, 'check.mjs', '--write');
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, `missing .editorconfig\nblock CLAUDE.md git outdated\nstamp 0.0.1 -> ${current()}\n`);
  const after = read(root, 'CLAUDE.md');
  assert.equal(after, `# Mine\r\nowner line\r\n${orig.replace(/\n/g, '\r\n')}tail\r\n`);
  assert.ok(!/[^\r]\n/.test(after), 'no bare LF');
  assert.ok(fs.existsSync(file(root, '.editorconfig')));
  assert.equal(JSON.parse(read(root, '.claude/ai-dev-team.json')).setup.version, current());
  assert.equal(run(root, 'check.mjs').out, 'up to date\n');
});

test('check without a setup stamp exits 2', () => {
  const root = path.join(base, `p${n++}`);
  fs.mkdirSync(root);
  let r = run(root, 'check.mjs');
  assert.equal(r.code, 2);
  assert.equal(r.out + r.err, 'check: no setup stamp; run setup:new\n');
  fs.mkdirSync(path.join(root, '.claude'));
  fs.writeFileSync(path.join(root, '.claude', 'ai-dev-team.json'), '{"tests":{}}');
  r = run(root, 'check.mjs');
  assert.equal(r.code, 2);
  assert.equal(r.out + r.err, 'check: no setup stamp; run setup:new\n');
  fs.writeFileSync(path.join(root, '.claude', 'ai-dev-team.json'), '{"setup":{"name":"x"}}');
  r = run(root, 'check.mjs');
  assert.equal(r.code, 2);
  assert.match(r.err, /^check: setup stamp invalid: setup: answers\./);
});
