# browser

Start the app and take screenshots of its pages. Other plugins (`e2e`, `ui-review`) use its skills instead of carrying their own browser code. Zero dependencies: Node 22 or newer, plus a Chrome, Edge or Chromium already on the machine.

## What is in it

- `app.mjs up|down|status` starts the app's parts in order (for example the API, then the web server), waits until each answers, and stops them again with everything they started. A part that already runs is reused and left alone.
- `shots.mjs` takes one PNG per page and screen size with a headless browser, using the DevTools protocol, so phone viewport widths are exact. One browser profile is shared across the shots of a run. `E2E_START_TIMEOUT_MS` (default 15000) is for tests only.
- Skill `browser:app` runs `app.mjs`. Arg: `up|down|status`.
- Skill `browser:capture` boots the app, takes the screenshots and returns the folder. Args: `<route>... [--viewports 390x844,1280x800] [--wait <ms>] [--keep]`.

## Settings

In `<project>/.claude/ai-dev-team.json`. Set at least `baseUrl`.

```json
{
  "browser": {
    "baseUrl": "http://localhost:3000",
    "timeoutSec": 120,
    "boot": [
      { "name": "api", "command": "npm run api", "cwd": "server", "ready": "http://localhost:5000/health", "env": { "PORT": "5000" } },
      { "name": "web", "command": "npm start", "ready": "http://localhost:3000/" },
      { "name": "db", "ready": "tcp://localhost:5432" }
    ],
    "exe": "C:/Program Files/Google/Chrome/Application/chrome.exe"
  }
}
```

- `boot[].ready`: an `http(s)://` address that answers with any status below 400, or `tcp://host:port` that accepts a connection. Without a `command` the part must already run.
- `timeoutSec`: how long to wait for each part (default 120).
- `exe`: a path, or a list `[exe, ...args]`. A path that does not exist is an error. Unset: the `CHROME_PATH` variable, then the usual install places, then `google-chrome`, `chromium`, `msedge` on the PATH.

An invalid setting prints one line and exits 2.

## Good to know

- State and logs live in `<temp folder>/ai-dev-team-browser/<project id>/`. `up` prints the last 20 log lines when a part does not start.
- `down` stops only what `up` started.
- The old `e2e` key no longer configures the app; move `baseUrl`, `boot`, `timeoutSec` and `browser` into `browser` (`browser` becomes `exe`).
