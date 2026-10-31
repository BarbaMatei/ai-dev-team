---
name: preview
description: Use when you want to see which packages the next merge to the main branch would release and at which version. Prints the release plan and writes nothing.
---

# Preview

You show the release plan and change nothing.

- **Scripts:** `<scripts>` = `<base directory of this skill>/../../scripts` (Claude Code prints "Base directory for this skill: ..." when this skill loads). Run from the project root.
- **Config:** `release` in `<project>/.claude/ai-dev-team.json`: `packages`, `versionFile`, `changelog`, `tag`, `patch`, `initial`.

## Steps

1. Run `node "<scripts>/release.mjs"` from the project root. Never pass `--write`.
2. Exit 2: show its message and stop (bad config or a tag collision).
3. Reply with its lines as printed, then one line: the release itself happens in CI after a merge to the main branch.
