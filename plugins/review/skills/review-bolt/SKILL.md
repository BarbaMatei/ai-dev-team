---
name: review-bolt
description: Use when a bolt's (or any branch's) code is complete and its tests pass, before opening the pull request. Simplifies the change, runs at most two code-review rounds in which only findings proven by a failing test count, fixes the proven bugs, checks each regression test with mutate-check and writes the one-page PR body the owner reads. Args - [--base <ref>] [--no-pr].
---

# Review bolt

You review one finished branch (a bolt = one unit of work on its own branch, reviewed as one PR) and write the owner's PR body. At most two review rounds; what round 2 leaves goes under "Needs owner" with the default you would take. You orchestrate: fresh subagents write tests and fixes.

**Skills and subagents you call return intermediate results: after each one, continue with the next step. Your reply ends only at the last step.**

- **Args:** `<base>` = `--base <ref>`, else `git merge-base HEAD origin/HEAD`, else `main`. `--no-pr`: write the PR body file only; push nothing, create no PR, file no issues (list them in the body instead).
- **Default branch:** `git symbolic-ref --short refs/remotes/origin/HEAD` without the `origin/` prefix; if that fails, `main`.
- **Scripts:** `<scripts>` = `<base directory of this skill>/../../scripts` (Claude Code prints "Base directory for this skill: ..." when this skill loads). Run them from the project root.
- **Temp files:** `<tmp>` = the session's scratchpad directory if Claude Code lists one, else the OS temp folder (`node -e "console.log(require('os').tmpdir())"`); never inside `.git` or the working tree. PR body file = `<tmp>/review-bolt-pr-<branch with / replaced by ->.md`.
- **Config:** `<project>/.claude/ai-dev-team.json`: `tests` (each `<kind>` has a `command` with `{filter}` and an optional `cwd`), `bugs.label` (default `bug`).
- **Built-ins:** invoke `simplify` and `code-review` with the Skill tool by those plain names: the built-in `code-review`, never a plugin's `code-review:code-review`. `security-review` runs only inside a subagent (step 7): it takes over the context it runs in.
- **Keep for the PR body:** the round count; every PROVEN, UNVERIFIED, BY-DESIGN and `discarded:` line (sum the counts over rounds); every `UPDATED-TEST` line; per fix its `file:line`, "now" and pre-fix text, `<kind>`, `<filter>`, mutate-check verdict; every "Needs owner" item.

## Start

1. On the default branch → stop: review-bolt reviews a bolt branch.
2. `git status --porcelain` not empty → list the files and ask whether to commit them; round 2 needs a clean tree.
3. `node "<scripts>/areas.mjs" touched --base <base>` → the touched areas and the `trigger:` line.

## Simplify

4. Invoke `simplify` with args `the changes in <base>...HEAD`.
5. It changed code → run the tests covering the changed files, scoped (never the whole suite). Pass → commit with a one-line conventional message; fail → `git restore .` and go on.

## Round 1

6. Invoke `code-review` with args `high <base>...HEAD`. If it reports it cannot use that target, invoke it again with args `high <current branch name>`.
7. `trigger: yes` → dispatch one fresh Agent (`subagent_type: general-purpose`, `model: sonnet`): "Invoke the `security-review` skill with the Skill tool, limited to the changes in `git diff <base>...HEAD`, not the whole branch. Fix nothing. Reply with its findings only, one per line: `<file:line> — <claim>`, or `none`." Add its lines to round 1's findings.
8. Invoke `review:prove-findings` with args `base <base>`. Rounds = 1.

## Fix

9. For each PROVEN line, one at a time (fixers share the tree), dispatch a fresh Agent (`subagent_type: general-purpose`, `model: sonnet`). `<command>`/`<dir>` = the `tests.<kind>` entry, as in `prove-findings`:

```
Fix one proven bug. Its failing test becomes the regression test.
Bug: <claim> at <file:line>
Test: run only it: <command> in <dir>, with {filter} replaced by <filter>. It fails now.
1. Make that test pass with the smallest change to production code. Fix it where the behaviour is owned; never put one feature's text or rule into shared code to make the test pass. Change nothing else: not the test, no refactors, no comments, no other behaviour. Exception: an existing test that asserts exactly the behaviour your fix removes may change, only that assertion.
2. Run only that test; it must pass. Do not commit.
3. Reply with one FIXED or STUCK line; when you changed an existing assertion, also one UPDATED-TEST line:
   FIXED <file:line of the line that fixes it> — now: <that line's text> — pre-fix: <its exact text before your change; empty if you added the line>
   STUCK — <one line why> (undo every change you made first)
   UPDATED-TEST <file:line> — <why>
```

10. STUCK → copy the proving test into "Needs owner" as a code block with the default you would take, then remove that test from the tree.

## Same bug nearby

11. Per round-1 PROVEN line: `node "<scripts>/areas.mjs" nearby --pattern "<regex>" --max 10 --base <base>`. Skip the lines already fixed. Exit 3, or a pattern that does not match the pre-fix text → build a narrower regex from the pre-fix text and the claim, run it the same way, and say so in the PR body.
12. `in bolt area` lines → one fresh fixer (same Agent settings) per pattern: "Same bug shape as <claim>, fixed at <file:line>. Check these sites: <lines>. Where the bug exists, first add a failing test beside the existing tests (run it with <command> in <dir>), then the smallest fix; do not commit. Reply one line per site: `FIXED <file:line> — now: <text> — pre-fix: <text> — test <kind> <filter>` or `NOT A BUG <file:line> — <why>`."
13. `elsewhere` lines → "Same bug elsewhere". Unless `--no-pr`, per pattern: `gh issue list --search "<basename> in:body" --state open` per file; an open issue on the same bug → link it instead; file the rest as one issue: body (sites, claim, pattern, this branch) written to `<tmp>/review-bolt-issue-<branch with / replaced by ->.md`, then `gh issue create --title "<claim>" --label <bugs.label> --body-file <that path>`. `gh` missing or failing (for example the label does not exist) → mark those sites "to file" in the body, as with `--no-pr`.

## Round 2 — only if steps 9-12 changed code

14. Invoke `code-review` with args `medium` and no target while the fixes are uncommitted, so the current diff is the fix lines. Rounds = 2.
15. Invoke `review:prove-findings` with args `base <base>, uncommitted changes only`; fix each PROVEN line with steps 9-10.
16. No round 3 and no re-review: anything still open goes under "Needs owner".

## Commit and check

17. Run every regression test, scoped, plus the scoped tests covering every file the fixes changed (same scoping as step 5). One fails → back to that fixer once (steps 9-10); still failing → "Needs owner". Then commit with a one-line conventional message.
18. Per fix: `<kind>` is `-` → record `not mutate-checkable`. Else confirm the "now" text is still at `<file:line>` (re-find it if lines moved), then `node "<scripts>/mutate-check.mjs" --file <file> --line <n> --replace "<pre-fix text>" --kind <kind> --test "<filter>"`, quoted so the shell passes both texts unchanged; empty pre-fix → omit `--replace`.
19. `NOT GUARDED` → once per fix, one fresh sonnet Agent: "This test still passes when line <n> of <file> becomes <pre-fix>. Strengthen only the test so it fails then and passes now; run it; do not commit." Commit, re-run mutate-check once; still not `GUARDED` → "Needs owner". `INVALID: build broke` → retry once with a `--replace` that compiles. Record each final verdict.
20. Per PROVEN finding: `node "<scripts>/decisions.mjs" --path <file> --text "<claim>"`; `decision:` lines → "Past decisions".

## PR body

21. Read `<base directory of this skill>/pr-body.md`, replace every `<...>` as its placeholders say, and write it to the PR body file (see Temp files; never committed). Each UNVERIFIED line goes under "Needs owner" with its repro.
22. Unless `--no-pr`: `git push -u origin HEAD`; `gh pr view` finds a PR → `gh pr edit --body-file <PR body file>`, else `gh pr create --base <base if it is a branch name; if it is a commit SHA, the default branch> --title "<one-line conventional subject>" --body-file <PR body file>`. Never merge; never push the default branch.

## Reply

At most 10 lines: the PR link (if any) and the PR body file's full path, the `Rounds:` line, fixes with their mutate-check verdicts, issues filed, and the "Needs owner" count with its first item.
