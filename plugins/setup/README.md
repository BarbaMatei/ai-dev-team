# setup

Starts a web project in minutes and keeps it current with the kit: an interview, specsmd, the AI setup (kit config, plugins, CLAUDE.md, hooks), CI, a secret scan, branch protection where GitHub allows it, releases, then the first feature handed to specsmd inception. Scripts do the file and GitHub work; the skills hold the conversation. Nothing is written before the owner's yes on the full list, no existing file is overwritten silently, and no application code is generated.

| Piece | Job |
|---|---|
| `setup:new` skill | Empty folder or repository without the setup: interview, specsmd, one list for a yes, write, commit, GitHub, first feature |
| `setup:check` skill | Project already set up: lists missing files and outdated kit sections, updates them on a yes |
| `render.mjs` | `<answers.json> <out-dir>`: writes every setup file into `<out-dir>`, prints `file <path>` |
| `apply.mjs` | `<staging> [--write]`: `create`, `same` or `differs` per file; `--write` creates only the `create` files and sets `core.hooksPath` unless another hook path is set |
| `check.mjs` | `[--write]`: `missing <path>`, `block <path> <id> outdated\|absent`, `stamp <old> -> <new>` or `up to date`; `--write` creates missing files and replaces outdated kit sections |
| `github.mjs` | `owner <login>`, `plan <answers.json>`, `apply <answers.json>`, each `[--gh <command>]`: repository, labels, ruleset, release key script |

Scripts run from the project root.

## Answers

```json
{ "name": "shop", "language": "English", "owner": "octo", "ownerType": "User", "visibility": "private",
  "stacks": [{ "id": "dotnet", "dir": "api", "role": "api" }, { "id": "angular", "dir": "web", "role": "web" }],
  "release": "semantic-release", "purpose": "...", "users": "...", "mustDo": "..." }
```

- Stack ids: `dotnet`, `angular`, `node` (Vite, React, Vue, NestJS), `python`. Roles: `api`, `web`, `lib`, at most one of each. Folders: relative, `/`-separated, letters, digits, `.`, `_` and `-`.
- `release`: `semantic-release` (one version for the repository) or `kit` (the kit's `release` plugin; needs `releaseRef`, a `release-v<x.y.z>` tag of this repository).
- `purpose`, `users` and `mustDo` feed only the first-feature proposal.

## What it writes

`CLAUDE.md` (kit sections between `<!-- kit:<id> -->` and `<!-- /kit:<id> -->`; the rest belongs to the project), `.claude/ai-dev-team.json` (scoped tests per part, browser boot for a web part, the `setup` stamp), `.claude/settings.json`, `.claude/rules/`, `.githooks/pre-commit`, `.github/workflows/` (ci, secret-scan, release), `.releaserc.json`, a PR template, `.editorconfig` and `.gitignore`. Each CI job passes without doing anything until its part's project file exists.

## GitHub limits

- Branch protection needs a public repository or a paid plan. On a private repository on the free plan the ruleset is refused and reported; releases push with the built-in token. The ruleset requires the kit's CI jobs, so it is skipped while the project keeps its own `ci.yml`.
- The workflows release from `main`; a repository whose default branch has another name is asked to rename it first.
- A personal repository releases through its protected main with a deploy key: `github.mjs` writes a script for the owner to run, which stores the `RELEASE_DEPLOY_KEY` secret. The setup never stores a secret itself. An organization uses the GitHub Actions app as the ruleset exception.
- gitleaks needs a free `GITLEAKS_LICENSE` secret on organization repositories.

## Config

`setup` in `<project>/.claude/ai-dev-team.json` is written by the setup (the answers without the free text, plus `version`); `setup:check` re-renders from it.
