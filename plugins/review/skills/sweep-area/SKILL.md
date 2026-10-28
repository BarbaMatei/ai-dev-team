---
name: sweep-area
description: Use only when the owner explicitly asks to sweep (bug-hunt) one area of the default branch, for example "sweep the checkout area". Announces the token cost and waits for a go, reviews the area's files in batches, keeps only findings a failing test proves and files each one as an issue. Never start it on your own. Arg - <area>.
---

# Sweep area

You hunt bugs in one area of the default branch and file what survives proving as issues. You commit nothing: proving tests go into the issues, never into the default branch.

- **Arg:** `<area>`, an area name (a rule file's basename or a key of the config's `areas`).
- **Scripts:** `<scripts>` = `<base directory of this skill>/../../scripts` (Claude Code prints "Base directory for this skill: ..." when this skill loads). Run them from the project root.
- **Config:** `<project>/.claude/ai-dev-team.json`: `tests` (used by `prove-findings`), `rulesDir` (default `.claude/rules`), `bugs.label` (default `bug`).
- **Built-in:** invoke `code-review` with the Skill tool by that plain name: the built-in `code-review`, never a plugin's `code-review:code-review`.

## Scope and cost

1. Need the default branch at its latest commit with a clean tree (`git status --porcelain` empty). Otherwise stop and ask for such a checkout (a throwaway `git worktree add` of the default branch works).
2. `node "<scripts>/areas.mjs" files <area>`. Exit 2 → show the area names it lists and stop.
3. Count those files and their lines.
4. Announce in one line: "<area>: <f> files, <l> lines. Estimate ≈ <l × 15 / 1000>k tokens to review, plus ≈ 50k per finding proven. Go?"
5. Wait for an explicit yes. Anything else, or no answer (a headless run), ends the sweep here.

## Sweep, per batch of at most 20 files

6. Invoke `code-review` with args `high <the batch's paths, space-separated>`.
7. `<rulesDir>/<area>.md` exists → one Agent (`subagent_type: general-purpose`, `model: haiku`): "Read <rule file>, then these files: <batch paths>. For each line that breaks the rule print `<file:line> — <what breaks> (rule: <rule file>)`. Print `none` if none. Nothing else." Add its lines to the findings: with no diff, `prove-findings` has no rule files to check.
8. Invoke `review:prove-findings` with args `base HEAD; area sweep of the default branch, no diff`.
9. For each PROVEN and UNVERIFIED line:
   1. `gh issue list --search "<basename> in:body" --state open`. An open issue about the same bug → note its number and skip.
   2. Write the issue body to the path `git rev-parse --git-path sweep-issue.md` prints: `file:line`, the claim, the repro (PROVEN: the test command with its filter; UNVERIFIED: its steps), the proving test as a fenced code block (PROVEN only), the pattern, and the swept commit (`git rev-parse --short HEAD`).
   3. `gh issue create --title "<claim, under 70 characters>" --label <bugs.label> --body-file <that path>`.
10. `gh` missing or failing → append each would-be issue body to the path `git rev-parse --git-path sweep-<area>-issues.md` prints and name that file in the reply.
11. Remove every proving test: restore the files the provers edited and delete the files they added, until `git status --porcelain` is empty again.

## Reply

At most 10 lines: the area, files and lines reviewed, issues filed (number and title), duplicates skipped (numbers), the summed `discarded:` line, and whether `git status --porcelain` is empty.
