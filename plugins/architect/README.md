# architect

Suggests what to build, improve or fix next, and shows the proof. You name a topic (for example `orders`); the plugin reads the project's code, specs and open issues and writes a few proposals. Each proposal cites real code lines, and a script checks every cite before anything is kept. Plain Node (>= 22), no dependencies; the `gh` CLI is used for issues.

It never edits specs. A proposal is a starting point: a driver takes it into specsmd inception (a new intent, a story in an existing intent, or a `bolt-replan` on a unit).

## Use

```
/architect:propose <topic> [--area <name>] [--max <n>]
```

1. It builds a brief: spec files that mention the topic, the tracked code files that mention it most, and the open issues and proposals on it. With `--area` it also lists that area's files.
2. It tells you the token estimate and waits for your yes.
3. The `architect` agent (Opus, read-only) writes up to `--max` proposals (default 5). Each has a kind (feature, improvement or gap), why, evidence, smallest version, specsmd route and one owner question.
4. `context.mjs check` makes sure each cited path is tracked and each cited line exists, each `#<n>` is a real issue, and each proposal cites at least one code file. A failing proposal is fixed once, else dropped.
5. Each kept proposal becomes one GitHub issue with the `proposal` label (an open issue with the same title is skipped). If `gh` is missing, the proposals are written to a temp file and the exact `gh issue create` commands are printed. Nothing is committed and no PR is opened.

## Scripts

```
node scripts/context.mjs brief <topic> [--area <name>] [--gh <command>]
node scripts/context.mjs check <proposals.md> [--gh <command>]
```

- `brief` prints `## Area files`, `## Specs`, `## Code`, `## Open issues` and `## Open proposals`, each capped. If `gh` fails, the issue sections say `(gh unavailable)` and the exit code stays 0. An unknown `--area` exits 2 and lists the area names.
- `check` prints `bad <cite> — <reason> (in "<block title>")` and `no-code-cite <title>` lines and exits 1, or prints `cites: ok (<n>)`. When `gh` is unavailable, issue numbers print `unchecked #<n>` and do not fail the check.
- `--gh` is the command used for `gh`, split on spaces (double quotes group).

## Config

In `<project>/.claude/ai-dev-team.json`:

```json
{ "architect": { "specs": ["memory-bank/intents/*/requirements.md"], "label": "proposal" } }
```

`specs` are the globs of spec files (the status is the first `status: <value>` line of a file). `label` is the issue label. `rulesDir` and `areas` work as in the review plugin.

## Install

```
/plugin marketplace add BarbaMatei/ai-dev-team
/plugin install architect@ai-dev-team
```
