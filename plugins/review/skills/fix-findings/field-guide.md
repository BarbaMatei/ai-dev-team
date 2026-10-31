# Field guide

## Walking the chain

A chain is a numbered sequence from something a person or the system does to the wrong output, with a location at every step:

1. **Entry point:** a click on a named button, a form submit, a request, a scheduled job, an incoming webhook. A finding deep in the server starts three or four layers above it.
2. **Each transformation:** form state → request body → route → validation → service → data access → database, and back: reply → client state → what is rendered. Each layer can change a value's meaning; the defect usually lives in one of them.
3. **The wrong output**, and who sees it.

Where to look, by layer:

- **Page → request:** disabled fields left out of the submitted value, defaults that hide an empty value, a handler on the wrong event, a request never sent (the network log shows it).
- **Request → server:** a field declared but never mapped, validation that rejects or silently drops, a check that runs on one route and not on its sibling.
- **Server → data:** "missing" versus "empty" (null, undefined, ''), merges that skip missing values, transactions, events sent before the commit, limits that differ between databases.
- **Error → screen:** which handler catches which error, and what the user is shown.
- **Who calls this:** the `callers` command from fix-setup with the symbol; by default the LSP tool's call hierarchy, then Grep. Count the production callers and say which show the bug.
- **Was it always so:** `git log -S<symbol> --oneline`; the file on the default branch.

Self-test before presenting: can you say who sends it, how it gets there, where it is lost, and why the existing mechanism does not already do the job, without another tool call? If not, keep reading code.

Three outcomes, all normal. **Stands:** present the fix. **Narrowed:** real but smaller or elsewhere; present it at its true scope and say what moved. **Not a defect:** present the closure with the evidence and wait for the word, as for a fix. When a fix "does not seem right" and you are adding a second guard beside an existing one, look for the rule the existing check approximates: replacing a proxy with the exact comparison often deletes code.

## Reproducing

- **Browser:** write a steps file and run it with `browser:drive` (its skill lists the actions). Take selectors from the page's code, never from guesses; a step that fails on a selector is the steps file's fault: fix it and run again. Wait with `wait` or `until`, never `sleep`, except for animations. Read the `console`, `exception`, `failed` and `api` lines: they often show the real symptom (a request never sent, a server error, a script error) where the issue described a screen. The log shows a reply's status, not its body: to quote the body, send that request yourself (next line).
- **API:** send the request (curl, or `node -e "fetch(…)"`) with a test account's credentials; show the status and the wrong part of the reply.
- **Test-only, build:** run the proving test or the build command, scoped; quote the failing lines.
- **Out of the runner's reach** (a payment provider's page framed from another site, drag and drop): the Playwright MCP tools if installed, else the steps marked "not verified" with the reason.
- **No app address** (`app` missing): ask the owner once; until then browser bugs are verified by tests only, and you say so.

## Data and environment

- **Records:** the `dataQuery` command (read-only) finds a record that shows the bug; give the owner its identifier. Missing → ask the owner for the record.
- **Accounts:** the `accounts` line names the test accounts. Never use or change a real customer's account.
- **Links and tokens** (email confirmation, password reset): seed a known token on a test account, stored the way the app stores it (often a hash), tell the owner, and verify on a second test account so the owner's own link stays unused.
- **A log you cannot see:** when the owner's console holds the server log, start your own copy with the `apiCopy` command on a spare port, log to a file, reproduce through it, then stop it. Ask the owner for the line only when that is impossible.
- **Email, payment sandboxes or another outside service missing:** say so before presenting the bug and rely on the tests for that path. Never build a stand-in.
- **Scale or rare data** ("what does this look like with 1,000 items?"): fake the API replies in `browser:drive` (`fake` in the steps file); give numbers (lines, screens, requests) and a screenshot; never change real data. If it raises a product question, recommend a proposal issue and keep the fix scoped.

## Reading the owner

| They say | It means | It does not mean |
|---|---|---|
| "yes", "approved", "go", "b)" | approval of the change just shown | approval of the next one |
| "next" | present the next bug; this one stays open | approval of anything pending |
| "I don't want this" | drop that option now | a request to argue for it |
| "continue" in the middle of an answer | finish the answer | start the next bug |
| "can I see it myself?" | steps and a test account, or "cannot be reproduced" plainly | a paraphrase of the issue |
| "no, I didn't see it" | re-derive: data, environment, or a wrong chain | permission to fix anyway |
| "it still doesn't work" (re-check) | re-run the steps with `browser:drive`, re-derive, then present the new change and ask "Approve?" again | permission to edit again without showing it |
| silence | nothing happens | permission |

**Pushback:** re-derive from the source; do not defend. When they are right, one line, "You're right: <evidence>", then the corrected message. Two rounds on one bug without approval means the framing is wrong: dispatch a fresh general-purpose subagent with the issue, the code and the question "can this be fixed, and how, as a complete file list", without mentioning your proposal; verify its claims, then show both views.

**"Does this need a test?":** two facts, the rule that requires it and the gap that let the bug through; offer a lighter test that covers the whole class of bug; do not argue further.

**"What is the right rule here?":** name the rule and its source, mark which option meets it and what stays unmet.

## Scope

- **Defects found along the way:** one line naming it and a proposal to file it as an issue (bug label, area, how serious, how to see it); file it only on the yes; never fix it in this batch.
- **Feature requests** in the middle of a bug: search the issues (all states, including the proposal and UI labels) and the specs' out-of-scope lines; say in one line whether it is already logged; recommend a proposal issue; continue the batch.
- **"Fix both, I know it's out of scope":** a phased plan, one approval per phase.
