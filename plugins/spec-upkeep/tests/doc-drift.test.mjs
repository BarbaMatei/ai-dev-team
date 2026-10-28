import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { base, repo, run as runScript } from './helpers.mjs';

after(() => fs.rmSync(base, { recursive: true, force: true }));

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts/doc-drift.mjs');
const run = (dir, ...args) => runScript(script, dir, args);

const stale = [
  ['`src/app/Missing.cs`', 'path', 'src/app/Missing.cs', 'no such file'],
  ['`src/app/Order.cs:999`', 'path', 'src/app/Order.cs:999', 'line 999 past end of src/app/Order.cs (3 lines)'],
  ['`src/nope/*.cs`', 'path', 'src/nope/*.cs', 'no match'],
  ['`OrderService.Vanished`', 'symbol', 'OrderService.Vanished', 'symbol Vanished not in code'],
  ['`npm run lint`', 'command', 'npm run lint', 'npm script lint not found'],
  ['`dotnet test src/gone`', 'command', 'dotnet test src/gone', 'no such file src/gone'],
  ['[gone](docs/zz.md)', 'link', 'docs/zz.md', 'no such file'],
];
const clean = [
  '`src/app/Order.cs`', '`src/app/Order.cs:2`', '`app/Order.cs`', '`Order.cs`', '`src/app/*.cs`',
  '`OrderService.ExecuteUpdate()`', '`STORAGE_KEY`', '`npm test`', '`dotnet test src/app`',
  '[a](docs/a.md)', '[s](dir%20with%20space/b.md)', '[w](https://example.com)',
  '`appsettings.{Environment}.Local.json`', '`/api/orders/{id}`', '`STORAGE_TEST_*`', '`bug`', '`<Namespace.OrClass>`',
];
const claude = ['# Doc', ...clean, ...stale.map((s) => s[0]), '```sh', '$ npm run lint', '```', '```json', '{"x": "src/nope"}', '```'];

const files = (extra = {}) => ({
  'src/app/Order.cs': 'class OrderService {\n  void ExecuteUpdate() {} // STORAGE_KEY\n}\n',
  'package.json': JSON.stringify({ scripts: { test: 'x', build: 'y' } }),
  'docs/a.md': '# a\n',
  'dir with space/b.md': '# b\n',
  'notes.md': 'Vanished\n',
  'CLAUDE.md': claude.join('\r\n') + '\r\n',
  ...extra,
});

test('reports exactly the stale citations, with CRLF-correct lines', () => {
  const r = run(repo(files()));
  assert.equal(r.code, 1, r.out + r.err);
  const lines = r.out.trim().split('\n').map((l) => l.trimEnd());
  const expected = stale.map(([cite, kind, text, why]) => `CLAUDE.md:${claude.indexOf(cite) + 1}: ${kind} \`${text}\` — ${why}`);
  expected.push(`CLAUDE.md:${claude.indexOf('$ npm run lint') + 1}: command \`npm run lint\` — npm script lint not found`);
  assert.deepEqual(lines.slice(0, -1).sort(), expected.sort());
  assert.equal(lines.at(-1), 'doc-drift: 8 stale reference(s) in 1 file(s)');
});

test('default files cover rules and standards but not other docs', () => {
  const r = run(repo(files({
    'CLAUDE.md': '# ok\n',
    '.claude/rules/x.md': '`src/gone.cs`\n',
    'memory-bank/standards/y.md': '`src/gone2.cs`\n',
    'docs/a.md': '`src/gone3.cs`\n',
  })));
  assert.equal(r.code, 1);
  assert.match(r.out, /^\.claude\/rules\/x\.md:1: path/m);
  assert.match(r.out, /^memory-bank\/standards\/y\.md:1: path/m);
  assert.doesNotMatch(r.out, /docs\/a\.md/);
  assert.match(r.out, /2 stale reference\(s\) in 2 file\(s\)/);
});

test('docDrift.files replaces the default list', () => {
  const dir = repo(files({ 'CLAUDE.md': '# ok\n', 'docs/a.md': '`src/gone3.cs`\n', '.claude/ai-dev-team.json': JSON.stringify({ docDrift: { files: ['docs/*.md'] } }) }));
  const r = run(dir);
  assert.equal(r.code, 1);
  assert.match(r.out, /^docs\/a\.md:1: path/m);
});

test('docDrift.ignore drops an exact citation', () => {
  const dir = repo(files({ '.claude/ai-dev-team.json': JSON.stringify({ docDrift: { ignore: ['src/app/Missing.cs'] } }) }));
  const r = run(dir);
  assert.doesNotMatch(r.out, /Missing\.cs/);
  assert.match(r.out, /7 stale reference\(s\)/);
});

test('exits 0 with a clean summary when every citation holds', () => {
  const r = run(repo(files({ 'CLAUDE.md': clean.join('\n') + '\n' })));
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^doc-drift: clean \(\d+ references in 1 files\)$/m);
});

test('--root checks another directory', () => {
  const dir = repo(files({ 'CLAUDE.md': '`src/gone.cs`\n' }));
  const r = run(path.dirname(dir), '--root', dir);
  assert.equal(r.code, 1);
  assert.match(r.out, /CLAUDE\.md:1: path/);
});

test('invalid config exits 2 with one line on stderr', () => {
  const r = run(repo(files({ '.claude/ai-dev-team.json': '{nope' })));
  assert.equal(r.code, 2);
  assert.match(r.err, /^spec-upkeep: \.claude\/ai-dev-team\.json: /);
});

test('docDrift with a wrong type exits 2', () => {
  const r = run(repo(files({ '.claude/ai-dev-team.json': JSON.stringify({ docDrift: { files: 'x' } }) })));
  assert.equal(r.code, 2);
  assert.match(r.err, /^spec-upkeep: \.claude\/ai-dev-team\.json: docDrift\.files/);
});

const cite = (lines, extra = {}) => run(repo({ ...files({ 'CLAUDE.md': lines.join('\n') + '\n' }), ...extra }));

test('git and gh arguments are never path-checked; other tools skip URLs and scoped packages', () => {
  const r = cite(['`git checkout -b feature/x`', '`git commit -m "fix a/b"`', '`gh repo clone o/r`', '`npx @angular/cli new x`', '`docker pull https://r.io/a/b`']);
  assert.equal(r.code, 0, r.out);
});

test('a bare name that is a package dependency is clean, a missing one is stale', () => {
  const pkg = JSON.stringify({ scripts: { test: 'x' }, dependencies: { 'chart.js': '1' }, devDependencies: { 'vitest.mjs': '1' } });
  assert.equal(cite(['`chart.js`', '`vitest.mjs`'], { 'package.json': pkg }).code, 0);
  assert.equal(cite(['`other.js`'], { 'package.json': pkg }).code, 1);
});

test('loose path cites match by suffix only, not by a middle run of segments', () => {
  const r = cite(['`a/b/c/d.cs`', '`b/c/d.cs`', '`b/c`', '`app/Missing.cs`'], { 'a/b/c/d.cs': 'x\n' });
  assert.equal(r.code, 1);
  assert.deepEqual(r.out.match(/^CLAUDE\.md:\d+/gm), ['CLAUDE.md:3', 'CLAUDE.md:4']);
});

test('a file:N cite on a directory is not resolved as a file', () => {
  assert.equal(cite(['`src/app:5`']).code, 0);
});

test('a tracked file deleted in the working tree is stale and a deleted doc is skipped', () => {
  const dir = repo(files({ 'CLAUDE.md': '`src/app/Order.cs:2`\n', 'memory-bank/standards/gone.md': '`src/nope.cs`\n' }));
  fs.rmSync(path.join(dir, 'src/app/Order.cs'));
  fs.rmSync(path.join(dir, 'memory-bank/standards/gone.md'));
  const r = run(dir);
  assert.equal(r.code, 1, r.err);
  assert.equal(r.err, '');
  assert.match(r.out, /^CLAUDE\.md:1: path `src\/app\/Order\.cs:2` — no such file$/m);
  assert.match(r.out, /1 stale reference\(s\) in 1 file\(s\)/);
});

test('a large report is written in full', () => {
  const many = Array.from({ length: 3000 }, (_, i) => `\`src/gone/f${i}.cs\``);
  const r = cite(many);
  assert.equal(r.code, 1);
  assert.match(r.out, /doc-drift: 3000 stale reference\(s\) in 1 file\(s\)\s*$/);
});
