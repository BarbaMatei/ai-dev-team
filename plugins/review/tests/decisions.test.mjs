import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { base, repo, run as runScript } from './helpers.mjs';
import { splitEntries, scoreEntry } from '../scripts/decisions.mjs';

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'decisions.mjs');
after(() => fs.rmSync(base, { recursive: true, force: true }));

const md = [
  '# Index',
  '## How to use',
  'Read the entries.',
  '### ADR-001 Banker rounding on money',
  'Use midpoint rounding to even. See [rounding](docs/adr-001.md).',
  '### ADR-002 Invoice rendering',
  'The InvoiceRenderer class owns layout. See [layout](docs/adr-002.md).',
  '### ADR-003 Session storage',
  'Tokens stay in memory.',
  '',
].join('\n');

const dir = () => repo({ 'docs/decisions.md': md }, { decisions: 'docs/decisions.md' });
const run = (d, file, text) => runScript(script, d, ['--path', file, '--text', text]);

test('splitEntries uses the most frequent heading level', () => {
  const e = splitEntries(md);
  assert.deepEqual(e.map((x) => x.heading), ['ADR-001 Banker rounding on money', 'ADR-002 Invoice rendering', 'ADR-003 Session storage']);
});

test('splitEntries without headings gives one entry per non-empty line', () => {
  assert.deepEqual(splitEntries('one\n\ntwo\n').map((x) => x.heading), ['one', 'two']);
});

test('scoreEntry weights the file name and shared long words', () => {
  const e = { heading: 'H', body: 'The InvoiceRenderer handles rounding of the midpoint' };
  assert.equal(scoreEntry(e, 'src/x/InvoiceRenderer.cs', 'nothing'), 3);
  assert.equal(scoreEntry(e, 'src/x/a.cs', 'rounding the midpoint'), 2);
  assert.equal(scoreEntry(e, 'src/x/a.cs', 'about these'), 0);
});

test('a finding on a file named in an ADR matches it', () => {
  const r = run(dir(), 'src/x/InvoiceRenderer.cs', 'wrong margin');
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out.trim(), 'decision: ADR-002 Invoice rendering (docs/adr-002.md)');
});

test('three shared long words match', () => {
  const r = run(dir(), 'src/m.cs', 'rounding at the midpoint breaks the money total');
  assert.match(r.out, /decision: ADR-001 Banker rounding on money \(docs\/adr-001\.md\)/);
});

test('an unrelated finding matches nothing', () => {
  assert.equal(run(dir(), 'src/q.cs', 'button colour is wrong').out.trim(), 'no matching decision');
});

test('no decisions key means no decisions file configured', () => {
  const r = run(repo({}, {}), 'a.cs', 'x');
  assert.equal(r.code, 0);
  assert.equal(r.out.trim(), 'no decisions file configured');
});

test('a configured file that is missing exits 2', () => {
  const r = run(repo({}, { decisions: 'nope.md' }), 'a.cs', 'x');
  assert.equal(r.code, 2);
  assert.match(r.err, /^review: decisions file not found: nope\.md\n$/);
});

test('a decisions path that is a directory exits 2', () => {
  const r = run(repo({ 'docs/x.md': 'x' }, { decisions: 'docs' }), 'a.cs', 'x');
  assert.equal(r.code, 2);
  assert.match(r.err, /^review: decisions file not found: docs\n$/);
});

test('a non-string decisions key exits 2', () => {
  const r = run(repo({}, { decisions: 5 }), 'a.cs', 'x');
  assert.equal(r.code, 2);
  assert.match(r.err, /^review: \.claude\/ai-dev-team\.json: /);
});
