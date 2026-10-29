import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/context.mjs', import.meta.url));
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'arch-'));
after(() => fs.rmSync(base, { recursive: true, force: true }));
let n = 0;

function env() {
  const e = { ...process.env };
  for (const k of Object.keys(e)) if (k.startsWith('GIT_')) delete e[k];
  return e;
}
function git(cwd, args) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd, env: env(), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
}

const FAKE_GH = (data) => `import fs from 'node:fs';
const d = JSON.parse(fs.readFileSync(${JSON.stringify(data)}, 'utf8'));
const a = process.argv.slice(2);
if (d.fail) process.exit(1);
if (a[0] === 'issue' && a[1] === 'list') {
  const i = a.indexOf('--label');
  process.stdout.write(JSON.stringify(i >= 0 ? d.proposals : d.issues));
} else if (a[0] === 'issue' && a[1] === 'view') {
  if (!d.known.includes(Number(a[2]))) { process.stderr.write('not found'); process.exit(1); }
  process.stdout.write(JSON.stringify({ number: Number(a[2]) }));
} else process.exit(1);
`;

function setup({ files = {}, config, gh = {} } = {}) {
  const id = n++;
  const dir = path.join(base, `w${id}`);
  fs.mkdirSync(dir);
  git(dir, ['init', '-q', '-b', 'main']);
  const all = { ...files };
  if (config) all['.claude/ai-dev-team.json'] = JSON.stringify(config);
  for (const [f, text] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), text);
  }
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'init', '--allow-empty']);
  const data = path.join(base, `data${id}.json`);
  fs.writeFileSync(data, JSON.stringify({ issues: [], proposals: [], known: [], ...gh }));
  const fake = path.join(base, `fake-gh${id}.mjs`);
  fs.writeFileSync(fake, FAKE_GH(data));
  return { dir, gh: `node "${fake}"` };
}

function run(dir, args) {
  const r = spawnSync(process.execPath, [script, ...args], { cwd: dir, env: env(), encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const section = (out, name) => out.split(/^## /m).find((s) => s.startsWith(name)) ?? '';

test('brief lists a spec containing the topic with status and heading, skips one without', () => {
  const { dir, gh } = setup({
    files: {
      'memory-bank/intents/a/requirements.md': '---\nstatus: draft\n---\n# Orders intake\nCustomers place ORDERS.\n',
      'memory-bank/intents/b/requirements.md': '# Billing\nNothing relevant.\n',
      'memory-bank/intents/c/requirements.md': 'no heading about orders\n',
    },
  });
  const r = run(dir, ['brief', 'orders', '--gh', gh]);
  assert.equal(r.code, 0, r.err);
  const s = section(r.out, 'Specs');
  assert.match(s, /memory-bank\/intents\/a\/requirements\.md \[draft\] Orders intake/);
  assert.match(s, /memory-bank\/intents\/c\/requirements\.md \[-\] requirements\.md/);
  assert.doesNotMatch(s, /intents\/b\//);
});

test('specs globs come from the config', () => {
  const { dir, gh } = setup({
    config: { architect: { specs: ['docs/*.md'] } },
    files: { 'docs/one.md': '# One\norders\n', 'memory-bank/intents/a/requirements.md': '# A\norders\n' },
  });
  const s = section(run(dir, ['brief', 'orders', '--gh', gh]).out, 'Specs');
  assert.match(s, /docs\/one\.md/);
  assert.doesNotMatch(s, /intents/);
});

test('code section orders tracked non-Markdown files by hit count', () => {
  const { dir, gh } = setup({
    files: {
      'src/app/a.ts': 'orders\n',
      'src/app/b.ts': 'orders orders\norders\n',
      'src/app/c.ts': 'nothing\n',
      'notes.md': 'orders orders orders orders\n',
    },
  });
  const s = section(run(dir, ['brief', 'Orders', '--gh', gh]).out, 'Code');
  const lines = s.split('\n').filter((l) => l.startsWith('src/'));
  assert.deepEqual(lines, ['src/app/b.ts 2', 'src/app/a.ts 1']);
  assert.doesNotMatch(s, /notes\.md/);
});

test('--area lists the files of a rule file paths glob with line total', () => {
  const { dir, gh } = setup({
    files: {
      '.claude/rules/shop.md': '---\npaths: ["src/shop/**"]\n---\nrule\n',
      'src/shop/a.ts': '1\n2\n3\n',
      'src/shop/b.ts': '1\n',
      'src/other.ts': '1\n',
    },
  });
  const s = section(run(dir, ['brief', 'x', '--area', 'shop', '--gh', gh]).out, 'Area files');
  assert.match(s, /src\/shop\/a\.ts 3/);
  assert.match(s, /src\/shop\/b\.ts 1/);
  assert.doesNotMatch(s, /other\.ts/);
  assert.match(s, /total: 2 files, 4 lines/);
});

test('unknown --area exits 2 and lists area names', () => {
  const { dir, gh } = setup({ config: { areas: { shop: ['src/**'], ship: ['lib/**'] } } });
  const r = run(dir, ['brief', 'x', '--area', 'nope', '--gh', gh]);
  assert.equal(r.code, 2);
  assert.match(r.err, /unknown area 'nope'; known: shop, ship/);
});

test('open issues and proposals are listed from gh', () => {
  const { dir, gh } = setup({
    gh: {
      issues: [{ number: 12, title: 'Orders are slow', labels: [{ name: 'bug' }] }],
      proposals: [{ number: 15, title: 'Add order export', labels: [{ name: 'proposal' }] }],
    },
  });
  const r = run(dir, ['brief', 'orders', '--gh', gh]);
  assert.match(section(r.out, 'Open issues'), /#12 Orders are slow \[bug\]/);
  assert.match(section(r.out, 'Open proposals'), /#15 Add order export \[proposal\]/);
});

test('failing gh marks the sections unavailable and still exits 0', () => {
  const { dir, gh } = setup({ gh: { fail: true } });
  const r = run(dir, ['brief', 'orders', '--gh', gh]);
  assert.equal(r.code, 0);
  assert.match(section(r.out, 'Open issues'), /\(gh unavailable\)/);
  assert.match(section(r.out, 'Open proposals'), /\(gh unavailable\)/);
});

const REPO = { 'src/x.ts': 'a\nb\nc\n', 'docs/n.md': 'x\n' };
function check(block, gh = {}, files = REPO) {
  const { dir, gh: cmd } = setup({ files, gh: { known: [3], ...gh } });
  const f = path.join(base, `p${n++}.md`);
  fs.writeFileSync(f, block);
  return run(dir, ['check', f, '--gh', cmd]);
}

test('check accepts valid cites and issue refs', () => {
  const r = check('## Add export\nSee `src/x.ts:2-3` and `src/x.ts`; extends #3.\n');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /cites: ok \(3\)/);
});

test('check flags a line past the end of the file', () => {
  const r = check('## T\nSee `src/x.ts:999`.\n');
  assert.equal(r.code, 1);
  assert.match(r.out, /bad src\/x\.ts:999 — /);
});

test('check flags a path that is not tracked', () => {
  const r = check('## T\nSee `src/gone.ts` and `src/x.ts`.\n');
  assert.equal(r.code, 1);
  assert.match(r.out, /bad src\/gone\.ts — /);
});

test('check flags an unknown issue number', () => {
  const r = check('## T\nSee `src/x.ts:1` and #7.\n');
  assert.equal(r.code, 1);
  assert.match(r.out, /bad #7 — /);
});

test('check reports issue refs unchecked when gh is unavailable', () => {
  const r = check('## T\nSee `src/x.ts:1` and #7.\n', { fail: true });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /unchecked #7/);
  assert.match(r.out, /cites: ok/);
});

test('check flags a block that cites only Markdown files', () => {
  const r = check('## Docs only\nSee `docs/n.md:1`.\n');
  assert.equal(r.code, 1);
  assert.match(r.out, /no-code-cite Docs only/);
});

test('check judges each block on its own', () => {
  const r = check('## Good\n`src/x.ts:1`\n\n## Bare\nno cites here\n');
  assert.equal(r.code, 1);
  assert.match(r.out, /no-code-cite Bare/);
  assert.doesNotMatch(r.out, /no-code-cite Good/);
});

test('check tags each bad cite with its block title', () => {
  const r = check('## First\n`src/x.ts:1`\n\n## Second\n`src/x.ts:1` `src/missing.ts`\n');
  assert.equal(r.code, 1);
  assert.match(r.out, /bad src\/missing\.ts — .* \(in "Second"\)/);
});

test('check ignores dotted names that are not paths', () => {
  const r = check('## T\n`Orders.IdempotencyKey` `v1.2` `src/x.ts:1`\n');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /cites: ok \(1\)/);
});

test('check counts a tracked root file cite without a slash', () => {
  const r = check('## T\n`README.md` `src/x.ts:1`\n', {}, { ...REPO, 'README.md': 'hi\n' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /cites: ok \(2\)/);
});

test('check flags an untracked path with a slash', () => {
  const r = check('## T\n`src/missing.ts` `src/x.ts:1`\n');
  assert.equal(r.code, 1);
  assert.match(r.out, /bad src\/missing\.ts — /);
});

test('non-object architect config exits 2', () => {
  for (const architect of [null, 5, ['x']]) {
    const { dir, gh } = setup({ config: { architect } });
    const r = run(dir, ['brief', 'x', '--gh', gh]);
    assert.equal(r.code, 2, JSON.stringify(architect));
    assert.match(r.err, /architect must be an object/);
  }
});
