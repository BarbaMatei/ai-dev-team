# e2e

Turn story acceptance criteria into Playwright tests. Zero dependencies of its own. It needs the `browser` plugin, which starts the app.

## What is in it

- Skill `e2e:browser-test` writes one Playwright spec per story from its acceptance criteria and runs it against the app that `browser:app up` started. Args: `<story file>...`. It never creates the e2e project: that is your call, and `skills/browser-test/conventions.md` says how.

## Settings

In `<project>/.claude/ai-dev-team.json`. The app (`baseUrl`, `boot`) is configured under `browser`; see the `browser` plugin.

```json
{
  "e2e": {
    "dir": "e2e",
    "command": "npx playwright test --grep {filter}"
  }
}
```

- `dir`: the e2e project folder. Missing: the skill stops and says how to create one.
- `command`: runs the e2e tests; `{filter}` is replaced by the story id.

## Good to know

- Without the `browser` plugin the skill stops with "Install the browser plugin: it starts the app."
- Screenshots moved to `browser:capture`.
