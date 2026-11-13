---
name: fix-findings
description: Use when the owner wants to fix proven bugs together with you, one at a time, in a web project - a batch of bug issues, or the PROVEN lines prove-findings left in this conversation. Args - <issue number>... (none - the PROVEN lines in this conversation).
---

# Fix findings

You fix proven bugs with the owner, one at a time. The owner decides; your job is to make each decision cheap and each claim checkable. A finding is a hypothesis until you have walked its chain in the code: about one in three narrows or turns out not to be a defect, and closing one with evidence is as good an outcome as a fix.

- **Input:** issue numbers (`gh issue view <n> --json title,body,labels,comments`), or the PROVEN lines in this conversation.
- **Scripts:** `<scripts>` = `<base directory of this skill>/../../scripts` (Claude Code prints "Base directory for this skill: ..." when this skill loads). Run them from the project root.
- **Read once per session**, beside this file: `presentation.md` (the shape of every message) and `field-guide.md` (walking the chain, reproducing, data, reading the owner, scope).
- **Tests:** `tests` in `<project>/.claude/ai-dev-team.json`, with each kind's `env` pairs set for every run (`.claude/ai-dev-team.local.json` overrides them); always scoped to one test or the touched files, never the whole suite.
- **Record file:** `<tmp>/fix-findings-record-<branch with / replaced by ->.md` (`<tmp>` = the session's scratchpad directory, else the OS temp folder): append every owner decision, test-data change (with its old value), mutate-check verdict and bug outcome as it happens; after a context summary, read it before the next message.
- **Helpers** (subagents that trace, prove or draft) never run `git checkout`, `git restore`, `git stash` or `git clean`, and return code exactly as it will be in the file: real line breaks, no notes inside the code.

## Rules that never bend

1. One bug per message, and one question, at its end. The owner reads in a chat window and answers with a word.
2. Nothing is edited before the owner's word on this bug. Approval of one bug never approves the next; silence approves nothing.
3. No batch fixing: every change gets its own message and its own word. Only issues that one and the same change fixes are presented as one bug, and the message says so.
4. Never hand over steps you have not run yourself; when you cannot run them, say "not verified" and why.
5. Test data only on test accounts. Never change real users' records; never improvise infrastructure (mail servers, stand-in services).
6. A bug no test can make fail is fixed or closed only on the owner's yes. Never merge.

## Setup, once per batch

1. `git status`, `git log -1`, the branch. On the default branch → a batch branch `fix/<short-name>` (in a worktree if other sessions share this checkout).
2. `node "<scripts>/fix-setup.mjs"` → eleven lines `<key><TAB><value>`; on a `missing`, `default` or not-ready line the third column says what to do instead. Keep them for the whole batch, and run it again whenever the conversation resumes after a break or a context summary, before the next test or drive run: a `containers` or `services` value that changed → fix it or tell the owner first.
3. Read every issue and its comments. Already fixed on the default branch, a duplicate or obsolete → it becomes a closure (presentation.md), presented in its turn like a fix.
4. Order the bugs: bugs sharing files next to each other (still one approval and one commit each), then by seriousness. Two bugs that need the same mechanism: present the shared part first (its own approval), then each call site.
5. Send the batch opening (presentation.md): what the bugs have in common, in plain words; the settings and their gaps; the writes outside this repo; what runs on its own at the end; and the one question the batch needs first: browser or API bugs → is the app running, or shall you start it (`browser:app up`)?; outside-rule bugs without their source → can the owner save it and give its path?; else the service the tests need (a `services` value that is not ready).

## Per bug

1. **Kind:** seen in the browser, seen in an API reply, only a test shows it, build or deploy, or an outside rule (presentation.md "Kinds").
2. **Walk the chain** (field-guide.md): from an entry point to the wrong output, a `file:line` at every step, every production caller named (the `callers` line). Outcome: stands, narrowed, or not a defect. Then name the promise the bug breaks, in the user's words (for example "a customer who has paid is never told the order is unpaid"), and list every path in the touched code that breaks the same promise; more than the reported path is a fork (the choice first). Money, fiscal or send-once flows (a payment, a filing, a message that must go out exactly once): before the first fix message, offer a read-only map of every path that can repeat or lose the action (one fresh subagent).
3. **Verify it** as its kind says: browser → run the steps with `browser:drive` and read its console and network lines; API → send the request; the rest → run the proving test and keep its failing output. An issue's description of a screen is a hypothesis until you have seen it. Place a bug's proving test only when you present that bug, so its commit holds only its own test.
4. **Present** (presentation.md). Browser or API bug: first the problem and the steps, ending "Did you see it?"; after the yes, the fix, ending "Approve?". Other kinds: one message ending "Approve?". A genuine fork: the choice first, the code after; more than two files without one: the code file by file (presentation.md "Big change").
5. **Stop.** Read the reply with field-guide.md "Reading the owner".
6. **Edit exactly what was shown**, test-first: the issue's proving test is the regression test (none yet → write it and watch it fail first). Run it, then the scoped tests of every touched file. An existing assertion that goes red is collateral damage: show it, why it no longer holds and what it should assert instead, and wait. An app part that locks the build output: field-guide.md "Data and environment" first.
7. **mutate-check** the fix line: write the whole pre-fix line to `<tmp>/pre-fix-<n>.txt` with the Write tool, then `node "<scripts>/mutate-check.mjs" --file <file> --line <n> --replace-file <tmp>/pre-fix-<n>.txt --kind <kind> --test "<filter>"` (empty pre-fix → no `--replace-file`). `<filter>` is the bare value the kind's `command` puts in place of `{filter}` (a test class or name, a spec file prefix), never a full runner expression; add `--test-name "<test name>"` when the kind has `nameArg` and the file holds other failing tests. The verdict is the last line. `NOT GUARDED` → strengthen only the test, once; still not → say so in the next message.
8. **Commit** that bug alone, with the project's commit rules (for example `fix(<area>): <one sentence>`).
9. **Browser or API bug:** once the app runs the fix (a restart it needs: ask the owner, or `browser:app` if you started the app), run the steps again with `browser:drive`, then send the re-check (presentation.md) and wait for "it works". "It still doesn't" → field-guide.md "Reading the owner".
10. One tally line ("3 of 7 settled"); keep the outcome for the PR body: fixed (commit), closed (why) or left open (why).

Along the way: a defect you find is named in one line and filed as an issue only on the owner's yes, never touched unless the owner says to fix it now (field-guide.md "Scope"); a feature request follows field-guide.md "Scope".

## Close

1. One message on what comes next: a final review tidies the code on its own (the PR lists every tidy-up) and, unless the owner picks the tidy-up only, runs a code review that brings each bug it proves to the owner like these, one at a time, and asks before filing any issue. End it with "Full review, or the tidy-up only?". Then invoke `review:review-bolt` with args `--base <default branch> --ask`, plus `--no-review` for the tidy-up only. Its reply is an intermediate result: continue with step 2.
2. Put one outcome line per bug at the top of the PR body file review-bolt names in its reply, and one `Closes #<n>` line per fixed or closed issue, each on its own line (review-bolt's pr-body.md rule: no closing word right before a number that stays open), then `gh pr edit --body-file <that file>`; `gh pr view --json closingIssuesReferences` must list exactly the fixed and closed issues.
3. Comment on each batch issue in plain words: what was wrong, what changed or why it closes, the PR link.
4. If you started the app at setup, `browser:app down`.
5. Reply: the PR link, the tally, the "Needs owner" items. Never merge.

## Red flags: stop and go back

| The thought | What it hides |
|---|---|
| "They share a file, I'll fix both now" | Two decisions taken as one. One after the other, one word each. |
| "The owner approved the last one, this one is the same" | Approval never carries over. Ask. |
| "The steps are obvious, no need to run them" | Issues describe screens their authors never saw. Run them, or say "not verified". |
| "I'll tidy this nearby code while I'm here" | An unshown edit. Name it; it goes to review-bolt or an issue. |
| "I'll give two options and let the owner choose" | Often unfinished research. Answer it; offer options only for a genuine fork. |
| "A small stand-in mail server will do" | Improvised infrastructure. Say what is missing and rely on the tests. |

## Self-check before every presentation

- The chain is plain sentences, at most six, with a location at the end of each, from an entry point to the wrong output.
- Every production caller of what you would change is named.
- The steps were run (a drive log, an API reply or a test's output), or the message says "not verified" and why.
- A fix message has its "Promise" line (paths covered and left), its "Also covered" line (failure modes) and its "Test" line (why the test exists).
- The code fits the budget, or the message stops at the choice.
- Exactly one question, at the end. Nothing has been edited.
