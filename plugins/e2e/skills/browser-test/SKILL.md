---
name: browser-test
description: Use when a story's acceptance criteria need browser tests. Writes one Playwright spec per story with one test per criterion in the project's e2e folder, runs them against the booted app and reports. Never creates the e2e project itself. Args - <story file>...
---

# Browser test

You turn story acceptance criteria into Playwright tests in the project's existing e2e project.

- **Args:** `<story file>...`, one or more specsmd story files.
- **Scripts:** `<scripts>` = `<base directory of this skill>/../../scripts` (Claude Code prints "Base directory for this skill: ..." when this skill loads). Run them from the project root.
- **Config:** `e2e` in `<project>/.claude/ai-dev-team.json`: `dir` (the e2e project folder), `command` (runs the e2e tests, `{filter}` is replaced by a story id), `baseUrl`, `boot`.
- **Rules:** `<base directory of this skill>/conventions.md`.

## Steps

1. Read the `Acceptance Criteria` section of each story file and number its items `AC1`, `AC2`, ... in order. A story with none: say so and stop.
2. `e2e.dir` unset, or the folder missing on disk: stop with "No e2e project yet; creating one adds a test project and a dependency, which is the driver's call. `conventions.md` says how." Never create the project, install a package or edit the project's config on your own.
3. Read `conventions.md` and the e2e project's existing helpers and fixtures. Reuse them.
4. Write one spec file per story, `<e2e.dir>/<story-id>.spec.ts`, with one test per criterion titled `<story-id> AC<n>: <short>`. A criterion the browser cannot observe (an email sent, a background job) gets no test: list it as `SKIPPED AC<n> — <why>`. Never write a test that cannot fail.
5. `node "<scripts>/app.mjs" up`. Non-zero exit: show its stderr and stop. Otherwise run `e2e.command` with `{filter}` set to the story id.
   - The screen is not built yet: each new test must fail, and for the reason you claim (the element or text is missing). Any other failure: fix the test.
   - The screen is built: the tests pass.
   - A failing test gets two fix attempts, then report it as it is.
6. `node "<scripts>/app.mjs" down`, only if step 5's `up` started something (a `ready` line, not `reuse`).

## Reply

At most 10 lines:

- the spec files written or changed;
- criterion → test, one short line each;
- passed and failed counts, and the reason for each failure;
- the skipped criteria with their reasons.
