import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SECRET_PATTERNS, DEFAULT_COMMENT_EXTENSIONS, findSecrets, isCommentLine } from '../scripts/checks.mjs';

const a = (n) => 'a'.repeat(n);
const samples = {
  privateKey: ['-----BEGIN', 'RSA PRIVATE KEY-----'].join(' '),
  aws: 'AKIA' + 'A'.repeat(16),
  github: ['ghp', a(36)].join('_'),
  githubPat: ['github', 'pat', a(22)].join('_'),
  stripeLive: ['sk', 'live', a(24)].join('_'),
  stripeRestricted: ['rk', 'live', a(24)].join('_'),
  webhook: ['whsec', a(24)].join('_'),
  slack: 'xoxb-' + '1'.repeat(12),
  google: 'AIza' + a(35),
  anthropic: ['sk-ant', a(24)].join('-'),
  openai: ['sk-proj', a(24)].join('-'),
};

for (const [name, sample] of Object.entries(samples)) {
  test(`a default pattern matches the ${name} sample`, () => {
    assert.ok(DEFAULT_SECRET_PATTERNS.some((p) => new RegExp(p).test(sample)));
    assert.deepEqual(findSecrets(['x', sample], []), [2]);
  });
}

test('findSecrets honours extra patterns and ignores clean lines', () => {
  const extra = ['pk_live_[0-9A-Za-z]{16,}'];
  const sample = ['pk', 'live', a(20)].join('_');
  assert.deepEqual(findSecrets(['x', sample], extra), [2]);
  assert.deepEqual(findSecrets(['x', sample]), []);
  assert.deepEqual(findSecrets(['hello', 'world'], extra), []);
});

test('default comment extensions include the common code files', () => {
  for (const e of ['.cs', '.ts', '.mjs', '.scss']) assert.ok(DEFAULT_COMMENT_EXTENSIONS.includes(e));
  assert.ok(!DEFAULT_COMMENT_EXTENSIONS.includes('.md'));
});

test('isCommentLine detects comments', () => {
  for (const l of ['  // a', '/* a', 'int x; // a', '/// a', 'x //']) assert.equal(isCommentLine(l), true, l);
});

test('isCommentLine ignores URLs and unspaced slashes', () => {
  for (const l of ['var u = "http://x";', 'a //b', 'a// b', 'plain']) assert.equal(isCommentLine(l), false, l);
});
