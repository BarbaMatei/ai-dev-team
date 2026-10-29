---
name: prove-findings
description: Use after any code review (/code-review, /security-review, an area sweep) to keep only the findings a failing test proves. Drops style, doc and "consider" items, has a fresh subagent write the smallest failing test for each remaining finding, and returns at most 10 lines (more only when more than 9 findings are proven).
---

# Prove findings

A review finding survives only when a fresh subagent's test fails for the claimed reason. You orchestrate and judge; you never write or run a proving test yourself.

- **Input:** the findings in this conversation and the base ref the review compared against. None given: `git merge-base HEAD origin/HEAD`, or `main` if that fails.
- **Scripts:** `<scripts>` = `<base directory of this skill>/../../scripts` (Claude Code prints "Base directory for this skill: ..." when this skill loads). Run them from the project root.
- **Tests:** `tests` in `<project>/.claude/ai-dev-team.json`; each `<kind>` has a `command` containing `{filter}` and an optional `cwd` relative to the project root.

## Rule checklist

1. Run `node "<scripts>/areas.mjs" touched --base <base>`. Rule files = the third column of each area line; skip `-` and the `trigger:` line. None: go to Filter.
2. Dispatch one Agent (`subagent_type: general-purpose`, `model: haiku`) with this prompt: "Read these rule files: <paths>. Each applies only to files matching its `paths:`. Run `git diff <base>...HEAD` (`git diff HEAD` if only uncommitted changes were reviewed), and read every untracked file `git status --porcelain` lists as `??` (all its lines are added). For each added line that breaks a rule print `<file:line> — <what breaks> (rule: <rule file>)`. Print `none` if none. Nothing else."
3. Add its lines to the findings.

## Filter

1. Drop as `style/doc/consider`: style, formatting, naming, comments, docs, refactors, and "consider"/"could"/"might" items that name no wrong behaviour.
2. Drop as `missing-test`: claims that only say a test is missing.
3. Set aside as `by-design`: a claim whose "wrong behaviour" is what the spec or plan asks for; it gets one `BY-DESIGN <file:line> — <claim>` line (see Output).
4. Merge duplicates (same place, same claim). Keep only claims of wrong behaviour: wrong result, crash, data loss, leak, race, security hole.
5. Count each merged duplicate, and anything dropped that fits no bucket (e.g. a pure performance claim), as `style/doc/consider`.

## Prove

1. One fresh Agent per kept finding: `subagent_type: general-purpose`, `model: sonnet` (`haiku` when the claim names one function and one input). Never the session or subagent that wrote the code.
2. Dispatch them one at a time: they share the working tree and the build.
3. Pick the `<kind>` whose tests cover the finding's file: `<command>` = its `command` as written, `<dir>` = project root + its `cwd`. No `tests` configured: `<kind>` = `-`, `<command>` = "the project's test tool, filtered to this one test, never the whole suite".
4. Prompt (fill every `<...>` you know; the prover sees only its own finding):

```
Prove or disprove one review finding. Change no production code.
Claim: <claim>
Where: <file:line>
1. Find the existing tests for this code. Beside them, in their style, add the smallest test that fails if the claim is true. Mock only at system boundaries, never the code the claim is about.
2. Run only that test: <command> in <dir>, with {filter} replaced by a filter that matches only your test.
3. Reply with exactly one of:
   PROVEN — test <kind> <the exact text you put in place of {filter}> in <test file> — <the failing assertion line, with expected and actual>
   DISPROVEN — <one line why> (delete your test first)
   UNTESTABLE — <numbered exact manual repro steps> (delete your test first)
4. After PROVEN, one last line: pattern <one-line JavaScript regex matching a source line with this bug's shape>
```

## Judge

1. Read each PROVEN test. It counts only when it fails for the claimed reason: the failing assertion checks the wrong behaviour the claim names.
2. Not proof: a compile or build error, a setup or fixture error, a timeout, an assertion about something else, a mock of the code under the claim. Delete the rejected test, then dispatch a fresh prover once more with the reason added (its test replaces it); still not proof → disproven, delete that test too.
3. Check that DISPROVEN and UNTESTABLE provers left no test behind.
4. Keep at most 3 UNTESTABLE findings, the most severe, for the UNVERIFIED lines; count the rest as `untestable`.
5. Leave every proven test in place, failing and uncommitted: it becomes the regression test for the fix. Do not fix the code here.

## Output

Only these lines: every PROVEN line (most severe first, never dropped), then UNVERIFIED lines only while the whole output, `discarded:` line included, stays at most 10 lines, then BY-DESIGN lines under the same cap, then the `discarded:` line. Each UNVERIFIED left out counts as `untestable`. Every by-design claim counts in the `by-design` number of `discarded:`, printed or not; BY-DESIGN lines are printed only while the output stays within the cap.

```
PROVEN <file:line> — <claim> — test <kind> <filter> — pattern <regex>
UNVERIFIED <file:line> — <claim> — repro: <steps>
BY-DESIGN <file:line> — <claim>
discarded: <n> (<n> style/doc/consider, <n> missing-test, <n> by-design, <n> disproven, <n> untestable)
```

`<kind>` is the `tests` key used and `<filter>` exactly what replaced `{filter}`, so `mutate-check.mjs --kind <kind> --test <filter>` reuses them verbatim; `<regex>` is the prover's pattern; repro steps stay on one line. Always print the `discarded:` line, even when every count is 0.

## Lessons

- One review pass is a sample, not a sweep: an empty result does not mean the code is clean.
- Fixes create bugs: keep fix rounds small and re-review the fix diff.
- Environment bugs (build, config, real services) are found by mechanical checks, not reviewers.
- Skeptic agents buy precision, not recall: proving removes noise, it finds nothing new.
- Prove with the smallest revert (`<scripts>/mutate-check.mjs`), not a whole-commit revert: compile errors give false reds.
