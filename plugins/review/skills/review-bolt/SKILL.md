---
name: review-bolt
description: Use when a bolt's (or any branch's) code is complete and its tests pass, before opening the pull request. Simplifies the change, runs at most two code-review rounds in which only findings proven by a failing test count, fixes the proven bugs, checks each regression test with mutate-check and writes the one-page PR body the owner reads. Args - [--base <ref>] [--no-pr] [--ask] [--no-review].
---

# Review bolt

You review one finished branch (a bolt = one unit of work on its own branch, reviewed as one PR) and write the owner's PR body. At most two review rounds; what round 2 leaves goes under "Needs owner" with the default you would take. You orchestrate: fresh subagents write tests and fixes.

**Skills and subagents you call return intermediate results: after each one, continue with the next step. Your reply ends only at the last step.**

- **Args:** `<base>` = `--base <ref>`, else `git merge-base HEAD origin/HEAD`, else `main`. `--no-pr`: write the PR body file only; push nothing, create no PR, file no issues (list them in the body instead). `--ask`: every fix of a proven bug waits for the owner's word (see Ask); simplify still commits on its own. `--no-review` (the owner chose the tidy-up only): steps 1-5, then 21-22; the PR body's Review section is `Rounds: 0 (owner chose the tidy-up only).` with no table.
- **Default branch:** `git symbolic-ref --short refs/remotes/origin/HEAD` without the `origin/` prefix; if that fails, `main`.
- **Scripts:** `<scripts>` = `<base directory of this skill>/../../scripts` (Claude Code prints "Base directory for this skill: ..." when this skill loads). Run them from the project root.
- **Prompts:** every subagent prompt is in `prompts.md` beside this file under its step number; fill every `<...>`. Helpers never run `git checkout`, `git restore`, `git stash` or `git clean` (proving tests are uncommitted in the tree): they undo their own edits by editing the files.
- **Temp files:** `<tmp>` = the session's scratchpad directory if Claude Code lists one, else the OS temp folder (`node -e "console.log(require('os').tmpdir())"`); never inside `.git` or the working tree. PR body file = `<tmp>/review-bolt-pr-<branch with / replaced by ->.md`.
- **Config:** `<project>/.claude/ai-dev-team.json`: `tests` (each `<kind>` has a `command` with `{filter}`, an optional `cwd`, `env` pairs and `nameArg`; `.claude/ai-dev-team.local.json` overrides them on this machine), `bugs.label` (default `bug`). `<env>` = the kind's env pairs as `NAME=value`, or `none`; every prompt that runs a test carries them.
- **Built-ins:** `simplify`, `code-review` and `security-review` each run inside one fresh subagent (steps 4, 6, 7 and 14; `subagent_type: general-purpose`, `model: sonnet`): they load the whole diff into the context they run in. They invoke the built-in `code-review`, never a plugin's `code-review:code-review`.
- **Record file:** `<tmp>/review-bolt-record-<branch with / replaced by ->.md`. Append as each arrives: every prove-findings output verbatim, every fixer reply line, every `UPDATED-TEST` line, each mutate-check verdict, each owner word (with `--ask`), the round-2 "outside the fix lines" count and every "Needs owner" item; owner decisions made during the session, one line each. After a context summary, read it before the next step; step 21 writes the PR body from it.
- **By-design:** every prove-findings call (steps 8 and 15) passes `By-design:` with the record file's owner-decision lines, one per line; none → leave it out.

## Start

1. On the default branch → stop: review-bolt reviews a bolt branch.
2. `git status --porcelain` not empty → list the files and ask whether to commit them; round 2 needs a clean tree.
3. `node "<scripts>/areas.mjs" touched --base <base>` → the touched areas and the `trigger:` line.

## Simplify

4. Dispatch the step-4 subagent: it simplifies, runs the scoped tests and commits or reverts. Record its reply.
5. A `reverted` reply goes under Risks with its failing test.

## Round 1

6. Dispatch the step-6 subagent; its lines are round 1's findings.
7. `trigger: yes` → dispatch the step-7 subagent; add its lines to round 1's findings.
8. Invoke `review:prove-findings` with args `base <base>` (and the By-design lines). Rounds = 1.

## Fix

9. For each PROVEN line, one at a time (fixers share the tree), dispatch the step-9 fixer. `<command>`/`<dir>`/`<env>` come from `tests.<kind>`, as in `prove-findings`.
10. STUCK → copy the proving test into "Needs owner" as a code block with the default you would take, then remove that test from its file by editing it.

## Ask — only with `--ask`

A. Before step 9, `<fixbase>` = `git rev-parse HEAD`. Before each fixer (steps 9, 12 and 15; one step-12 fixer's sites count as one bug), `<snap>` = what `git stash create` prints, or `HEAD` when it prints nothing (a snapshot that changes nothing). After its FIXED reply: save `git diff <snap> -- <the files it changed>` to `<tmp>/review-bolt-fix-<n>.patch` (only its edits, existing tests included), then `git apply -R <that patch>`; every proving test stays in the tree. Then `git update-index -q --refresh` and `git diff --quiet <snap> -- <those files>`: not quiet → stop and show the files (the tree did not return to the snapshot).
B. Present it as `fix-findings` presents a bug only a test shows (`<base directory of this skill>/../fix-findings/presentation.md`, "One message"; the owner's own repro step is skipped on purpose: the test is the evidence): one bug per message, its old and new code from the patch, verbatim and every file (the patch exists, so no choice-first), an UPDATED-TEST change shown as its own old and new assertion with why, ending "Approve?". Wait for the word; approval of one bug never approves the next.
C. Yes → `git apply <patch>`; it fails → `git apply --ignore-whitespace <patch>`; still failing → rewrite the patch's target files with LF line endings and apply once more. `git diff --stat` must list exactly the patch's files. Run the proving test (it must pass), then `git apply --cached <patch>` (same fallbacks) and commit that fix alone; the proving tests are committed at step 17. `--cached` fails (the patch touches uncommitted test lines) → the fix waits for step 17's commit; say so in the PR body. No → the proving test goes under "Needs owner" as a code block with the owner's words, then is removed from its file by editing. Superseded (the owner asks for a different change that makes the finding moot) → show that change like a fix, ending "Approve?"; after the yes commit it alone, keep the proving test when it now passes (mutate-check the key line of that change), else remove it by editing; record `superseded by <short sha> — <the owner's words>`. File it (the owner wants the finding tracked, not fixed now) → create one issue with the label from `bugs.label` (with `--no-pr`: no issue, mark it "to file"): title = the claim; body = the claim, `file:line`, the proving test as a code block and its failing assertion; then remove the proving test from its file by editing; record `filed as #<n> — <the owner's words>`. The issue is created only on this answer.

## Same bug nearby

11. Per round-1 PROVEN line: `node "<scripts>/areas.mjs" nearby --pattern "<regex>" --max 10 --base <base>`. Skip the lines already fixed. Exit 3, or a pattern that does not match the pre-fix text → build a narrower regex from the pre-fix text and the claim, run it the same way, and say so in the PR body. A fix with an empty pre-fix text or `pattern none` (it only added lines): search the sibling call sites instead, `areas.mjs nearby --pattern "<name of the method or handler the fix extended>\(" --max 10 --base <base>`, and send the `in bolt area` sites to step 12 as "same missing <what the fix added>"; no sibling → record `added-line fix: no nearby search`.
12. `in bolt area` lines → one step-12 fixer per pattern.
13. `elsewhere` lines → "Same bug elsewhere". Unless `--no-pr` (with `--ask`, only after the owner's yes to one plain message per pattern ending "File it as an issue?"; no → the sites stay in the body as not filed), per pattern: `gh issue list --search "<basename> in:body" --state open` per file; an open issue on the same bug → link it instead; file the rest as one issue: body (sites, claim, pattern, this branch) written to `<tmp>/review-bolt-issue-<branch with / replaced by ->.md`, then `gh issue create --title "<claim>" --label <bugs.label> --body-file <that path>`. `gh` missing or failing (for example the label does not exist) → mark those sites "to file" in the body, as with `--no-pr`.

## Round 2 — only if steps 9-12 changed code

14. Write the fix lines to `<tmp>/review-bolt-fixes-<branch with / replaced by ->.diff`: `git diff HEAD -U0` (with `--ask`: `git diff <fixbase> -U0`). Dispatch the step-14 subagent with args `medium` and no target while the fixes are uncommitted (with `--ask`: `medium <fixbase>...HEAD`; if it cannot use that target, `medium <current branch name>`). Keep only findings whose `file:line` lies inside a hunk of that file, or in a file the fixes added, and that do not repeat a round-1 finding (same file, same claim); drop the rest and count them for the PR body as "outside the fix lines". Rounds = 2.
15. Invoke `review:prove-findings` on the kept findings with args `base <base>, uncommitted changes only` (with `--ask`: `base <fixbase>`) and the By-design lines; fix each PROVEN line with steps 9-10 (and Ask).
16. No round 3 and no re-review: anything still open goes under "Needs owner".

## Commit and check

17. Run every regression test, scoped, plus the scoped tests covering every file the fixes changed (same scoping as step 5). One fails → back to that fixer once (steps 9-10); still failing → "Needs owner". Then commit what is uncommitted with a one-line conventional message (with `--ask` the approved fixes are already committed).
18. Per fix: `<kind>` is `-` → record `not mutate-checkable`. Else confirm the "now" text is still at `<file:line>` (re-find it if lines moved), write the pre-fix text to `<tmp>/pre-fix-<n>.txt` with the Write tool, then `node "<scripts>/mutate-check.mjs" --file <file> --line <n> --replace-file <tmp>/pre-fix-<n>.txt --kind <kind> --test "<filter>"`, plus `--test-name "<test name>"` when the kind has `nameArg`; empty pre-fix → no `--replace-file`. The verdict is the last line of its output.
19. `NOT GUARDED` → once per fix, the step-19 subagent; commit, re-run mutate-check once; still not `GUARDED` → "Needs owner". `INVALID: build broke` → retry once with a pre-fix file that compiles. `INVALID: no test ran` → fix `--test`/`--test-name` from the PROVEN line and retry once. Record each final verdict.
20. Per PROVEN finding: `node "<scripts>/decisions.mjs" --path <file> --text "<claim>"`; `decision:` lines → "Past decisions".

## PR body

21. Read the record file and `<base directory of this skill>/pr-body.md`, replace every `<...>` as its placeholders say, and write it to the PR body file (see Temp files; never committed). Each UNVERIFIED line goes under "Needs owner" with its repro.
22. Unless `--no-pr`: `git push -u origin HEAD`; `gh pr view` finds a PR → `gh pr edit --body-file <PR body file>`, else `gh pr create --base <base if it is a branch name; if it is a commit SHA, the default branch> --title "<one-line conventional subject>" --body-file <PR body file>`. Never merge; never push the default branch. Then `gh pr view --json closingIssuesReferences --jq '[.closingIssuesReferences[].number]'` must equal the issues the body means to close; they differ → fix the `Closes` lines (pr-body.md rule) and edit once more; still different → say so in the reply.

## Reply

At most 10 lines: the PR link (if any) and the PR body file's full path, the `Rounds:` line, fixes with their mutate-check verdicts, issues filed, and the "Needs owner" count with its first item.
