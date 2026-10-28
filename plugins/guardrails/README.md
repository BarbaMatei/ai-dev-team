# guardrails

Three small checks that keep secrets and noise out of a project. Plain Node (>= 22), no dependencies. Config lives in `<project>/.claude/ai-dev-team.json`; see the [root README](../../README.md) for the full block. Every key is optional.

## The three pieces

| Piece | What it does | Config keys it reads |
|---|---|---|
| Git pre-commit | Blocks staged secrets; lists added comment lines | `secrets`, `comments` |
| Claude Code hooks | Same two checks while Claude edits files | `secrets`, `comments` |
| `scoped-test` | Runs one scoped test command, prints only totals and failing names | `tests`, `testLock` |

## Git pre-commit hook

Install the plugin, then save this as `.githooks/pre-commit` (and run `git config core.hooksPath .githooks` once per clone):

```sh
#!/bin/sh
dir=$(ls -d "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/ai-dev-team/guardrails/*/ 2>/dev/null | sort -V | tail -n 1)
if [ -z "$dir" ]; then
  echo "pre-commit: install the guardrails plugin (claude plugin install guardrails@ai-dev-team --scope project)" >&2
  exit 1
fi
exec node "${dir}scripts/pre-commit.mjs"
```

Comment lines are checked only in `.cs .ts .tsx .js .jsx .mjs .cjs .java .kt .go .rs .swift .c .cpp .h .scss` files; `#`-comment languages (Python, shell, YAML) are not checked unless added via `comments.extensions`.

A matched secret is reported as `file:line`, never printed. Added comment lines are listed and block the commit; set `COMMENTS_OK=1` when every listed line is deliberate. Invalid config: one line on stderr, exit 2.

## Claude Code hooks

Installing the plugin registers them (`hooks/hooks.json`). Before a `Write`, `Edit` or `MultiEdit` the secret check can block the edit; after it, added comment lines are reported. A broken config falls back to defaults instead of blocking every edit.

## scoped-test

```
node scripts/scoped-test.mjs <kind> <filter>
```

`<kind>` names an entry under `tests` in the config. `{filter}` in its `command` is replaced verbatim (the template supplies any quoting); the command runs in `cwd` relative to the project root.

| Output | Meaning | Exit |
|---|---|---|
| `PASS p/t` | all passed | 0 |
| `FAIL f/t` + up to 20 `  ✗ <name>` | failures | child code, at least 1 |
| `NO TESTS RAN (does the filter match a test?)` | zero tests matched | 1 |
| `BUILD FAILED` + first 10 lines matching `buildError` | build broke | child code |
| last 30 lines | `format` unknown or no summary found | child code |

`format` is `dotnet` or `vitest`. Unknown kind or invalid config: one line on stderr, exit 2.

## Test lock

With `"testLock": true`, runs wait for a machine-wide lock (`ai-dev-team-tests.lock` in the temp folder) so two sessions never run tests at once. It prints `waiting for the test lock (pid N)` once, polls every 2 s, gives up after 30 min, takes over locks whose process is gone, and releases on exit, Ctrl+C or SIGTERM.
