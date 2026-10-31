# ai-dev-team

A small Claude Code plugin marketplace. Each plugin is standalone, written in plain Node (>= 22, no dependencies), and works the same on Windows and Linux.

## Plugins

| Plugin | Job | Config keys read |
|---|---|---|
| [guardrails](plugins/guardrails/README.md) | Secret check and comment gate (git pre-commit and Claude Code hooks), unscoped-test guard, scoped test runner | `secrets`, `comments`, `testGuard`, `tests`, `testLock` |
| [review](plugins/review/README.md) | Proven code review: findings count only when a failing test proves them; proven bugs fixed one at a time with the owner; evidence-pack PR body | `tests`, `rulesDir`, `areas`, `triggers`, `decisions`, `bugs`, `browser`, `fix` |
| [spec-upkeep](plugins/spec-upkeep/README.md) | Reports stale paths, symbols, commands and links cited in project docs; the check-docs skill fixes them | `docDrift` |
| [test-quality](plugins/test-quality/README.md) | Flags decorative new tests and maps acceptance criteria to tests (test-critic agent, check-tests and writing-tests skills) | `testQuality` |
| [metrics](plugins/metrics/README.md) | Records one CSV row per merged PR: time to merge, review counts, token use | `metrics` |
| [browser](plugins/browser/README.md) | Starts and stops the app, takes page screenshots and drives it step by step (clicks, typing, faked replies) with a headless browser | `browser` |
| [e2e](plugins/e2e/README.md) | Writes Playwright tests from story acceptance criteria; the browser plugin starts the app | `e2e` |
| [ui-review](plugins/ui-review/README.md) | Reviews screenshots against design tokens and UI rules; a script checks every contrast claim | `uiReview` |
| [architect](plugins/architect/README.md) | Proposes features, improvements and gaps from code, specs and open issues; a script checks every cite | `architect`, `rulesDir`, `areas` |
| [release](plugins/release/README.md) | Works out each package's next version from conventional commits; writes its version file, changelog and tag; a GitHub action pushes and publishes the release | `release` |

Each plugin is versioned on its own (tags `<name>-vX.Y.Z`). A merge to main releases each changed plugin; its CHANGELOG.md and the GitHub releases page list its versions.

## Install

```
/plugin marketplace add BarbaMatei/ai-dev-team
/plugin install <plugin>@ai-dev-team
```

## Project config

Every key is optional. Put it in `<project>/.claude/ai-dev-team.json`. A missing file means defaults; invalid JSON stops with one line on stderr and exit code 2.

```json
{
  "tests": { "unit": { "command": "dotnet test App.Tests --filter \"FullyQualifiedName~{filter}\"", "cwd": "src", "format": "dotnet", "buildError": "error CS\\d{4}|Build FAILED" } },
  "testLock": true, "testGuard": true, "secrets": { "patterns": ["<extra regex>"], "allowPaths": ["docs/**"], "hint": "Move the secret to your vault." },
  "comments": { "extensions": [".cs", ".ts"] },
  "rulesDir": ".claude/rules", "areas": { "web": ["src/app/**"] }, "triggers": ["payments", "auth"],
  "decisions": "docs/decisions.md", "bugs": { "label": "bug" }, "docDrift": { "files": ["docs/**/*.md"], "ignore": ["generated/out.json"] },
  "testQuality": { "testFiles": ["**/*.test.ts"] }, "metrics": { "file": "metrics/bolts.csv", "since": 1 },
  "browser": { "baseUrl": "http://localhost:3000", "boot": [{ "name": "web", "command": "npm start", "ready": "http://localhost:3000/" }] },
  "fix": { "accounts": "docs/test-accounts.md", "dataQuery": "node scripts/db-query.mjs \"{sql}\"" },
  "e2e": { "dir": "e2e", "command": "npx playwright test --grep {filter}" },
  "uiReview": { "tokens": ["src/styles/_tokens.scss"], "rules": ["docs/ui-rules.md"] },
  "architect": { "specs": ["memory-bank/intents/*/requirements.md"], "label": "proposal" },
  "release": { "packages": ["plugins/*"], "versionFile": ".claude-plugin/plugin.json", "tag": "{name}-v{version}", "patch": "any" }
}
```

Each plugin's README says what its keys do. `format` is `dotnet` or `vitest` (anything else prints the raw tail). An area is a rule file in `rulesDir` with its `paths:` globs, plus each `areas` entry; `triggers` names the areas that get the extra design and security passes. Globs: `**` any depth, `*` inside one path segment, `?` one character; paths are `/`-separated and repo-relative; in `areas`, a glob starting with `!` excludes the files it matches.

## Development

```
node --test "plugins/*/tests/*.test.mjs" "tests/*.test.mjs"
```

## License

MIT
