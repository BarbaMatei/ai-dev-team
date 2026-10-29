---
name: check-tests
description: Use in the specsmd Test stage, or whenever a branch's code and tests are done, before review. Flags decorative new tests (tests that stay green when the code is wrong) and maps each acceptance criterion to a test that checks it. Args - [--base <ref>] [--spec <file>...].
---

# Check tests

You check one branch's new tests: can each one catch a bug, and does every acceptance criterion have a test? Subagents read the tests; you run the scripts and assemble the reply. Never edit, add or delete a test yourself.

**Subagents you dispatch return intermediate results: after each one, continue with the next step. Your reply ends only at the last step.**

- **Args:** `--base <ref>`: the branch the work started from. `--spec <file>...`: story files or specsmd `bolt.md` files holding the acceptance criteria (a `bolt.md` expands to its stories).
- **Base:** `<base>` = `git merge-base HEAD <ref>` for `--base <ref>` (fails → reply `unknown base <ref>` and stop), else `git merge-base HEAD origin/HEAD`, else `git merge-base HEAD main`.
- **Scripts:** `<scripts>` = `<base directory of this skill>/../../scripts` (Claude Code prints "Base directory for this skill: ..." when this skill loads). Run them from the project root.
- **Temp files:** `<tmp>` = the session's scratchpad directory if Claude Code lists one, else the OS temp folder (`node -e "console.log(require('os').tmpdir())"`); never inside `.git` or the working tree. `<branch>` = `git branch --show-current` with `/` replaced by `-` (`HEAD` if empty).
- **Config:** `<project>/.claude/ai-dev-team.json`, optional `testQuality.testFiles` (globs of test files; the scripts read it).

## Steps

1. Run `node "<scripts>/tests.mjs" list --base <base>`; keep its output as `<list>`. Exit 2 → reply its stderr line and stop.
2. Spec files = the `--spec` files; else the `bolt.md` files changed on the branch: the paths printed by `git diff --name-only --diff-filter=d <base>` and `git ls-files --others --exclude-standard` that end in `bolts/<one folder>/bolt.md`. None → no spec.
3. `<list>` is `no new or changed tests` and there is no spec → reply exactly `no new or changed tests` and stop.

### Decorative tests

4. `<list>` is `no new or changed tests` → the critic lines are just `no new or changed tests`; go to step 7.
5. Run `node "<scripts>/tests.mjs" show --base <base> > "<show>"`, where `<show>` = `<tmp>/new-tests-<branch>.txt`. Do not read that file yourself.
6. Dispatch one Agent (`subagent_type: test-quality:test-critic`) with the prompt "Check the new tests in <show>." Critic lines = its `DECORATIVE`, `UNSURE` and `checked:` lines.

### Coverage

7. No spec → the coverage line is `coverage skipped: no spec found`; go to Reply.
8. Run `node "<scripts>/criteria.mjs" <spec files, each quoted>`; keep its output as `<criteria>`. Exit 2 → coverage line `coverage skipped: <its stderr line>`; last line `0 criteria ...` → `coverage skipped: no acceptance criteria in the spec`; either way go to Reply.
9. Dispatch one Agent (`subagent_type: general-purpose`, `model: haiku`) with this prompt:

```
Map acceptance criteria to the tests that check them. Change no file.
Criteria, one per line as <criterion file:line><TAB><criterion>:
<criteria without its last line>
New or changed tests, one per line as <file:line><TAB><name>:
<list without its last line, or "none">
Their code: <show, or "none"> (read it with the Read tool)
For each criterion, in order:
1. Find the new tests that check it. A test checks a criterion when it sets up the
   criterion's situation and asserts its outcome (the "Then" part), not when it only
   shares words with it.
2. None → Grep the project's existing test files for one that checks it and cite it.
3. Still none → NONE.
   Exception: a criterion about code structure that a compile error would catch (where a
   name lives, that a type exists) → STRUCTURAL; never for behaviour.
Reply with exactly one line per criterion, nothing else:
COVERED <criterion file:line> — <test file:line> <test name>
NONE <criterion file:line> — <criterion>
STRUCTURAL <criterion file:line> — <what in the build enforces it>
```

10. `<total>` = the criteria lines, `<covered>` = its `COVERED` lines, `<s>` = its `STRUCTURAL` lines. Coverage lines = `coverage: <covered+s>/<total> (<s> enforced by the compiler)`, then its `NONE` and `STRUCTURAL` lines.

## Reply

The critic lines, then the coverage lines, then the next step. At most 12 lines:

```
DECORATIVE <file:line> <name> — <why> — fix: <what to assert instead>
UNSURE <file:line> <name> — <why>
checked: <n> · decorative: <k>
coverage: <covered+structural>/<total> (<s> enforced by the compiler)
NONE <criterion file:line> — <criterion>
STRUCTURAL <criterion file:line> — <what in the build enforces it>
Next: fix each DECORATIVE test to assert behaviour, add a test per NONE criterion, then run check-tests again.
```

- `no new or changed tests` stands in for the critic lines when there were none; `coverage skipped: <reason>` for the coverage lines when there was no spec or no criteria.
- Leave out the `Next:` line when there is no DECORATIVE and no NONE line; STRUCTURAL lines never trigger it.
- More than 12 lines → write them all to `<tmp>/check-tests-<branch>.txt` and reply the `checked:` and `coverage` lines, the first DECORATIVE and NONE lines that fit, `full list: <that file's full path>` and the `Next:` line.
