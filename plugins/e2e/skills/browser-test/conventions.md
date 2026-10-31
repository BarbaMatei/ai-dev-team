# E2E conventions

Rules for the browser tests the `browser-test` skill writes. Setting up the project itself is the driver's call; this is how.

## Set-up (driver, once)

- Playwright Test lives in the project's own e2e folder (`e2e.dir`), with its own `package.json`. It is not part of the kit.
- One Chromium project in v1.
- `baseURL` comes from the environment variable `E2E_BASE_URL`, falling back to `browser.baseUrl` from `.claude/ai-dev-team.json`.
- Trace and screenshot on failure only.
- `e2e.command` runs a scoped set of tests and contains `{filter}`, for example `npx playwright test --grep {filter}`.
- Tests are changed in the same PR as the screens they test.

## Writing tests

- One file per story: `<story-id>.spec.ts`. One test per acceptance criterion, titled `<story-id> AC<n>: <short>`.
- Find things the way a user does: by role, by label or by the text on screen. Use `data-testid` only when the element has no accessible name.
- Use web-first assertions (`await expect(locator).toBeVisible()`). Never use fixed sleeps.
- Every test sets up its own data through the app's API, with unique names, and never depends on another test or on test order.
- Stub only third parties (payment, email, maps), at the network. Never stub the app's own API.
- Run only the story's tests while working: filter by story id.

## A criterion the browser cannot see

An email sent, a background job, a log line: write no test. Report `SKIPPED AC<n> — <why>` and leave it to a test at a lower level.
