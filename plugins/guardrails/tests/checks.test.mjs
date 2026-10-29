import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SECRET_PATTERNS, DEFAULT_COMMENT_EXTENSIONS, findSecrets, isCommentLine, unscopedTestReason } from '../scripts/checks.mjs';

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

const guardCases = [
  ['dotnet test src/X.Tests --filter "FullyQualifiedName~A"', 'bash', null],
  ['dotnet test src/X.Tests', 'bash', '--filter'],
  ['dotnet test --list-tests', 'bash', null],
  ["npm test -- --watch=false --include='**/a*.spec.ts'", 'bash', null],
  ['cd ui && npm test -- --watch=false', 'bash', 'test filter'],
  ['npx ng test --watch=false --include="**/a*.spec.ts"', 'powershell', null],
  ['npm test -- --watch=false --include="**/a*.spec.ts"', 'powershell', 'PowerShell'],
  ['npx vitest run', 'bash', 'filter'],
  ['npx vitest run src/a.spec.ts', 'bash', null],
  ['git commit -m "run dotnet test later"', 'bash', null],
  ['grep -rn "npm test" docs', 'bash', null],
  ['echo hi', 'bash', null],
  ['CI=1 npm test', 'bash', 'npm test without'],
  ['FOO=bar dotnet test x', 'bash', '--filter'],
  ['npm test -- -t foo', 'bash', null],
  ['npm test -- path/a.test.js', 'bash', null],
  ['npm run test:e2e', 'bash', null],
  ['npm test -- --watch=false', 'bash', 'npm test without a test filter'],
  ['npx ng test --watch=false', 'bash', 'ng test without --include'],
  ['npm test -- "src/a.test.js"', 'bash', null],
  ["npm test -- 'src/a b.test.js'", 'bash', null],
  ['yarn test -t foo', 'bash', null],
  ['pnpm test src/a.test.js', 'bash', null],
  ['pnpm test', 'bash', 'pnpm test without a test filter'],
  ['npm test -- "--watch=false"', 'bash', 'npm test without a test filter'],
  ['pnpm test "--watch=false"', 'bash', 'pnpm test without a test filter'],
  ['npm test -- "--include=a.spec.ts"', 'bash', null],
  ['npx ng test "--include=x"', 'bash', null],
  ['cat <<EOF\nnpm test\nEOF', 'bash', null],
  ["cat <<'EOF' > notes.txt\nnpm test\nEOF\ndotnet test x", 'bash', '--filter'],
  ['echo "x; npm test"', 'bash', null],
  ['npm test -- --watch=false 2>&1 | tail -5', 'bash', 'npm test without a test filter'],
  ["# don't block this\necho 'a; dotnet test b'", 'bash', null],
  ['# setup\ndotnet test x', 'bash', '--filter'],
  ["git commit -m @'\nfix: don't hang\ndotnet test now scoped\n'@", 'powershell', null],
  ['echo a#b; dotnet test x', 'bash', '--filter'],
];

for (const [command, shell, expected] of guardCases) {
  test(`unscopedTestReason: ${shell} ${command}`, () => {
    const r = unscopedTestReason(command, shell);
    if (expected === null) assert.equal(r, null);
    else assert.ok(r?.includes(expected), String(r));
  });
}
