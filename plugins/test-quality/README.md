# test-quality

Checks that a branch's new tests can catch bugs and that every acceptance criterion has a test. Scripts find the new tests and the criteria; agents only judge. Plain Node (>= 22), no dependencies.

A test is decorative when it stays green even if the code it claims to check is wrong: it asserts nothing that could fail, asserts a mock's own answer, runs no production code, or swallows the failure.

## The pieces

| Piece | What it does |
|---|---|
| `check-tests` skill | Flags decorative new tests and maps each acceptance criterion to a test |
| `writing-tests` skill | The rules for writing a test that can fail |
| `test-critic` agent | Reads only the branch's new tests and flags decorative ones |
| `tests.mjs` | Lists or prints the tests a branch added or changed |
| `criteria.mjs` | Lists the acceptance criteria of story files or a specsmd `bolt.md` |

## In a specsmd bolt

Test stage: once the bolt's code and tests pass, run `/test-quality:check-tests`. It finds the `bolt.md` changed on the branch, reads its stories' acceptance criteria and replies in at most 12 lines:

```
DECORATIVE App.Tests/OrderTests.cs:14 Keeps_total — asserts the value it passed in — fix: call Order.Total() on two items and expect 30
checked: 4 · decorative: 1
coverage: 2/3
NONE memory-bank/intents/i1/units/u1/stories/s1.md:9 — Given an empty cart, Then checkout is refused
Next: fix each DECORATIVE test to assert behaviour, add a test per NONE criterion, then run check-tests again.
```

Fix those, run it again, then hand the branch to the review plugin's `review-bolt`. Outside specsmd, pass the criteria file: `/test-quality:check-tests --spec docs/story.md` (`--base <ref>` when the default base is wrong). No new tests and no spec → `no new or changed tests`; no spec → `coverage skipped: no spec found`.

## Scripts

```
node scripts/tests.mjs list|show [--base <ref>]
node scripts/criteria.mjs <file>...
```

- `tests.mjs list`: one `<file>:<line>\t<name>` per test the branch added or changed, then `<n> new or changed test(s) in <m> file(s)` or `no new or changed tests`. Committed, uncommitted and untracked changes all count.
- `tests.mjs show`: per file `=== <file> (setup, lines 1-<k>)` and its setup lines, then per test `=== <file>:<line>-<end> <name>` and its lines.
- Base: `--base <ref>` is diffed from its merge-base with HEAD; the default is the merge-base with `origin/HEAD`, else `main`.
- Tests are found in JavaScript/TypeScript (`it`, `test`), C# (`[Fact]`, `[Theory]`, `[Test]`, `[TestMethod]` ...), Java/Kotlin (`@Test`), Python (`test_*`) and Go (`Test*`).
- `criteria.mjs`: one `<file>:<line>\t<criterion>` per item under an "Acceptance Criteria" heading, then `<n> criteria in <m> file(s)`. A `bolt.md` expands to its stories (frontmatter `intent`, `unit`, `stories`). A missing file exits 2.

## Config

`<project>/.claude/ai-dev-team.json`, optional:

```json
{ "testQuality": { "testFiles": ["tests/**/*.test.ts", "**/*Tests.cs"] } }
```

`testQuality.testFiles`: globs of test files; replaces the default `**/*.test.*`, `**/*.spec.*`, `**/*Tests.cs`, `**/*Test.cs`, `**/*Test.java`, `**/*Tests.java`, `**/*Test.kt`, `**/test_*.py`, `**/*_test.py`, `**/*_test.go`. Invalid config: one line on stderr, exit 2.

## Install

```
/plugin marketplace add BarbaMatei/ai-dev-team
/plugin install test-quality@ai-dev-team
```
