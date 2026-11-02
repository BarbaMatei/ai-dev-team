---
name: check
description: Use when the owner wants to know whether a project set up with the kit still matches the kit's current setup, or wants it brought up to date. Lists missing files and outdated kit sections and changes only what the owner approves.
---

# Setup check

You compare the project with the kit's current setup and change only what the owner approves. Text outside the kit markers (`<!-- kit:<id> -->` ... `<!-- /kit:<id> -->`) belongs to the owner: never compared, never changed.

- **Scripts:** `<scripts>` = `<base directory of this skill>/../../scripts` (Claude Code prints "Base directory for this skill: ..." when this skill loads). Run them from the project root.

## Steps

1. Run `node "<scripts>/check.mjs"`.
2. Exit 2 with `no setup stamp` → the project was never set up with the kit: offer `setup:new`, which adopts an existing repository, and stop. Any other exit 2 → show its line and stop.
3. `up to date` → say so in one line and stop.
4. Otherwise one message, one plain line per printed line:
   - `missing <path>` → the file is missing and would be created from the kit's current template;
   - `block <path> <id> outdated` → the kit's `<id>` section changed and would be replaced with the current kit text, the owner's own text staying as it is (the exact change shows in the diff before the commit);
   - `block <path> <id> absent` → the file has no kit `<id>` section; the script never adds one: offer to place it once, where it fits;
   - `stamp <old> -> <new>` → set up with kit setup `<old>`, current is `<new>`.
   End with "Update?".
5. On yes: a branch `chore/kit-setup-update` (in a worktree if other sessions share this checkout; run everything below from there), then `node "<scripts>/check.mjs" --write` (a `hooksPath …` line means it created the git hook and pointed git at it). Place the absent sections the owner accepted by hand. A created `CLAUDE.md` has `<!-- setup:fill ... -->` comments: replace each with what it asks for, from `memory-bank/standards/`. Run `check.mjs` again (expected: `up to date`, or only the sections the owner declined) and show `git diff --stat` plus the diff of each replaced section.
6. A created `.githooks/pre-commit` → `git add --chmod=+x .githooks/pre-commit`. Commit `chore: bring the kit setup up to date`, push, `gh pr create`. Never merge.
