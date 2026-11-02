import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { commandLine, quote } from '../scripts/lib/gh-run.mjs';
import { renderFiles } from '../scripts/render.mjs';

const script = fileURLToPath(new URL('../scripts/github.mjs', import.meta.url));
const fake = fileURLToPath(new URL('./fake-gh.mjs', import.meta.url));
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-'));
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

function cleanEnv(extra) {
  const env = { ...process.env, ...extra };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_') || k.startsWith('GITHUB_')) delete env[k];
  env.GIT_CEILING_DIRECTORIES = path.dirname(fs.realpathSync(os.tmpdir()));
  return env;
}

function git(cwd, args) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, env: cleanEnv(), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
}

function project({ origin, a = answers, gh = [], ci, nested } = {}) {
  const id = n++;
  const outer = path.join(base, `p${id}`);
  const root = nested ? path.join(outer, 'sub') : outer;
  const tmp = path.join(base, `tmp${id}`);
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(tmp);
  if (origin) {
    git(outer, ['init', '-q']);
    git(outer, ['remote', 'add', 'origin', origin]);
  }
  if (ci !== undefined) {
    fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), ci);
  }
  const answersFile = path.join(base, `answers${id}.json`);
  fs.writeFileSync(answersFile, JSON.stringify(a));
  const scriptFile = path.join(base, `script${id}.json`);
  fs.writeFileSync(scriptFile, JSON.stringify(gh));
  const log = path.join(base, `log${id}.txt`);
  const run = (cmd, arg = answersFile) => {
    const r = spawnSync(process.execPath, [script, cmd, arg, '--gh', `node "${fake}"`], {
      cwd: root,
      encoding: 'utf8',
      env: cleanEnv({ FAKE_GH_LOG: log, FAKE_GH_SCRIPT: scriptFile, TMPDIR: tmp, TEMP: tmp, TMP: tmp }),
    });
    return { code: r.status, out: r.stdout, err: r.stderr };
  };
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
  return { root, tmp, run, calls, keyPath: path.join(tmp, 'make-release-key-my-shop.sh') };
}

const ORIGIN = 'https://github.com/someone/my-shop.git';
const RS = 'repos/someone/my-shop/rulesets';
const okGh = (labels = []) => [
  { match: ['label', 'list'], stdout: JSON.stringify(labels.map((name) => ({ name }))) },
  { match: ['api', RS], stdout: '[]' },
  { match: ['api', '-X', 'POST', RS], stdout: '{}' },
  { match: ['label', 'create'] },
];

test('plan for an empty folder lists repo create, labels, protection and the release key', () => {
  const p = project();
  const r = p.run('plan');
  assert.equal(r.code, 0, r.err);
  assert.equal(
    r.out,
    `repo create someone/my-shop public\nlabels bug proposal severity:serious severity:minor\nprotection ruleset web bypass deploy-key\nrelease-key ${p.keyPath}\n`,
  );
  assert.deepEqual(p.calls(), []);
});

test('apply creates only the missing labels', () => {
  const p = project({ origin: ORIGIN, gh: okGh(['bug', 'severity:minor']) });
  const r = p.run('apply');
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^labels created proposal severity:serious$/m);
  const creates = p.calls().filter((c) => c.argv[0] === 'label' && c.argv[1] === 'create');
  assert.deepEqual(creates.map((c) => c.argv[2]), ['proposal', 'severity:serious']);
  assert.ok(creates[0].argv.includes('someone/my-shop'));
  assert.deepEqual(creates[1].argv, ['label', 'create', 'severity:serious', '-R', 'someone/my-shop', '--color', 'b60205', '--description', 'Serious defect']);
});

test('an organization gets the Actions bypass and no release key', () => {
  const p = project({ origin: ORIGIN, a: { ...answers, ownerType: 'Organization' }, gh: okGh() });
  const r = p.run('apply');
  assert.equal(r.code, 0, r.err);
  const post = p.calls().find((c) => c.argv[1] === '-X' && c.argv[2] === 'POST');
  const body = JSON.parse(post.stdin);
  assert.deepEqual(body.bypass_actors, [{ actor_id: 15368, actor_type: 'Integration', bypass_mode: 'always' }]);
  assert.deepEqual(body.rules.find((x) => x.type === 'required_status_checks').parameters.required_status_checks, [{ context: 'web' }]);
  assert.match(r.out, /^protection applied$/m);
  assert.doesNotMatch(r.out, /release-key/);
  assert.equal(fs.existsSync(p.keyPath), false);
});

test('a 403 on the ruleset is reported as unavailable and apply exits 0', () => {
  const gh = okGh().map((s) => (s.match[2] === 'POST' ? { ...s, code: 1, stderr: 'Upgrade to GitHub Pro to enable this feature. (HTTP 403)\nsecond line\n' } : s));
  const p = project({ origin: ORIGIN, gh });
  const r = p.run('apply');
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^protection unavailable: Upgrade to GitHub Pro to enable this feature\. \(HTTP 403\)$/m);
  assert.match(r.out, /^release-key skipped: no protection; releases use the built-in token$/m);
  assert.doesNotMatch(r.out, /second line/);
  assert.equal(fs.existsSync(p.keyPath), false);
});

test('apply never calls gh secret and only writes the key script', () => {
  const p = project({ origin: ORIGIN, gh: okGh() });
  const r = p.run('apply');
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(p.calls().filter((c) => c.argv[0] === 'secret'), []);
  assert.equal(r.out.trim().split('\n').at(-1), `release-key ${p.keyPath}`);
  const text = fs.readFileSync(p.keyPath, 'utf8');
  assert.ok(text.startsWith('#!/usr/bin/env bash\n'));
  assert.ok(text.includes('gh repo deploy-key add "$dir/release-key.pub" --allow-write --title release-bot -R someone/my-shop\n'));
  assert.ok(text.includes('dir="$(mktemp -d)"\ntrap \'rm -rf "$dir"\' EXIT\n'));
  assert.ok(!text.includes('\r'));
  assert.deepEqual(fs.readdirSync(p.tmp), ['make-release-key-my-shop.sh']);
  if (process.platform !== 'win32') assert.equal(fs.statSync(p.keyPath).mode & 0o777, 0o755);
  const post = p.calls().find((c) => c.argv[1] === '-X');
  assert.equal(JSON.parse(post.stdin).bypass_actors[0].actor_type, 'DeployKey');
});

test('an existing origin skips repo create', () => {
  const p = project({
    origin: 'git@github.com:real-owner/real-repo.git',
    gh: [
      { match: ['label', 'list'], stdout: '[]' },
      { match: ['label', 'create'] },
      { match: ['api', 'repos/real-owner/real-repo/rulesets'], stdout: '[{"name":"main through pull requests"}]' },
    ],
  });
  const plan = p.run('plan');
  assert.equal(plan.code, 0, plan.err);
  assert.doesNotMatch(plan.out, /repo create/);
  assert.match(plan.out, /^protection exists$/m);
  const r = p.run('apply');
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^protection exists$/m);
  assert.ok(r.out.includes('release-key '));
  assert.deepEqual(p.calls().filter((c) => c.argv[0] === 'repo'), []);
  assert.deepEqual(p.calls().filter((c) => c.argv[1] === '-X'), []);
  const creates = p.calls().filter((c) => c.argv[0] === 'label' && c.argv[1] === 'create');
  assert.equal(creates.length, 4);
  assert.ok(creates.every((c) => c.argv.includes('real-owner/real-repo')));
});

test('quote keeps a single quote intact for sh and wraps spaces for cmd', () => {
  assert.equal(quote("it's", 'linux'), "'it'\\''s'");
  assert.equal(quote('a b', 'linux'), "'a b'");
  assert.equal(quote('a b', 'win32'), '"a b"');
  assert.equal(quote('severity:minor', 'linux'), 'severity:minor');
});

test('a 403 on the rulesets list is reported as unavailable, writes no key script and posts nothing', () => {
  const msg = 'gh: Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)';
  const gh = okGh().map((s) => (s.match.length === 2 && s.match[1] === RS ? { ...s, code: 1, stderr: `${msg}\n` } : s));
  const p = project({ origin: ORIGIN, gh });
  const r = p.run('apply');
  assert.equal(r.code, 0, r.err);
  assert.ok(r.out.split('\n').includes(`protection unavailable: ${msg}`));
  assert.ok(r.out.split('\n').includes('release-key skipped: no protection; releases use the built-in token'));
  assert.equal(fs.existsSync(p.keyPath), false);
  assert.deepEqual(p.calls().filter((c) => c.argv[1] === '-X'), []);
});

test('owner prints the account type from gh api users', () => {
  const p = project({ gh: [{ match: ['api', 'users/someone'], stdout: 'Organization\n' }] });
  const r = p.run('owner', 'someone');
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, 'Organization\n');
  assert.deepEqual(p.calls().map((c) => c.argv), [['api', 'users/someone', '--jq', '.type']]);
});

test('the gh command line uses the platform quoting for every argument', () => {
  const args = ['label', 'create', 'bug', '--description', 'Something is broken'];
  assert.equal(commandLine('gh', args, 'win32'), 'gh label create bug --description "Something is broken"');
  assert.equal(commandLine('gh', args, 'linux'), "gh label create bug --description 'Something is broken'");
});

test('apply after repo create creates only the labels the new repository lacks', () => {
  const gh = [{ match: ['repo', 'create'] }, ...okGh(['bug'])];
  const p = project({ gh });
  const r = p.run('apply');
  assert.equal(r.code, 0, r.err);
  const lines = r.out.split('\n');
  assert.ok(lines.includes('repo created someone/my-shop'));
  assert.ok(lines.includes('labels created proposal severity:serious severity:minor'));
  const creates = p.calls().filter((c) => c.argv[0] === 'label' && c.argv[1] === 'create');
  assert.deepEqual(creates.map((c) => c.argv[2]), ['proposal', 'severity:serious', 'severity:minor']);
});

const kitCi = () => renderFiles(answers).find((f) => f.path === '.github/workflows/ci.yml').content;

test("a ci.yml that is not the kit's blocks the ruleset in apply and is flagged in plan", () => {
  const p = project({ origin: ORIGIN, gh: okGh(), ci: 'name: mine\n' });
  const plan = p.run('plan');
  assert.equal(plan.code, 0, plan.err);
  assert.match(plan.out, /^protection ruleset web bypass deploy-key \(only if the kit's ci\.yml is used\)$/m);
  const r = p.run('apply');
  assert.equal(r.code, 0, r.err);
  const lines = r.out.split('\n');
  assert.ok(lines.includes("protection skipped: .github/workflows/ci.yml is not the kit's"));
  assert.ok(lines.includes('release-key skipped: no protection; releases use the built-in token'));
  assert.deepEqual(p.calls().filter((c) => c.argv[1] === '-X'), []);
  assert.equal(fs.existsSync(p.keyPath), false);
});

test("the kit's own ci.yml, even with CRLF line ends, still gets the ruleset", () => {
  const p = project({ origin: ORIGIN, gh: okGh(), ci: kitCi().replace(/\n/g, '\r\n') });
  const plan = p.run('plan');
  assert.match(plan.out, /^protection ruleset web bypass deploy-key$/m);
  const r = p.run('apply');
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^protection applied$/m);
  assert.equal(p.calls().filter((c) => c.argv[1] === '-X').length, 1);
});

test('a folder inside another repository is not treated as that repository', () => {
  const p = project({ origin: 'https://github.com/other/dotfiles.git', nested: true, gh: okGh() });
  const r = p.run('plan');
  assert.equal(r.code, 0, r.err);
  assert.ok(r.out.startsWith('repo create someone/my-shop public\n'), r.out);
  assert.ok(!r.out.includes('other/dotfiles'));
});

test('plan prints no release-key line when the ruleset list is forbidden', () => {
  const msg = 'gh: Upgrade to GitHub Pro (HTTP 403)';
  const gh = okGh().map((s) => (s.match.length === 2 && s.match[1] === RS ? { ...s, code: 1, stderr: `${msg}\n` } : s));
  const p = project({ origin: ORIGIN, gh });
  const r = p.run('plan');
  assert.equal(r.code, 0, r.err);
  assert.ok(r.out.split('\n').includes(`protection unavailable: ${msg}`));
  assert.doesNotMatch(r.out, /release-key/);
});
