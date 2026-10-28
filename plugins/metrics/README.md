# metrics

One CSV row per merged PR (one PR = one bolt): how long it took, how the review went and how many tokens the work used. Plain Node (>= 22), no dependencies; needs the `gh` CLI for PR data.

## The CSV

Default `metrics/bolts.csv` (`metrics.file`). Columns:

- `pr`, `branch` (the PR's head branch), `merged_at`.
- `bolt_start`: when the PR's oldest commit was authored; `hours_to_merge`: merge time minus that, one decimal.
- `review_rounds`, `findings_proven`, `findings_discarded`, `findings_unverified`: from the PR body line `Rounds: <r> · proven: <p> · discarded: <d> · unverified: <u>` (the review plugin's PR body). No such line: empty.
- `tokens_total` = `tokens_input` (input + cache creation) + `tokens_cache_read` + `tokens_output`.
- `sessions`, `subagents`: Claude Code session files and subagent files that contributed tokens.

## Token rule and limits

Reads every `*.jsonl` under `<logs>/` (`--logs`, else `$CLAUDE_CONFIG_DIR/projects`, else `~/.claude/projects`), all project folders, subagent logs included. Counts assistant lines whose `gitBranch` is the PR branch and whose timestamp is at or before the merge, once per `message.id`.

- Only sessions whose checkout was on the PR's branch count: work in a side worktree on another branch does not.
- A branch name reused elsewhere before the merge would be counted.

## CLI

```
node scripts/pr-metrics.mjs --pr <n> | --sync | --hook [--dry-run] [--logs <dir>] [--gh <command>]
```

- `--pr <n>`: record that merged PR (exit 1 if it is not merged). A PR already in the file prints `PR #<n>: already recorded` and changes nothing.
- `--sync`: record the merged PRs newer than the newest row (or `number >= metrics.since`), oldest first. No file and no `metrics.since`: exit 2.
- `--dry-run`: print the header and rows, write nothing.
- `--gh`: the command used for `gh` (run through the shell).
- `--hook`: `--sync` that never blocks (below).

Config in `<project>/.claude/ai-dev-team.json`: `metrics.file` (default `metrics/bolts.csv`), `metrics.since` (first PR number to record when the file is new).

## Pre-commit hook

Every commit on a PR branch carries the new rows. Put this in `.githooks/pre-commit` before the guardrails lines:

```sh
m=$(ls -d "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/ai-dev-team/metrics/*/ 2>/dev/null | sort -V | tail -n 1)
[ -n "$m" ] && node "${m}scripts/pr-metrics.mjs" --hook
```

`--hook` always exits 0 and prints at most one line on stderr. It does nothing on the default branch, in detached HEAD, when `--sync` would exit 2, or when `gh` fails or takes over 15 s. After adding rows it runs `git add` on the CSV so the commit carries them.

Two open branches can both record the same merged PR; the second one sees `already recorded` after it rebases.

## record-pr skill

For a hand-recorded PR or to start the CSV (it asks which PR to start from); the hook records the rest.

## Install

```
/plugin marketplace add BarbaMatei/ai-dev-team
/plugin install metrics@ai-dev-team
```
