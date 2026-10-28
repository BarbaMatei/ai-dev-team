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
const PR7 = { number: 7, headRefName: 'feat/y', mergedAt: '2026-01-01T12:30:00Z', state: 'MERGED', body: BODY, commits: [{ authoredDate: '2026-01-01T10:00:00Z' }, { authoredDate: '2026-01-01T09:00:00Z' }] };

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

function setup({ branch = 'main', config, prs = { 7: PR7 } } = {}) {
  const id = n++;
  const dir = path.join(base, `w${id}`);
  fs.mkdirSync(dir);
  git(dir, ['init', '-q', '-b', 'main']);
  if (config) {
    fs.mkdirSync(path.join(dir, '.claude'));
    fs.writeFileSync(path.join(dir, '.claude', 'ai-dev-team.json'), JSON.stringify(config));
  }
  git(dir, ['commit', '-q', '-m', 'init', '--allow-empty']);
  if (branch !== 'main') git(dir, ['checkout', '-q', '-b', branch]);
  const data = path.join(base, `data${id}.json`);
  fs.writeFileSync(data, JSON.stringify({ view: prs, list: Object.values(prs).map((p) => ({ number: p.number, mergedAt: p.mergedAt })) }));
  const gh = path.join(base, `fake-gh${id}.mjs`);
  fs.writeFileSync(gh, FAKE_GH(data));
  const logs = path.join(base, `logs${id}`);
  fs.mkdirSync(logs);
  const l = (mid, ts) => JSON.stringify({ type: 'assistant', timestamp: ts, gitBranch: 'feat/y', message: { id: mid, usage: { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 100, output_tokens: 7 } } });
  fs.writeFileSync(path.join(logs, 's.jsonl'), [l('a', '2026-01-01T10:00:00Z'), l('a', '2026-01-01T10:00:00Z'), l('late', '2026-01-02T00:00:00Z')].join('\n') + '\n');
  return { dir, gh: `node "${gh}"`, logs };
}
function run(s, args) {
  const r = spawnSync(process.execPath, [script, ...args, '--logs', s.logs, '--gh', s.gh], { cwd: s.dir, env: env(), encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const csv = (s) => path.join(s.dir, 'metrics', 'bolts.csv');
const HEADER = COLUMNS.join(',');
const ROW7 = '7,feat/y,2026-01-01T09:00:00Z,2026-01-01T12:30:00Z,3.5,2,3,4,1,122,15,100,7,1,0';

test('parseReview reads the pr-body line', () => {
  assert.deepEqual(parseReview(`a\n${BODY}b`), { rounds: 2, proven: 3, discarded: 4, unverified: 1 });
  assert.equal(parseReview('nothing here'), null);
});

test('buildRow uses the oldest commit and one decimal of hours', () => {
  const row = buildRow({ ...PR7, body: 'x' }, { input: 15, cacheRead: 100, output: 7, total: 122, sessions: 1, subagents: 0 });
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
