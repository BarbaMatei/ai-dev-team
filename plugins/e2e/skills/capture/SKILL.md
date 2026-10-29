---
name: capture
description: Use when you need screenshots of the running app's pages, for example before judging how a screen looks. Boots the app if it is not running, takes one PNG per route and viewport with a headless Chromium browser, and returns the folder and file names. Args - <route>... [--viewports 390x844,1280x800] [--wait <ms>] [--keep].
---

# Capture

You take screenshots of the app's pages and hand back where they are. You change no project files.

- **Args:** `<route>...` (for example `/` or `/prices`, or a full `http(s)://` address), optional `--viewports <w>x<h>,...` (default `390x844,1280x800`), `--wait <ms>` (how long a page may load, default 5000) and `--keep`.
- **Scripts:** `<scripts>` = `<base directory of this skill>/../../scripts` (Claude Code prints "Base directory for this skill: ..." when this skill loads). Run them from the project root.
- **Temp files:** `<tmp>` = the session's scratchpad directory if Claude Code lists one, else the OS temp folder (`node -e "console.log(require('os').tmpdir())"`); never inside `.git` or the working tree.
- **Config:** `e2e` in `<project>/.claude/ai-dev-team.json`: `baseUrl`, `boot`, `timeoutSec`, `browser`. When something is missing the script says what to set; show that line and stop.

## Steps

Run `app.mjs up`, `shots.mjs` and `e2e.command` with the Bash tool timeout set to 600000 ms. If one is cut off anyway, run `app.mjs down` and stop.

1. `node "<scripts>/app.mjs" up`. Exit 1 or 2: show its stderr and stop. Note whether any output line starts with `ready` (it started something); `reuse` lines mean it did not.
2. `node "<scripts>/shots.mjs" "<tmp>/shots-<yyyymmdd-hhmm>" <routes> [--viewports <list>] [--wait <ms>]`. Use the current local date and time in the folder name. Exit 1 or 2: show its stderr, do step 3, then stop.
3. Run `node "<scripts>/app.mjs" down` only if step 1 started something and `--keep` was not given.

## Reply

The folder's full path, then the files `shots.mjs` printed, one per line. Nothing else.
