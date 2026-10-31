---
name: app
description: Use when the app must be running for browser work, or must be stopped again. Starts the project's app parts in order, reports their state or stops what it started. Args - up|down|status.
---

# App

You start, check or stop the project's app and hand back what the script printed. You change no project files.

- **Arg:** `up`, `down` or `status`.
- **Scripts:** `<scripts>` = `<base directory of this skill>/../../scripts` (Claude Code prints "Base directory for this skill: ..." when this skill loads). Run them from the project root.
- **Config:** `browser` in `<project>/.claude/ai-dev-team.json`: `baseUrl`, `boot`, `timeoutSec`. When something is missing the script says what to set; show that line and stop.

## Steps

1. Run `node "<scripts>/app.mjs" <arg>` with the Bash tool timeout set to 600000 ms.
2. If it is cut off anyway, run `node "<scripts>/app.mjs" down` and report that.

## Reply

The script's stdout lines as they are (`ready <name> <address>` means it started that part, `reuse <name>` that it already ran). When it fails: its stderr and the exit code. Nothing else.
