# ai-dev-team kit

Public Claude Code plugin marketplace of small, standalone plugins. Rules for work inside this repo:

- Caps (enforced by `tests/caps.test.mjs`): SKILL.md and agent files <= 100 lines, scripts <= 200, README <= 60.
- Scripts are Node >= 22 `.mjs`, zero dependencies, same behaviour on Windows and Linux.
- Plugins never import across plugin folders; `scripts/lib/project.mjs` is duplicated on purpose.
- The kit knows nothing about any specific project: no project names, paths or ids anywhere. Use neutral examples.
- Public repo: never commit a secret-shaped string. Tests build fake secrets at runtime.
- Tests that spawn git delete every `GIT_*` env var and pass `-c user.name=t -c user.email=t@example.com`.
- Messages never print a matched secret, only `file:line`.
- Per-project settings live in `<project>/.claude/ai-dev-team.json`; missing file = defaults, invalid = one line on stderr, exit 2.
- Versioning: semver in `plugins/<name>/.claude-plugin/plugin.json`; tag `<name>-vX.Y.Z`.
- Commits: conventional, one-sentence subject, no body, no trailers. Never `--no-verify`.
- Comments are a last resort: one short line, only for a non-obvious why.
- Test: `node --test "plugins/*/tests/*.test.mjs" "tests/*.test.mjs"`
