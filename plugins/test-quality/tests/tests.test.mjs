import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { base, git, put, repo, run as runIn } from './helpers.mjs';
import { changedTests, findTests } from '../scripts/tests.mjs';

const script = fileURLToPath(new URL('../scripts/tests.mjs', import.meta.url));
const run = (dir, args) => runIn(script, dir, args);
after(() => fs.rmSync(base, { recursive: true, force: true }));

const CS = 'public class CalcTests\n{\n    [Fact]\n    public void Adds_two()\n    {\n    }\n\n    [Theory]\n    [InlineData(1)]\n    public async Task Handles_x(int a)\n    {\n    }\n}\n';
const BASE_A = "import x from 'x';\nit('old', () => {\n  expect(1).toBe(1);\n});\nit('kept', () => {\n  expect(2).toBe(2);\n});\n";
const NEW_A = "import x from 'x';\nit('adds two', () => {\n  expect(3).toBe(3);\n});\nit('old', () => {\n  expect(10).toBe(1);\n});\nit('kept', () => {\n  expect(2).toBe(2);\n});\n";

function branchRepo(cs = CS) {
  const dir = repo({ 'src/a.test.ts': BASE_A, 'src/a.ts': 'export const a = 1;\n' });
  git(dir, ['checkout', '-q', '-b', 'feat']);
  put(dir, 'src/a.test.ts', NEW_A);
  put(dir, 'src/a.ts', 'export const a = 2;\n');
  put(dir, 'App.Tests/CalcTests.cs', cs);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'feat']);
  put(dir, 'src/b.spec.ts', 'test("works", () => {\n});\n');
  put(dir, 'dir with space/c.test.ts', "it('spaced', () => {\n});\n");
  put(dir, 'tests/test_calc.py', 'def test_sum():\n    assert True\n');
  put(dir, 'calc_test.go', 'func TestSum(t *testing.T) {\n}\n');
  return dir;
}

const EXPECTED = [
  'App.Tests/CalcTests.cs:3\tAdds_two',
  'App.Tests/CalcTests.cs:8\tHandles_x',
  'calc_test.go:1\tTestSum',
  'dir with space/c.test.ts:1\tspaced',
  'src/a.test.ts:2\tadds two',
  'src/a.test.ts:5\told',
  'src/b.spec.ts:1\tworks',
  'tests/test_calc.py:1\ttest_sum',
];

describe('tests.mjs list', () => {
  it('lists new and changed tests with file:line', () => {
    const r = run(branchRepo(), ['list']);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.out.trimEnd().split('\n'), [...EXPECTED, '8 new or changed test(s) in 6 file(s)']);
  });

  it('gives the same lines for a CRLF C# file', () => {
    const r = run(branchRepo(CS.replace(/\n/g, '\r\n')), ['list']);
    assert.deepEqual(r.out.trimEnd().split('\n').slice(0, 2), EXPECTED.slice(0, 2));
  });

  it('shows setup and each test body', () => {
    const r = run(branchRepo(), ['show']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /=== src\/a\.test\.ts \(setup, lines 1-1\)\nimport x from 'x';\n/);
    assert.match(r.out, /=== src\/a\.test\.ts:2-4 adds two\nit\('adds two', \(\) => \{\n  expect\(3\)\.toBe\(3\);\n\}\);\n/);
    assert.ok(!r.out.includes('kept'));
  });

  it('says so when the branch has no new tests', () => {
    const dir = repo({ 'src/a.test.ts': BASE_A });
    git(dir, ['checkout', '-q', '-b', 'feat']);
    const r = run(dir, ['list']);
    assert.equal(r.code, 0);
    assert.equal(r.out.trim(), 'no new or changed tests');
  });

  it('honours testQuality.testFiles', () => {
    const dir = branchRepo();
    put(dir, '.claude/ai-dev-team.json', JSON.stringify({ testQuality: { testFiles: ['spec/**/*.rb'] } }));
    assert.equal(run(dir, ['list']).out.trim(), 'no new or changed tests');
  });

  it('rejects an invalid config with exit 2', () => {
    const dir = branchRepo();
    put(dir, '.claude/ai-dev-team.json', '{bad');
    const r = run(dir, ['list']);
    assert.equal(r.code, 2);
    assert.match(r.err, /^test-quality: \.claude\/ai-dev-team\.json: /);
  });
});

describe('findTests / changedTests', () => {
  it('finds JS variants and spans', () => {
    const lines = ["test.only('a b', () => {", '});', "it.each([1])('c %s', () => {", '});', 'x'];
    const decls = findTests(lines, 'x.spec.ts');
    assert.deepEqual(decls, [{ line: 1, name: 'a b' }, { line: 3, name: 'c %s' }]);
    assert.deepEqual(changedTests(decls, new Set([4]), 5), [{ line: 3, end: 5, name: 'c %s' }]);
  });

  it('finds Java and Kotlin tests', () => {
    assert.deepEqual(findTests(['@Test', 'void sums() {', '}'], 'A.java'), [{ line: 1, name: 'sums' }]);
    assert.deepEqual(findTests(['@Test', 'fun sums() {', '}'], 'A.kt'), [{ line: 1, name: 'sums' }]);
  });
});

describe('tests.mjs fixes', () => {
  it('runs through a symlinked script path', () => {
    const link = path.join(base, 'tq-link');
    fs.symlinkSync(path.dirname(script), link, 'junction');
    const dir = branchRepo();
    const r = runIn(path.join(link, 'tests.mjs'), dir, ['list']);
    assert.match(r.out, /new or changed test\(s\)/);
  });

  it('diffs an explicit base from its merge-base', () => {
    const dir = repo({ 'src/m.test.ts': "it('m', () => {\n  z();\n});\n" });
    git(dir, ['checkout', '-q', '-b', 'feat']);
    git(dir, ['checkout', '-q', 'main']);
    put(dir, 'src/m.test.ts', "it('m', () => {\n  a();\n});\n");
    git(dir, ['commit', '-q', '-am', 'main edit']);
    git(dir, ['checkout', '-q', 'feat']);
    assert.equal(run(dir, ['list', '--base', 'main']).out.trim(), 'no new or changed tests');
  });

  it('rejects --base without a value', () => {
    const dir = branchRepo();
    for (const args of [['list', '--base'], ['list', '--base', '--x']]) {
      const r = run(dir, args);
      assert.equal(r.code, 2);
      assert.match(r.err, /^test-quality: .*--base/);
    }
  });

  it('finds C# tests after many attributes and ValueTask', () => {
    const data = Array.from({ length: 6 }, (_, i) => `    [InlineData(${i})]\n`).join('');
    const cs = `class T\n{\n    [Theory]\n${data}    // note\n\n    public void Many(int a)\n    {\n    }\n\n    [Fact]\n    public async ValueTask Vt()\n    {\n    }\n\n    [Fact]\n    int notATest;\n}\n`;
    const names = findTests(cs.split('\n'), 'T.cs').map((d) => d.name);
    assert.deepEqual(names, ['Many', 'Vt']);
  });

  it('lists a committed spaced file and a staged edit in an existing test', () => {
    const dir = repo({ 'src/a.test.ts': BASE_A });
    git(dir, ['checkout', '-q', '-b', 'feat']);
    put(dir, 'my dir/s.test.ts', "it('sp', () => {\n});\n");
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'sp']);
    put(dir, 'src/a.test.ts', BASE_A.replace('expect(2)', 'expect(5)'));
    git(dir, ['add', '-A']);
    const out = run(dir, ['list']).out.trimEnd().split('\n');
    assert.deepEqual(out, ['my dir/s.test.ts:1\tsp', 'src/a.test.ts:5\tkept', '2 new or changed test(s) in 2 file(s)']);
  });

  it('counts an added line that starts with ++', () => {
    const dir = repo({ 'src/a.test.ts': BASE_A });
    git(dir, ['checkout', '-q', '-b', 'feat']);
    put(dir, 'src/a.test.ts', BASE_A.replace('  expect(2)', '++ i;\n  expect(2)'));
    assert.match(run(dir, ['list']).out, /src\/a\.test\.ts:5\tkept/);
  });

  it('ignores diff prefix config', () => {
    const dir = branchRepo();
    git(dir, ['config', 'diff.noprefix', 'true']);
    assert.match(run(dir, ['list']).out, /src\/a\.test\.ts:2\tadds two/);
  });
});
