---
name: drive
description: Use when you must act in the running web app like a person, for example to check a bug's reproduction steps before handing them to someone. Boots the app if it is not running, runs a steps file (go, wait, click, type, press, upload, eval, shot) in a headless Chromium browser and returns the console and network log. Args - <steps.json> [--keep].
---

# Drive

You run a steps file against the app and hand back what happened. You change no project files.

- **Args:** `<steps.json>` (written by you or given) and optional `--keep`.
- **Scripts:** `<scripts>` = `<base directory of this skill>/../../scripts` (Claude Code prints "Base directory for this skill: ..." when this skill loads). Run them from the project root.
- **Temp files:** `<tmp>` = the session's scratchpad directory if Claude Code lists one, else the OS temp folder (`node -e "console.log(require('os').tmpdir())"`); never inside `.git` or the working tree.
- **Config:** `browser` in `<project>/.claude/ai-dev-team.json`: `baseUrl`, `boot`, `timeoutSec`, `exe`. When something is missing the script says what to set; show that line and stop.

## Steps

Run `app.mjs up` and `drive.mjs` with the Bash tool timeout set to 600000 ms. If one is cut off anyway, run `app.mjs down` and stop.

1. `node "<scripts>/app.mjs" up`. Exit 1 or 2: show its stderr and stop. Note whether any output line starts with `ready` (it started something); `reuse` lines mean it did not.
2. `MSYS_NO_PATHCONV=1 node "<scripts>/drive.mjs" <steps.json> "<tmp>/drive-<yyyymmdd-hhmm>"` (use the current local date and time). Exit 1: a step failed, its screenshot is `fail-<n>.png` in the folder. Exit 2: the steps file or config is wrong, nothing ran; show stderr, do step 3, then stop.
3. Run `node "<scripts>/app.mjs" down` only if step 1 started something and `--keep` was not given.

## Steps file

```json
{ "viewport": "1280x800", "timeoutMs": 10000, "steps": [ { "go": "/login" }, { "type": "#email", "text": "a@b.test" }, { "press": "Enter" }, { "wait": ".welcome" }, { "shot": "after-login" } ] }
```

`viewport` (default `1280x800`) and `timeoutMs` (default 10000, the wait for every step) are optional. A step has exactly one action; any step may add `timeoutMs`.

- `go`: a route (joined to `browser.baseUrl`) or a full `http(s)://` address; waits for the load event, then for 500 ms without open requests.
- `wait`: a CSS selector, until present and visible.
- `until`: a JS expression, until it is truthy.
- `click`: a CSS selector; waits, scrolls it into view, real left click at its centre. A different element on top prints a `note` line.
- `type`: a CSS selector plus `text`; focuses, replaces existing text.
- `press`: `Enter`, `Tab`, `Escape`, `Space`, `Backspace`, `ArrowUp` or `ArrowDown`.
- `upload`: a CSS selector of a file input plus `files` (paths relative to the steps file's folder, must exist).
- `eval`: a JS expression, awaited; the value is printed as JSON.
- `shot`: a name (`[\w.-]+`); saves `<folder>/<name>.png`.
- `sleep`: milliseconds.

Wait with `wait` or `until`, never `sleep`, except for animations.

## Reply

The script's stdout exactly as printed (lines `step`, `eval`, `shot`, `console`, `exception`, `api`, `failed`, `fail`, `done`), then the folder's full path. `drive.log` in the folder holds every request.
