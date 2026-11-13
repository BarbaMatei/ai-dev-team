Subagent prompts of review-bolt. Every one goes to a fresh Agent (`subagent_type: general-purpose`, `model: sonnet`); fill every `<...>` before sending.

## Step 4 — simplify

```
Invoke the `simplify` skill with the Skill tool, args: the changes in <base>...HEAD. If it changed code, run the tests covering the changed files, scoped, never the whole suite, with these environment variables set: <env>. Pass → commit with a one-line conventional message. Fail → `git restore .` (no proving tests exist yet). Reply only: one line per tidy-up `<file:line> — <what changed>`, then `commit <short sha>`, `reverted — <failing test>` or `no change`.
```

## Step 6 — code review, round 1

```
Invoke the built-in `code-review` skill with the Skill tool (never a plugin's `code-review:code-review`), args: high <base>...HEAD. If it reports it cannot use that target, invoke it again with args: high <current branch name>. Fix nothing. Reply only its findings, one per line: `<file:line> — <claim>`, or `none`.
```

## Step 7 — security review

```
Invoke the `security-review` skill with the Skill tool, limited to the changes in `git diff <base>...HEAD`, not the whole branch. Fix nothing. Reply with its findings only, one per line: `<file:line> — <claim>`, or `none`.
```

## Step 9 — fixer

```
Fix one proven bug. Its failing test becomes the regression test.
Bug: <claim> at <file:line>
Test: run only it: <command> in <dir>, with {filter} replaced by <filter>, with these environment variables set: <env>. It fails now.
1. Make that test pass with the smallest change to production code. Fix it where the behaviour is owned; never put one feature's text or rule into shared code to make the test pass. Change nothing else: not the test, no refactors, no comments, no other behaviour. Exception: an existing test that asserts exactly the behaviour your fix removes may change, only that assertion.
2. The same bug at more than one site: fix each, and add one regression test per extra site beside the proving test, in its style.
3. Run only those tests; they must pass. Do not commit. Never run git checkout, git restore, git stash or git clean: other proving tests are uncommitted in this tree; undo your own edits by editing the files.
4. Reply with one FIXED line per changed site, or one STUCK line; when you changed an existing assertion, also one UPDATED-TEST line:
   FIXED <file:line of the line that fixes it> — now: <that line's text> — pre-fix: <its exact text before your change; empty if you added the line> — test <kind> <filter> — name <test name>
   STUCK — <one line why> (first remove every line you added or changed, by editing)
   UPDATED-TEST <file:line> — <why>
```

## Step 12 — same bug nearby

```
Same bug shape as <claim>, fixed at <file:line>. Check these sites: <lines>. Where the bug exists, first add a failing test beside the existing tests (run it with <command> in <dir>, with these environment variables set: <env>), then the smallest fix; do not commit. Never run git checkout, git restore, git stash or git clean: other proving tests are uncommitted in this tree; undo your own edits by editing the files. Reply one line per site: `FIXED <file:line> — now: <text> — pre-fix: <text> — test <kind> <filter> — name <test name>` or `NOT A BUG <file:line> — <why>`.
```

## Step 14 — code review, round 2

```
Invoke the built-in `code-review` skill with the Skill tool (never a plugin's `code-review:code-review`), args: <the args from step 14>. Fix nothing. Reply only its findings, one per line: `<file:line> — <claim>`, or `none`.
```

## Step 19 — strengthen a test

```
This test still passes when line <n> of <file> becomes <pre-fix>. Strengthen only the test so it fails then and passes now; run it with <command> in <dir>, with these environment variables set: <env>; do not commit. Never run git checkout, git restore, git stash or git clean: other tests are uncommitted in this tree; undo your own edits by editing the files.
```
