---
name: drive
description: Use when you must act in the running web app like a person, for example to check a bug's reproduction steps before handing them to someone. Boots the app if it is not running, runs a steps file (go, wait, click, type, press, upload, eval, shot) in a headless Chromium browser and returns the console and network log. Args - <steps.json> [--keep].
---

# Drive

You run a steps file against the app and hand back what happened. You change no project files.

- **Args:** `<steps.json>` (written by you or given) and optional `--keep`.
- **Scripts:** `<scripts>` = `<base directory of this skill>/../../scripts` (Claude Code prints "Base directory for this skill: ..." when this skill loads). Run them from the project root.
- **Temp files:** `<tmp>` = the session's scratchpad directory if Claude Code lists one, else the OS temp folder (`node -e "console.log(require('os').tmpdir())"`); never inside `.git` or the working tree.
- **Config:** `browser` in `<project>/.claude/ai-dev-team.json`: `baseUrl`, `boot`, `timeoutSec`, `stepTimeoutMs`, `exe`; a `browser` object in `.claude/ai-dev-team.local.json` (this machine only, never committed) overrides those keys. When something is missing the script says what to set; show that line and stop.

## Steps

Run `app.mjs up` and `drive.mjs` with the Bash tool timeout set to 600000 ms. If one is cut off anyway, run `app.mjs down` and stop.

Skip steps 1 and 3 when every `go` in the steps file is a full `http(s)://` address that does not start with `browser.baseUrl`: the run does not use the configured app. Say so in the reply.

1. `node "<scripts>/app.mjs" up`. Exit 1 or 2: show its stderr and stop. Note whether any output line starts with `ready` (it started something); `reuse` lines mean it did not.
2. `node "<scripts>/drive.mjs" <steps.json> "<tmp>/drive-<yyyymmdd-hhmmss>"` (use the current local date and time, with seconds). Exit 1: a step failed, its screenshot is `fail-<n>.png` in the folder. Exit 2: the steps file or config is wrong, nothing ran; show stderr, do step 3, then stop.
3. Run `node "<scripts>/app.mjs" down` only if step 1 started something and `--keep` was not given.

## Steps file

```json
{ "viewport": "1280x800", "timeoutMs": 10000, "steps": [ { "go": "/login" }, { "type": "#email", "text": "a@b.test" }, { "press": "Enter" }, { "wait": ".welcome" }, { "shot": "after-login" } ] }
```

`viewport` (default `1280x800`) and `timeoutMs` (default `browser.stepTimeoutMs`, else 10000, the wait for every step) are optional; the first `go` step without its own `timeoutMs` waits at least 60000 ms for its load event, unless the steps file sets `timeoutMs` (a dev server's first page build is slow). A step has exactly one action; any step may add `timeoutMs`.

- `go`: a route (joined to `browser.baseUrl`) or a full `http(s)://` address; waits for the load event, then for 500 ms without open requests. Then checks for a dev-server error overlay: one there prints `overlay <n> <its first line>`, the page is loaded once more, and the step fails if the overlay stays.
- `wait`: a CSS selector, until present and visible.
- `until`: a JS expression, until it is truthy.
- `click`: a CSS selector; waits, scrolls it into view, real left click at its centre. A different element on top prints a `note` line.
- `type`: a CSS selector plus `text`; focuses, replaces existing text.
- `press`: `Enter`, `Tab`, `Escape`, `Space`, `Backspace`, `ArrowUp` or `ArrowDown`.
- `upload`: a CSS selector of a file input plus `files` (paths relative to the steps file's folder, must exist).
- `eval`: a JS expression, awaited; the value is printed as JSON.
- `shot`: a name (`[\w.-]+`); saves `<folder>/<name>.png`. Fails instead when a dev-server error overlay is on the page.
- `sleep`: milliseconds.

`fake` (optional list, top level) answers chosen requests with a made-up reply: `{ "url": "*/api/orders?*", "method": "GET", "status": 200, "json": {...} }`. `url` is a wildcard (`*` any run, `?` one character) that must match the whole request address; `method` is optional; give exactly one of `json`, `text` or `file` (path relative to the steps file, must exist); `type` overrides the content type. First match wins; other requests go through. Each answer prints `fake <METHOD> <url>`; a fake also answers the CORS preflight (OPTIONS) for its address. Show scale or rare data by faking replies, never by changing real data.

JavaScript dialogs (`alert`, `confirm`, `prompt`) are accepted automatically and print a `dialog` line.

Drive cannot do: frames from another site (for example a hosted payment form), drag and drop, new tabs or popups, hover-only menus.

Wait with `wait` or `until`, never `sleep`, except for animations.

After editing source files with the app running (a fix, or a mutate-check of a UI file), wait for the dev server's rebuild before driving.

## Reply

The script's stdout exactly as printed (lines `step`, `eval`, `shot`, `console`, `exception`, `dialog`, `overlay`, `api`, `failed`, `fake`, `fake-error`, `fail`, `done`), then the folder's full path. `drive.log` in the folder holds the API (XHR/Fetch) responses and failed requests, not every request.
