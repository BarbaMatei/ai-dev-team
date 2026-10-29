import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { COLUMNS, buildRow, newPrs, parseReview, toCsvLine } from '../scripts/pr-metrics.mjs';

const script = fileURLToPath(new URL('../scripts/pr-metrics.mjs', import.meta.url));
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-pr-'));
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
  return r.stdout;
}
const BODY = 'Summary\nRounds: 2 · proven: 3 · discarded: 4 · unverified: 1\n';
const PR7 = { number: 7, headRefName: 'feat/y', createdAt: '2026-01-01T12:00:00Z', mergedAt: '2026-01-01T12:30:00Z', state: 'MERGED', body: BODY, commits: [{ authoredDate: '2026-01-01T10:00:00Z' }, { authoredDate: '2026-01-01T09:00:00Z' }] };

const FAKE_GH = (data) => `import fs from 'node:fs';
const d = JSON.parse(fs.readFileSync(${JSON.stringify(data)}, 'utf8'));
const a = process.argv.slice(2);
if (a[0] === 'pr' && a[1] === 'view') {
  const p = d.view[a[2]];
  if (!p) { process.stderr.write('no such pr'); process.exit(1); }
  process.stdout.write(JSON.stringify(p));
} else if (a[0] === 'pr' && a[1] === 'list') process.stdout.write(JSON.stringify(d.list));
else process.exit(1);
`;

function setup({ branch = 'main', init = 'main', config, prs = { 7: PR7 }, list, gitConfig, logLines } = {}) {
  const id = n++;
  const dir = path.join(base, `w${id}`);
  fs.mkdirSync(dir);
  git(dir, ['init', '-q', '-b', init]);
  if (gitConfig) git(dir, ['config', ...gitConfig]);
  if (config) {
    fs.mkdirSync(path.join(dir, '.claude'));
    fs.writeFileSync(path.join(dir, '.claude', 'ai-dev-team.json'), JSON.stringify(config));
  }
  git(dir, ['commit', '-q', '-m', 'init', '--allow-empty']);
  if (branch !== init && branch !== 'main') git(dir, ['checkout', '-q', '-b', branch]);
  const data = path.join(base, `data${id}.json`);
  fs.writeFileSync(data, JSON.stringify({ view: prs, list: list ?? Object.values(prs).map((p) => ({ number: p.number, mergedAt: p.mergedAt })) }));
  const gh = path.join(base, `fake-gh${id}.mjs`);
  fs.writeFileSync(gh, FAKE_GH(data));
  const logs = path.join(base, `logs${id}`);
  fs.mkdirSync(logs);
  const l = (mid, ts) => JSON.stringify({ type: 'assistant', timestamp: ts, gitBranch: 'feat/y', message: { id: mid, usage: { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 100, output_tokens: 7 } } });
  fs.writeFileSync(path.join(logs, 's.jsonl'), (logLines ? logLines(l) : [l('a', '2026-01-01T10:00:00Z'), l('a', '2026-01-01T10:00:00Z'), l('late', '2026-01-02T00:00:00Z')]).join('\n') + '\n');
  return { dir, gh: `node "${gh}"`, logs };
}
function run(s, args) {
  const r = spawnSync(process.execPath, [script, ...args, '--logs', s.logs, '--gh', s.gh], { cwd: s.dir, env: env(), encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const csv = (s) => path.join(s.dir, 'metrics', 'bolts.csv');
const HEADER = COLUMNS.join(',');
const ROW7 = '7,feat/y,2026-01-01T09:00:00Z,2026-01-01T12:30:00Z,3.5,2,3,4,1,122,15,100,7,1,0,22';

test('parseReview reads the pr-body line', () => {
  assert.deepEqual(parseReview(`a\n${BODY}b`), { rounds: 2, proven: 3, discarded: 4, unverified: 1 });
  assert.equal(parseReview('nothing here'), null);
});

test('buildRow uses the oldest commit and one decimal of hours', () => {
  const row = buildRow({ ...PR7, body: 'x' }, { input: 15, cacheRead: 100, output: 7, total: 122, sessions: 1, subagents: 0, first: null });
  assert.equal(row.bolt_start, '2026-01-01T09:00:00Z');
  assert.equal(row.hours_to_merge, '3.5');
  assert.deepEqual([row.review_rounds, row.findings_proven, row.findings_discarded, row.findings_unverified], ['', '', '', '']);
  assert.equal(row.tokens_total, 122);
});

test('toCsvLine quotes only when needed', () => {
  const row = Object.fromEntries(COLUMNS.map((c) => [c, c === 'pr' ? 'a,b' : c === 'branch' ? 'a"b' : 'x']));
  assert.ok(toCsvLine(row).startsWith('"a,b","a""b",x,'));
});

test('newPrs drops recorded and older, honours since, sorts by merge time', () => {
  const merged = [{ number: 5, mergedAt: '2026-01-05T00:00:00Z' }, { number: 3, mergedAt: '2026-01-03T00:00:00Z' }, { number: 4, mergedAt: '2026-01-04T00:00:00Z' }, { number: 2, mergedAt: '2026-01-02T00:00:00Z' }];
  const rows = [{ pr: '3', merged_at: '2026-01-03T00:00:00.5Z' }];
  assert.deepEqual(newPrs(merged, rows), [4, 5]);
  assert.deepEqual(newPrs(merged, []), []);
  assert.deepEqual(newPrs(merged, rows, 2), [2, 4, 5]);
});

test('--pr --dry-run prints header and row, writes nothing', () => {
  const s = setup();
  const r = run(s, ['--pr', '7', '--dry-run']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, `${HEADER}\n${ROW7}\n`);
  assert.equal(fs.existsSync(csv(s)), false);
});

test('--pr writes the file once and reports already recorded', () => {
  const s = setup();
  const r = run(s, ['--pr', '7']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, 'PR #7: 3.5h, 2 round(s), 122 tokens → metrics/bolts.csv\n');
  assert.equal(fs.readFileSync(csv(s), 'utf8'), `${HEADER}\n${ROW7}\n`);
  const before = fs.readFileSync(csv(s));
  const again = run(s, ['--pr', '7']);
  assert.equal(again.out, 'PR #7: already recorded\n');
  assert.deepEqual(fs.readFileSync(csv(s)), before);
});

test('--pr on a PR that is not merged exits 1', () => {
  const s = setup({ prs: { 8: { ...PR7, number: 8, mergedAt: null, state: 'OPEN' } } });
  const r = run(s, ['--pr', '8']);
  assert.equal(r.code, 1);
  assert.match(r.err, /PR #8 is not merged/);
});

test('--sync without a CSV and without since exits 2', () => {
  const s = setup();
  const r = run(s, ['--sync']);
  assert.equal(r.code, 2);
  assert.match(r.err, /metrics: set metrics\.since in \.claude\/ai-dev-team\.json or start with --pr <n>/);
});

test('--hook records on a PR branch and stages the file', () => {
  const s = setup({ branch: 'feat/y', config: { metrics: { since: 7 } } });
  const r = run(s, ['--hook']);
  assert.equal(r.code, 0, r.err);
  assert.equal(fs.readFileSync(csv(s), 'utf8'), `${HEADER}\n${ROW7}\n`);
  assert.equal(git(s.dir, ['diff', '--cached', '--name-only']).trim(), 'metrics/bolts.csv');
});

test('--hook does nothing on the default branch', () => {
  const s = setup({ config: { metrics: { since: 7 } } });
  const r = run(s, ['--hook']);
  assert.equal(r.code, 0);
  assert.equal(fs.existsSync(csv(s)), false);
});

test('--hook never blocks when gh fails', () => {
  const s = setup({ branch: 'feat/y', config: { metrics: { since: 7 } } });
  const r = spawnSync(process.execPath, [script, '--hook', '--logs', s.logs, '--gh', 'node does-not-exist.mjs'], { cwd: s.dir, env: env(), encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(fs.existsSync(csv(s)), false);
});

function slowGh(code) {
  const f = path.join(base, `gh-${n++}.mjs`);
  fs.writeFileSync(f, code);
  return f;
}

test('--sync exits 2 before calling gh when there is nothing to start from', () => {
  const s = setup();
  const marker = path.join(base, 'marker-sync');
  const gh = slowGh(`import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'x'); process.exit(1);`);
  const r = run({ ...s, gh: `node "${gh}"` }, ['--sync']);
  assert.equal(r.code, 2);
  assert.match(r.err, /set metrics\.since/);
  assert.equal(fs.existsSync(marker), false);
});

test('--hook with nothing to start from never calls gh', () => {
  const s = setup({ branch: 'feat/y' });
  const marker = path.join(base, 'marker-hook');
  const gh = slowGh(`import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'x'); setTimeout(() => {}, 10000);`);
  const t = Date.now();
  const r = run({ ...s, gh: `node "${gh}"` }, ['--hook']);
  assert.equal(r.code, 0);
  assert.ok(Date.now() - t < 5000);
  assert.equal(fs.existsSync(marker), false);
});

test('--hook stops at its deadline and kills a hanging gh', () => {
  const s = setup({ branch: 'feat/y', config: { metrics: { since: 7 } } });
  const gh = slowGh('setTimeout(() => process.stdout.write("[]"), 10000);');
  const t = Date.now();
  const r = run({ ...s, gh: `node "${gh}"` }, ['--hook', '--hook-timeout', '1']);
  assert.equal(r.code, 0);
  assert.ok(Date.now() - t < 6000, `took ${Date.now() - t} ms`);
  assert.equal(fs.existsSync(csv(s)), false);
});

test('--pr must be a number', () => {
  const s = setup();
  const r = run(s, ['--pr', '7; echo x']);
  assert.equal(r.code, 2);
  assert.match(r.err, /--pr/);
});

test('appending to a CSV without a final newline starts a new line', () => {
  const s = setup({ config: { metrics: { since: 7 } } });
  fs.mkdirSync(path.dirname(csv(s)));
  fs.writeFileSync(csv(s), `${HEADER}\n6,feat/z,a,2025-01-01T00:00:00Z,1.0,,,,,0,0,0,0,0,0`);
  const r = run(s, ['--pr', '7']);
  assert.equal(r.code, 0, r.err);
  const lines = fs.readFileSync(csv(s), 'utf8').split('\n');
  assert.equal(lines[2], ROW7);
});

test('invalid config exits 2 with one line', () => {
  const s = setup();
  fs.mkdirSync(path.join(s.dir, '.claude'));
  fs.writeFileSync(path.join(s.dir, '.claude', 'ai-dev-team.json'), '{nope');
  const r = run(s, ['--pr', '7']);
  assert.equal(r.code, 2);
  assert.match(r.err, /^metrics: \.claude\/ai-dev-team\.json: /);
});

test('gh output that is not JSON exits 1 normally and stays silent in the hook', () => {
  const s = setup({ branch: 'feat/y', config: { metrics: { since: 7 } } });
  const gh = slowGh('process.stdout.write("oops");');
  const bad = { ...s, gh: `node "${gh}"` };
  assert.equal(run(bad, ['--pr', '7']).code, 1);
  const h = run(bad, ['--hook']);
  assert.equal(h.code, 0);
  assert.equal(h.err, '');
});

test('--hook records one PR per commit and stages each row', () => {
  const mk = (num, day) => ({ ...PR7, number: num, mergedAt: `2026-01-0${day}T12:30:00Z`, body: 'x' });
  const s = setup({ branch: 'feat/y', config: { metrics: { since: 1 } }, prs: { 1: mk(1, 1), 2: mk(2, 2), 3: mk(3, 3) } });
  const r = run(s, ['--hook']);
  assert.equal(r.code, 0, r.err);
  const ids = () => fs.readFileSync(csv(s), 'utf8').trim().split('\n').map((l) => l.split(',')[0]);
  assert.deepEqual(ids(), ['pr', '1']);
  assert.equal(git(s.dir, ['diff', '--cached', '--name-only']).trim(), 'metrics/bolts.csv');
  git(s.dir, ['commit', '-q', '-m', 'c']);
  run(s, ['--hook']);
  assert.deepEqual(ids(), ['pr', '1', '2']);
});

test('--sync keeps the rows built before a later PR fails', () => {
  const s = setup({ config: { metrics: { since: 1 } }, prs: { 1: { ...PR7, number: 1 } }, list: [{ number: 1, mergedAt: '2026-01-01T12:30:00Z' }, { number: 2, mergedAt: '2026-01-02T00:00:00Z' }] });
  const r = run(s, ['--sync']);
  assert.equal(r.code, 1);
  assert.equal(fs.readFileSync(csv(s), 'utf8'), `${HEADER}
${ROW7.replace('7,', '1,')}
`);
});

test('--hook writes nothing on master or the configured default branch without a remote', () => {
  const m = setup({ init: 'master', config: { metrics: { since: 7 } } });
  assert.equal(run(m, ['--hook']).code, 0);
  assert.equal(fs.existsSync(csv(m)), false);
  const t = setup({ init: 'trunk', gitConfig: ['init.defaultBranch', 'trunk'], config: { metrics: { since: 7 } } });
  assert.equal(run(t, ['--hook']).code, 0);
  assert.equal(fs.existsSync(csv(t)), false);
});

test('bad --hook-timeout or empty --gh: one line, exit 2, exit 0 in the hook', () => {
  const s = setup({ branch: 'feat/y', config: { metrics: { since: 7 } } });
  const go = (args) => {
    const r = spawnSync(process.execPath, [script, ...args], { cwd: s.dir, env: env(), encoding: 'utf8' });
    return { code: r.status, err: r.stderr };
  };
  for (const bad of [['--hook-timeout', 'abc'], ['--hook-timeout', '0'], ['--hook-timeout', '-3'], ['--gh', '']]) {
    const a = go(['--sync', ...bad]);
    assert.equal(a.code, 2, bad.join(' '));
    assert.equal(a.err.trim().split('\n').length, 1);
    const h = go(['--hook', ...bad]);
    assert.equal(h.code, 0, bad.join(' '));
    assert.equal(h.err.trim().split('\n').length, 1);
  }
});

test('buildRow starts the bolt at the first log line when it is earlier than the first commit', () => {
  const row = buildRow(PR7, { input: 15, cacheRead: 0, output: 7, total: 22, sessions: 1, subagents: 0, first: '2026-01-01T07:30:00Z' });
  assert.equal(row.bolt_start, '2026-01-01T07:30:00Z');
  assert.equal(row.hours_to_merge, '5.0');
});

test('buildRow keeps the first commit when the log starts later or is missing', () => {
  const t = { input: 0, cacheRead: 0, output: 0, total: 0, sessions: 0, subagents: 0 };
  assert.equal(buildRow(PR7, { ...t, first: '2026-01-01T09:30:00Z' }).bolt_start, '2026-01-01T09:00:00Z');
  assert.equal(buildRow(PR7, { ...t, first: null }).bolt_start, '2026-01-01T09:00:00Z');
});

test('tokens_fresh is input plus output', () => {
  const row = buildRow(PR7, { input: 15, cacheRead: 100, output: 7, total: 122, sessions: 1, subagents: 0, first: null });
  assert.equal(row.tokens_fresh, 22);
  assert.equal(COLUMNS.at(-1), 'tokens_fresh');
});

test('--pr counts no tokens after the PR was opened and starts at an earlier log line', () => {
  const s = setup({ logLines: (l) => [l('early', '2026-01-01T08:00:00Z'), l('open', '2026-01-01T11:59:00Z'), l('chat', '2026-01-01T12:10:00Z')] });
  const r = run(s, ['--pr', '7', '--dry-run']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, `${HEADER}
7,feat/y,2026-01-01T08:00:00Z,2026-01-01T12:30:00Z,4.5,2,3,4,1,244,30,200,14,1,0,44
`);
});

test('a CSV with the old header gains tokens_fresh and keeps every old value', () => {
  const s = setup();
  fs.mkdirSync(path.dirname(csv(s)));
  const oldHeader = HEADER.replace(',tokens_fresh', '');
  fs.writeFileSync(csv(s), `${oldHeader}
6,"feat,z",a,2025-01-01T00:00:00Z,1.0,1,2,3,4,10,5,3,2,1,0
`);
  const r = run(s, ['--pr', '7']);
  assert.equal(r.code, 0, r.err);
  assert.equal(fs.readFileSync(csv(s), 'utf8'), `${HEADER}
6,"feat,z",a,2025-01-01T00:00:00Z,1.0,1,2,3,4,10,5,3,2,1,0,
${ROW7}
`);
});
