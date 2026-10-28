# spec-upkeep

Keeps project docs honest. `doc-drift` reads your docs and reports every file path, symbol, command and link they cite that no longer exists in the repo. The `check-docs` skill runs it and fixes the docs to match the code.

## doc-drift

```
node plugins/spec-upkeep/scripts/doc-drift.mjs [--root <dir>]
```

One line per stale citation, `<doc>:<line>: <kind> \`<text>\` — <reason>`, then `doc-drift: <n> stale reference(s) in <m> file(s)` (exit 1) or `doc-drift: clean (<k> references in <m> files)` (exit 0). A bad config file exits 2.

Which docs: `CLAUDE.md`, `AGENTS.md`, `.claude/rules/**/*.md`, `memory-bank/standards/**/*.md` (tracked files only).

### What it checks

- **Paths** (in inline code): has a `/`, starts with `.`, or ends in a known extension. It must exist on disk (from the project root or the doc's folder) or match a tracked file by its tail (`app/Order.cs` finds `src/app/Order.cs`). Globs need one match. `file:12` must not point past the file's last line.
- **Symbols** (in inline code): `Service.Method()`, `cartItems`, `STORAGE_KEY`. Every part of 3 or more characters must appear as a whole word in tracked code (non-Markdown text files up to 1 MB).
- **Commands**: lines starting with `dotnet`, `npm`, `npx`, `node`, `git`, `gh` and similar tools, in inline code or in shell code blocks. `npm test|start|run <x>` needs that script in a tracked `package.json`; path-like arguments must exist.
- **Links**: Markdown link targets, relative to the doc's folder, then the project root. `%20` is decoded; `#anchors` and `?queries` are dropped.

### What it skips

Citations with placeholders or shell syntax (`<`, `>`, `{`, `}`, `$`, `...`), URL and absolute routes (`/api/x`, `http...`), flags (`-x`), symbols with `*`, plain words, `http(s):`, `mailto:` and `#` links, and code blocks in languages other than shell.

## Config

`<project>/.claude/ai-dev-team.json`, all optional:

```json
{ "docDrift": { "files": ["docs/**/*.md", "CLAUDE.md"], "ignore": ["generated/out.json"] } }
```

- `docDrift.files`: globs of docs to check; replaces the default list.
- `docDrift.ignore`: exact citation texts that are never reported.

## check-docs skill

Use it when a change edits docs or moves, renames or deletes things they cite, and before a PR. It runs doc-drift, fixes each stale line against the code (never the other way round), re-runs until clean, and runs specsmd's `status-integrity.cjs` when `.specsmd/aidlc/scripts/` has it (`--fix` on inconsistencies).

## Install

```
/plugin marketplace add BarbaMatei/ai-dev-team
/plugin install spec-upkeep@ai-dev-team
```
