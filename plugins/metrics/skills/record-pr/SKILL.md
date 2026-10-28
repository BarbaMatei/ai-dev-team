---
name: record-pr
description: Use when the owner asks to record a merged PR's metrics by hand, or to start the metrics CSV; the pre-commit hook records the rest.
---

# Record PR metrics

Adds one row per merged PR to the metrics CSV (`metrics.file`, default `metrics/bolts.csv`).

- **Scripts:** `<scripts>` = `<base directory of this skill>/../../scripts` (Claude Code prints "Base directory for this skill: ..." when this skill loads). Run from the project root.
- **Never commit on the default branch** (`git symbolic-ref --short refs/remotes/origin/HEAD` without `origin/`, else `main`). Leave the CSV change uncommitted there and say so.

## Steps

1. One PR: `node "<scripts>/pr-metrics.mjs" --pr <n>`. All merged PRs not yet in the file: `node "<scripts>/pr-metrics.mjs" --sync`. Add `--dry-run` to preview without writing.
2. Exit 2 with `set metrics.since ...`: the CSV does not exist yet. Ask the owner which merged PR to start from, suggest adding `"metrics": { "since": <n> }` to `.claude/ai-dev-team.json`, then run `--sync` again (or `--pr <n>` for just one).
3. Exit 1 `PR #<n> is not merged`: tell the owner; record nothing.
4. `PR #<n>: already recorded` is fine: the file is unchanged.

## Reply

At most 3 lines: the `PR #<n>: ...` summary lines, and the file to commit on a feature branch.
