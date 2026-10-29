# e2e

Start the app, take screenshots of its pages, and turn story acceptance criteria into browser tests. Zero dependencies: Node 22 or newer, plus a Chrome, Edge or Chromium already on the machine.

## What is in it

- `app.mjs up|down|status` starts the app's parts in order (for example the API, then the web server), waits until each answers, and stops them again with everything they started. A part that already runs is reused and left alone.
- `shots.mjs` takes one PNG per page and screen size with a headless browser.
- Skill `e2e:capture` boots the app, takes the screenshots and returns the folder. Args: `<route>... [--viewports 390x844,1280x800] [--keep]`.
- Skill `e2e:browser-test` writes one Playwright spec per story from its acceptance criteria and runs it. Args: `<story file>...`. It never creates the e2e project: that is your call, and `skills/browser-test/conventions.md` says how.

## Settings

In `<project>/.claude/ai-dev-team.json`. Set at least `baseUrl`.

```json
{
  "e2e": {
    "baseUrl": "http://localhost:3000",
    "timeoutSec": 120,
    "boot": [
      { "name": "api", "command": "npm run api", "cwd": "server", "ready": "http://localhost:5000/health", "env": { "PORT": "5000" } },
      { "name": "web", "command": "npm start", "ready": "http://localhost:3000/" },
      { "name": "db", "ready": "tcp://localhost:5432" }
    ],
    "dir": "e2e",
    "browser": "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "command": "npx playwright test --grep {filter}"
  }
}
```

- `boot[].ready`: an `http(s)://` address that answers with any status below 400, or `tcp://host:port` that accepts a connection. Without a `command` the part must already run.
- `timeoutSec`: how long to wait for each part (default 120).
- `browser`: a path, or a list `[exe, ...args]`. A path that does not exist is an error. Unset: the `CHROME_PATH` variable, then the usual install places, then `google-chrome`, `chromium`, `msedge` on the PATH.
- `dir` and `command` are used by `browser-test` only.

An invalid setting prints one line and exits 2.

## Good to know

- State and logs live in `<temp folder>/ai-dev-team-e2e/<project id>/`. `up` prints the last 20 log lines when a part does not start.
- `down` stops only what `up` started.
