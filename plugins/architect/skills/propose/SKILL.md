---
name: propose
description: Use when the owner asks what to build, improve or fix next on a topic or area, for example "what could we add around orders". Gathers code, specs and open issues, has the architect agent write evidence-checked proposals, and files each as a GitHub issue for specsmd inception. Never edits specs. Args - <topic> [--area <name>] [--max <n>].
---

# Propose

You turn one topic into a few evidence-checked proposals. A driver then takes a proposal into specsmd inception (a new intent, a story or a `bolt-replan`). You never edit specs, code or any tracked file, and you commit nothing and open no PR.

- **Args:** `<topic>`, optional `--area <name>` (a rule file's basename or a key of the config's `areas`), optional `--max <n>` proposals (default 5).
- **Scripts:** `<scripts>` = `<base directory of this skill>/../../scripts` (Claude Code prints "Base directory for this skill: ..." when this skill loads). Run them from the project root.
- **Temp files:** `<tmp>` = the session's scratchpad directory if Claude Code lists one, else the OS temp folder (`node -e "console.log(require('os').tmpdir())"`); never inside `.git` or the working tree.
- **Config:** `<project>/.claude/ai-dev-team.json`: `architect.specs` (spec globs, default `["memory-bank/intents/*/requirements.md"]`), `architect.label` (default `proposal`), plus `rulesDir` and `areas` for `--area`.

## Gather and cost

1. `node "<scripts>/context.mjs" brief "<topic>" [--area <name>] > <tmp>/architect-brief.md`. Exit 2 → show its message (it lists the area names for an unknown area) and stop.
2. Announce in one line: "<topic>: ≈ <(area lines, from the `total:` line of `## Area files`, or 2000 without `--area`) × 15 / 1000 + 40>k tokens. Go?"
3. Wait for an explicit yes. Anything else, or no answer (a headless run), ends the run here.

## Propose and check

4. One Agent (`subagent_type: architect:architect`): "Brief: <tmp>/architect-brief.md. Topic: <topic>. Maximum: <n>." Save its reply to `<tmp>/architect-proposals.md`.
5. `node "<scripts>/context.mjs" check "<tmp>/architect-proposals.md"`.
   - `cites: ok` → continue.
   - Exit 1 → each `bad` line ends with `(in "<block title>")` and each `no-code-cite` line names its block. Send these lines to the same agent once (SendMessage) and ask it to return all proposals again with those blocks fixed from code it reads. Save the reply and check again.
   - Blocks named by the lines that still fail → drop those blocks and count them. `unchecked #<n>` lines are not failures.
6. No block survives → reply that nothing is proven for this topic and stop.

## Land the proposals

7. Ask the owner where they go if not already said; the default is one GitHub issue per kept proposal. For each kept block:
   1. `gh issue list --search "<title> in:title" --state open`. An open issue with the same title → note its number and skip.
   2. Write that block alone to `<tmp>/architect-issue.md`.
   3. `gh issue create --title "<title>" --label <architect.label> --body-file <that path>`.
   Before the first issue, `gh label list --search <label> --json name`. If the exact name is absent, create it once: `gh label create <label> --description "Architect proposal for specsmd inception"`.
8. `gh` missing or failing → keep all kept proposals in `<tmp>/architect-proposals.md`, and put the exact `gh issue create` command for each in the reply.

## Reply

At most 10 lines: the topic, proposals kept (number and title), dropped (count and why), duplicates skipped (issue numbers), where they landed (issue numbers, or the full path of `<tmp>/architect-proposals.md`), and the line "Specs were not edited; a driver takes a proposal into specsmd inception."
