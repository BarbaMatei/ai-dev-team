import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ciJobNames, renderFiles } from '../scripts/render.mjs';

const pluginVersion = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../.claude-plugin/plugin.json', import.meta.url)), 'utf8')).version;
const script = fileURLToPath(new URL('../scripts/render.mjs', import.meta.url));
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'st-'));
after(() => fs.rmSync(base, { recursive: true, force: true }));
let n = 0;

const answers = (extra = {}) => ({
  name: 'my-shop',
  language: 'Romanian',
  owner: 'someone',
  ownerType: 'User',
  visibility: 'public',
  stacks: [
    { id: 'dotnet', dir: 'src/api', role: 'api' },
    { id: 'node', dir: 'src/web', role: 'web' },
  ],
  release: 'semantic-release',
  ...extra,
});

function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_') || k.startsWith('GITHUB_')) delete env[k];
  env.GIT_CEILING_DIRECTORIES = path.dirname(fs.realpathSync(os.tmpdir()));
  return env;
}

function cli(a) {
  const dir = path.join(base, `c${n++}`);
  fs.mkdirSync(dir);
  const file = path.join(dir, 'answers.json');
  fs.writeFileSync(file, typeof a === 'string' ? a : JSON.stringify(a));
  const out = path.join(dir, 'out');
  const r = spawnSync(process.execPath, [script, file, out], { env: cleanEnv(), encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr, dir: out };
}

const get = (a, p) => renderFiles(a).find((f) => f.path === p)?.content;

test('a dotnet api and node web answers render the full file list', () => {
  const r = cli(answers());
  assert.equal(r.code, 0, r.err);
  const expected = [
    '.claude/ai-dev-team.json',
    '.claude/rules/.gitkeep',
    '.claude/settings.json',
    '.editorconfig',
    '.githooks/pre-commit',
    '.github/pull_request_template.md',
    '.github/workflows/ci.yml',
    '.github/workflows/release.yml',
    '.github/workflows/secret-scan.yml',
    '.gitignore',
    '.releaserc.json',
    'CLAUDE.md',
  ];
  assert.deepEqual(r.out.trim().split('\n'), expected.map((p) => `file ${p}`));
  for (const p of expected) assert.ok(fs.existsSync(path.join(r.dir, ...p.split('/'))), p);
  const settings = JSON.parse(get(answers(), '.claude/settings.json'));
  assert.deepEqual(Object.keys(settings.enabledPlugins), [
    'superpowers@claude-plugins-official',
    ...['guardrails', 'review', 'test-quality', 'spec-upkeep', 'metrics', 'browser', 'e2e', 'ui-review', 'architect', 'setup'].map((p) => `${p}@ai-dev-team`),
  ]);
  assert.deepEqual(settings.extraKnownMarketplaces, { 'ai-dev-team': { source: { source: 'github', repo: 'BarbaMatei/ai-dev-team' } } });
});

test('CLAUDE.md has every kit block with its markers and the project placeholders', () => {
  const md = get(answers(), 'CLAUDE.md');
  assert.ok(md.startsWith('# my-shop\n'));
  assert.ok(md.includes('User-facing text is in Romanian.'));
  for (const id of ['tests', 'code-rules', 'attach-points', 'git', 'replies']) {
    const open = md.indexOf(`<!-- kit:${id} -->`);
    const close = md.indexOf(`<!-- /kit:${id} -->`);
    assert.ok(open >= 0 && close > open, id);
  }
  for (const id of ['intro', 'constraints', 'commands', 'where-to-read']) assert.ok(md.includes(`<!-- setup:fill ${id}:`), id);
  assert.ok(!md.includes('{{'));
});

test('ai-dev-team.json tests and browser come from the stacks', () => {
  const cfg = JSON.parse(get(answers(), '.claude/ai-dev-team.json'));
  assert.deepEqual(cfg.tests, {
    api: { command: 'dotnet test --filter "FullyQualifiedName~{filter}"', cwd: 'src/api', format: 'dotnet', buildError: 'error CS\\d{4}|Build FAILED' },
    web: { command: 'npm test -- {filter}', cwd: 'src/web', format: 'vitest' },
  });
  assert.deepEqual(cfg.browser, {
    baseUrl: 'http://localhost:5173/',
    boot: [
      { name: 'api', command: 'dotnet run', cwd: 'src/api', ready: 'tcp://localhost:5000' },
      { name: 'web', command: 'npm run dev', cwd: 'src/web', ready: 'http://localhost:5173/' },
    ],
  });
  assert.deepEqual([cfg.testLock, cfg.testGuard, cfg.rulesDir, cfg.triggers, cfg.bugs, cfg.metrics], [true, true, '.claude/rules', [], { label: 'bug' }, { since: 1 }]);
  assert.deepEqual(cfg.comments, { ignore: ['.specsmd/**'] });
  assert.deepEqual(cfg.setup, { ...answers(), version: pluginVersion });
  const lib = answers({ stacks: [{ id: 'python', dir: 'lib', role: 'lib' }] });
  const libCfg = JSON.parse(get(lib, '.claude/ai-dev-team.json'));
  assert.equal(libCfg.browser, undefined);
  assert.deepEqual(libCfg.tests.lib, { command: 'python -m pytest -k "{filter}"', cwd: 'lib' });
  const ng = answers({ stacks: [{ id: 'angular', dir: 'ui', role: 'web' }] });
  const ngCfg = JSON.parse(get(ng, '.claude/ai-dev-team.json'));
  assert.deepEqual(ngCfg.browser, { baseUrl: 'http://localhost:4200/', boot: [{ name: 'web', command: 'npm start', cwd: 'ui', ready: 'http://localhost:4200/' }] });
  assert.deepEqual(ngCfg.tests.web, { command: 'npx ng test --watch=false --include="**/{filter}*.spec.ts"', cwd: 'ui', format: 'vitest', buildError: 'error TS\\d+|Transform failed' });
});

test('each ci job skips cleanly when its project file is missing', () => {
  const a = answers();
  assert.deepEqual(ciJobNames(a), ['api', 'web']);
  const ci = get(a, '.github/workflows/ci.yml');
  assert.ok(ci.includes('on:\n  pull_request:\n  push:\n    branches-ignore: [main]\n'));
  const jobs = ci.split(/^ {2}(?=api:|web:)/m).slice(1);
  assert.equal(jobs.length, 2);
  const want = { api: ['src/api/*.sln', 'src/api/*.slnx', 'src/api/*.csproj'], web: ['src/web/package.json'] };
  for (const job of jobs) {
    const role = job.slice(0, job.indexOf(':'));
    assert.ok(job.includes(`name: ${role}\n`), role);
    assert.ok(job.includes(`working-directory: src/${role}\n`), role);
    const steps = job.split(/^ {6}- /m).slice(1);
    assert.ok(steps.length >= 4, role);
    assert.ok(steps[0].startsWith('uses: actions/checkout@v4'));
    assert.ok(steps[1].includes('id: project'));
    for (const f of want[role]) assert.ok(steps[1].includes(f), f);
    assert.ok(steps[1].includes('        working-directory: .\n'), role);
    assert.ok(steps[1].includes('echo "found=true" >> "$GITHUB_OUTPUT"'), role);
    for (const s of steps.slice(2)) assert.ok(s.includes("if: steps.project.outputs.found == 'true'"), s);
  }
  assert.ok(jobs[0].includes('actions/setup-dotnet@v4') && jobs[0].includes('8.0.x'));
  assert.ok(jobs[1].includes('actions/setup-node@v4') && jobs[1].includes('npm ci'));
});

const hasBash = spawnSync('bash', ['-c', 'exit 0'], { env: cleanEnv() }).status === 0;

function probeOf(ci, role) {
  const job = ci.split(new RegExp(`^ {2}(?=${role}:)`, 'm'))[1];
  const step = job.split(/^ {6}- /m)[2];
  return step.slice(step.indexOf('run: |\n') + 7).split('\n').map((l) => l.slice(10)).join('\n');
}

function probeRuns(stackId, file) {
  const ci = get(answers({ stacks: [{ id: stackId, dir: 'src/x', role: 'api' }] }), '.github/workflows/ci.yml');
  const probe = probeOf(ci, 'api');
  const repo = path.join(base, `p${n++}`);
  fs.mkdirSync(path.join(repo, 'src', 'x'), { recursive: true });
  const run = () => {
    spawnSync('bash', ['-eo', 'pipefail', '-c', probe], { cwd: repo, env: { ...cleanEnv(), GITHUB_OUTPUT: 'out.txt' } });
    const f = path.join(repo, 'out.txt');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  };
  const before = run();
  fs.writeFileSync(path.join(repo, 'src', 'x', file), '');
  return { before, after: run() };
}

test('the ci probe finds the project file from the repository root', { skip: hasBash ? false : 'bash is not available' }, () => {
  assert.deepEqual(probeRuns('node', 'package.json'), { before: '', after: 'found=true\n' });
});

test('the dotnet ci probe finds a solution when the other patterns match nothing', { skip: hasBash ? false : 'bash is not available' }, () => {
  assert.deepEqual(probeRuns('dotnet', 'App.sln'), { before: '', after: 'found=true\n' });
});

test('the python ci probe finds pyproject.toml when requirements.txt is absent', { skip: hasBash ? false : 'bash is not available' }, () => {
  assert.deepEqual(probeRuns('python', 'pyproject.toml'), { before: '', after: 'found=true\n' });
});

test('semantic-release and kit release render different release files', () => {
  const sem = renderFiles(answers());
  const rel = sem.find((f) => f.path === '.github/workflows/release.yml').content;
  assert.ok(sem.some((f) => f.path === '.releaserc.json'));
  assert.ok(rel.includes('semantic-release@25.0.5') && rel.includes('@semantic-release/changelog@6.0.3') && rel.includes('@semantic-release/git@10.0.1'));
  assert.ok(rel.includes('github-actions[bot]'));
  assert.ok(!rel.includes('plugins/release@'));
  const kit = renderFiles(answers({ release: 'kit', releaseRef: 'release-v0.2.0' }));
  const kitRel = kit.find((f) => f.path === '.github/workflows/release.yml').content;
  assert.ok(!kit.some((f) => f.path === '.releaserc.json'));
  assert.ok(kitRel.includes('uses: BarbaMatei/ai-dev-team/plugins/release@release-v0.2.0\n'));
  assert.ok(!kitRel.includes('semantic-release'));
  const cfg = JSON.parse(kit.find((f) => f.path === '.claude/ai-dev-team.json').content);
  assert.deepEqual(cfg.release, { packages: ['src/api', 'src/web'], tag: '{name}-v{version}' });
  assert.equal(cfg.setup.releaseRef, 'release-v0.2.0');
  assert.equal(JSON.parse(get(answers(), '.claude/ai-dev-team.json')).release, undefined);
});

test("a personal repository's release checks out with the deploy key, an organization's with the built-in token", () => {
  for (const release of [{}, { release: 'kit', releaseRef: 'release-v1.0.0' }]) {
    const user = get(answers(release), '.github/workflows/release.yml');
    assert.ok(user.includes('          ssh-key: ${{ secrets.RELEASE_DEPLOY_KEY }}\n'));
    for (const visibility of ['public', 'private']) {
      const org = get(answers({ ...release, ownerType: 'Organization', visibility }), '.github/workflows/release.yml');
      assert.ok(!org.includes('ssh-key'));
      assert.ok(org.includes('fetch-depth: 0'));
    }
  }
});

test('an unknown stack id or a missing answer exits 2 with one line', () => {
  const bad = (a, start) => {
    const r = cli(a);
    assert.equal(r.code, 2);
    assert.equal(r.out, '');
    assert.equal(r.err.trim().split('\n').length, 1);
    assert.ok(r.err.startsWith(start), r.err);
    assert.ok(!fs.existsSync(r.dir));
  };
  bad(answers({ stacks: [{ id: 'cobol', dir: 'x', role: 'api' }] }), 'setup: answers.stacks[0].id');
  const { owner, ...noOwner } = answers();
  bad(noOwner, 'setup: answers.owner');
  bad(answers({ ownerType: 'Team' }), 'setup: answers.ownerType');
  bad(answers({ stacks: [] }), 'setup: answers.stacks');
  bad(answers({ stacks: [{ id: 'node', dir: 'a', role: 'web' }, { id: 'angular', dir: 'b', role: 'web' }] }), 'setup: answers.stacks[1].role');
  bad(answers({ stacks: [{ id: 'node', dir: '../a', role: 'web' }] }), 'setup: answers.stacks[0].dir');
  for (const dir of ['my api', 'a#b', 'a$b', 'a*', 'a"b', "a'b", '..', 'a/../b']) bad(answers({ stacks: [{ id: 'node', dir, role: 'web' }] }), 'setup: answers.stacks[0].dir');
  bad(answers({ release: 'kit' }), 'setup: answers.releaseRef');
  bad(answers({ release: 'kit', releaseRef: 'main' }), 'setup: answers.releaseRef');
  bad(answers({ purpose: 3 }), 'setup: answers.purpose');
  bad('{not json', 'setup: ');
  const ok = cli(answers({ purpose: 'sell photos', users: 'shoppers', mustDo: 'checkout', version: '9.9.9' }));
  assert.equal(ok.code, 0, ok.err);
  assert.ok(!fs.readFileSync(path.join(ok.dir, 'CLAUDE.md'), 'utf8').includes('sell photos'));
});

test('a leading ./ in a stack folder is dropped', () => {
  const a = answers({ stacks: [{ id: 'node', dir: './web', role: 'web' }] });
  assert.equal(JSON.parse(get(a, '.claude/ai-dev-team.json')).tests.web.cwd, 'web');
  assert.match(get(a, '.github/workflows/ci.yml'), /working-directory: web$/m);
  const root = answers({ stacks: [{ id: 'node', dir: '.', role: 'web' }] });
  assert.equal(JSON.parse(get(root, '.claude/ai-dev-team.json')).tests.web.cwd, '.');
});

test('the same answers render byte-identical output twice', () => {
  const a = answers({ stacks: [{ id: 'angular', dir: 'web', role: 'web' }, { id: 'python', dir: 'svc', role: 'api' }] });
  const one = cli(a);
  const two = cli(a);
  assert.equal(one.code, 0, one.err);
  const files = one.out.trim().split('\n').map((l) => l.slice(5));
  assert.ok(files.length >= 11);
  for (const f of files) {
    const x = fs.readFileSync(path.join(one.dir, ...f.split('/')));
    assert.ok(x.equals(fs.readFileSync(path.join(two.dir, ...f.split('/')))), f);
    if (x.length) {
      assert.ok(!x.includes('\r'), f);
      assert.equal(x.at(-1), 10, f);
    }
  }
  assert.deepEqual(renderFiles(a), renderFiles(a));
});
