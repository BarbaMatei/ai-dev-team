# ai-dev-team

A small Claude Code plugin marketplace. Each plugin is standalone, written in plain Node (>= 22, no dependencies), and works the same on Windows and Linux.

## Plugins

| Plugin | Version | Job |
|---|---|---|
| guardrails | 0.1.0 | Git pre-commit secret check and comment gate |

## Install

```
/plugin marketplace add BarbaMatei/ai-dev-team
/plugin install guardrails@ai-dev-team
```

## Project config

Every key is optional. Put it in `<project>/.claude/ai-dev-team.json`. A missing file means defaults; invalid JSON stops with one line on stderr and exit code 2.

```json
{
  "secrets": { "patterns": ["<extra regex>"], "allowPaths": ["docs/**"], "hint": "Move the secret to your vault." },
  "comments": { "extensions": [".cs", ".ts"] },
  "tests": { "unit": { "command": "dotnet test App.Tests --filter \"FullyQualifiedName~{filter}\"", "cwd": "src", "format": "dotnet" } },
  "rulesDir": ".claude/rules",
  "areas": { "web": ["src/app/**"] }
}
```

Globs: `**` any depth, `*` inside one path segment, `?` one character; paths are `/`-separated and repo-relative.

## Versioning

Semver per plugin in `plugins/<name>/.claude-plugin/plugin.json`. Releases are git tags named `<name>-vX.Y.Z`.

## Development

```
node --test "plugins/*/tests/*.test.mjs" "tests/*.test.mjs"
```

## License

MIT
