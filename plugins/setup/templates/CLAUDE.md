# {{name}}

<!-- setup:fill intro: one or two lines on what the project is, its parts and their folders -->
User-facing text is in {{language}}. Work is driven by specsmd AI-DLC (`/specsmd-master-agent`); its artifacts live in `memory-bank/`.

## Constraints that bite when unknown

<!-- setup:fill constraints: the stack facts from memory-bank/standards that a newcomer would get wrong -->

## Commands

<!-- setup:fill commands: run, build and scoped test commands for each part -->

<!-- kit:tests -->
## Running tests

Never run the whole suite by default. Run only the tests you added or changed, then the tests of the code you touched. A change in one part runs only that part's tests. The scoped commands are `tests` in `.claude/ai-dev-team.json`; the guardrails `scoped-test` runner prints totals and failures only.

A full run is a last resort (a shared-infrastructure change, or the owner asks); then run it one part at a time, never two parts at once.
<!-- /kit:tests -->

<!-- kit:code-rules -->
## Code rules

- Mock only at system boundaries in tests; a mocked-out real component that turns a test green proves nothing. A regression test must fail when its fix is reverted.
- Comments are a last resort: one short line, only to explain a non-obvious why. Never narrate a change or cite ticket ids. Doc comments only on interface members.
- Standards are descriptive: when you change reality (a version, a tool, a contract), update the standard that states it in the same change.
- Secrets never go in git.
<!-- /kit:code-rules -->

## Where to read first

<!-- setup:fill where-to-read: a table from each kind of work to the memory-bank/standards file to read -->

<!-- kit:attach-points -->
## Kit attach points (specsmd bolt flow)

1. Create the bolt branch from `main` before routing or inception work.
2. A bug in a finished story = a construction `bolt-replan` on its unit; a new intent only when no story owns it.
3. `review:design-critic` on an area listed in `triggers` (`.claude/ai-dev-team.json`): DDD bolt = the technical design; simple bolt = the plan's `implementation-plan.md`, before the plan checkpoint.
4. Implement (both bolt types): split the stage plan into `### Task N` sections and run them with `superpowers:subagent-driven-development`, tests first (`superpowers:test-driven-development`); per-task reviews on a small model. It stops after its tasks: no final review and no `superpowers:finishing-a-development-branch`. Never the full suite, even where its templates say so.
5. Test stage = verification: `test-quality:check-tests`, then the review plugin's mutate-check on each regression test's fix line (from the implementer reports): `node <review plugin>/scripts/mutate-check.mjs --file <f> --line <n> --replace "<pre-fix text>" --kind <tests key> --test "<filter>"`.
6. End order: test checkpoint, `node .specsmd/aidlc/scripts/bolt-complete.cjs`, `node .specsmd/aidlc/scripts/status-integrity.cjs --fix` until 0, the story-index line and the last stage entry by hand, `review:review-bolt` exactly once, then the PR.
7. Every commit on a PR branch: the pre-commit hook stages the metrics rows of newly merged PRs; keep them staged.
8. Fixing proven bugs with the owner: `review:fix-findings <issue>...`; it ends with `review:review-bolt --ask`.
<!-- /kit:attach-points -->

<!-- kit:git -->
## Git

Conventional commits, one-sentence subject, no body, no trailers. Never `--no-verify`.
Commit, push and open PRs; the owner merges.
Do not switch branches in a checkout other sessions use; use worktrees.
<!-- /kit:git -->

<!-- kit:replies -->
## Replies

Lead with the result in 1-3 plain sentences; failures, skipped work and risks first.
Plain words a non-programmer can follow; name files, tests and errors exactly.
No preamble, recaps or play-by-play. Under ~10 short lines unless the deliverable is long.
Work reports: one line per change plus how it was verified; no pasted code unless asked.
<!-- /kit:replies -->
