---
name: check-docs
description: Use when a change edits docs, standards, rule files or CLAUDE.md, or moves, renames or deletes files, symbols, commands or npm scripts they cite; and before opening a PR. Runs doc-drift to find stale citations, fixes the docs to match the code and checks specsmd status integrity.
---

# Check docs

Docs cite files, symbols, commands and links; code changes make those citations stale. You find them and fix the docs.

- **Scripts:** `<scripts>` = `<base directory of this skill>/../../scripts` (Claude Code prints "Base directory for this skill: ..." when this skill loads). Run them from the project root.
- **Config:** `<project>/.claude/ai-dev-team.json`, optional `docDrift.files` (globs of docs to check) and `docDrift.ignore` (exact citation strings never reported).

## Steps

1. Run `node "<scripts>/doc-drift.mjs"`. Each stale line reads `<doc>:<line>: <kind> \`<text>\` — <reason>`. Exit 0 = clean, go to step 3.
2. For each stale line, find the truth in the code: `git log -S<name> --oneline` for a renamed or deleted thing, grep for the new name. Then:
   - the thing was renamed or moved: edit the doc to the new name;
   - the fact is gone: delete the sentence;
   - never change code to match a doc;
   - the citation names something intentionally absent from git (a generated file, a local-only path): add its exact text to `docDrift.ignore` in `.claude/ai-dev-team.json`.
3. If `.specsmd/aidlc/scripts/status-integrity.cjs` exists, run `node .specsmd/aidlc/scripts/status-integrity.cjs`. Inconsistencies: show the table, run it again with `--fix`, report what it fixed. If the file does not exist, note `status-integrity: specsmd not installed, skipped`.
4. Re-run doc-drift until it prints `doc-drift: clean (...)`.

## Reply

At most 8 lines: how many stale citations were found, what you fixed or deleted, anything added to `docDrift.ignore`, the status-integrity result, and the final doc-drift line.
