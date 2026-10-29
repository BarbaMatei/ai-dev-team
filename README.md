# ai-dev-team

A small Claude Code plugin marketplace. Each plugin is standalone, written in plain Node (>= 22, no dependencies), and works the same on Windows and Linux.

## Plugins

| Plugin | Version | Job | Config keys read |
|---|---|---|---|
| [guardrails](plugins/guardrails/README.md) | 0.2.0 | Secret check and comment gate (git pre-commit and Claude Code hooks), unscoped-test guard, scoped test runner | `secrets`, `comments`, `testGuard`, `tests`, `testLock` |
| [review](plugins/review/README.md) | 0.2.1 | Proven code review: findings count only when a failing test proves them; evidence-pack PR body | `tests`, `rulesDir`, `areas`, `triggers`, `decisions`, `bugs` |
| [spec-upkeep](plugins/spec-upkeep/README.md) | 0.1.0 | Reports stale paths, symbols, commands and links cited in project docs; the check-docs skill fixes them | `docDrift` |
| [test-quality](plugins/test-quality/README.md) | 0.1.1 | Flags decorative new tests and maps acceptance criteria to tests (test-critic agent, check-tests and writing-tests skills) | `testQuality` |
| [metrics](plugins/metrics/README.md) | 0.2.0 | Records one CSV row per merged PR: time to merge, review counts, token use | `metrics` |

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
  "testLock": true,
  "testGuard": true,
  "secrets": { "patterns": ["<extra regex>"], "allowPaths": ["docs/**"], "hint": "Move the secret to your vault." },
  "comments": { "extensions": [".cs", ".ts"] },
  "rulesDir": ".claude/rules",
  "areas": { "web": ["src/app/**"] },
  "triggers": ["payments", "auth"],
  "decisions": "docs/decisions.md",
  "bugs": { "label": "bug" },
  "docDrift": { "files": ["docs/**/*.md"], "ignore": ["generated/out.json"] },
  "testQuality": { "testFiles": ["**/*.test.ts"] },
  "metrics": { "file": "metrics/bolts.csv", "since": 1 }
}
```

Each plugin's README says what its keys do. `format` is `dotnet` or `vitest` (anything else prints the raw tail). An area is a rule file in `rulesDir` with its `paths:` globs, plus each `areas` entry; `triggers` names the areas that get the extra design and security passes.

Globs: `**` any depth, `*` inside one path segment, `?` one character; paths are `/`-separated and repo-relative.

## Versioning

Semver per plugin in `plugins/<name>/.claude-plugin/plugin.json`. Releases are git tags named `<name>-vX.Y.Z`.

## Development

```
node --test "plugins/*/tests/*.test.mjs" "tests/*.test.mjs"
```

## License

MIT
