# How each message looks

The owner reads these one at a time in a chat window, often as a non-programmer, and answers with a word. Everything here follows from that: plain sentences, one bug per message, a size budget, one question at the end and nothing to scroll past to find it. Code goes in fenced blocks, never in tables.

## Size budget

- The problem: two to four sentences, no file names.
- The chain: at most six steps, each a sentence a non-programmer can follow, its `file:line` trailing.
- The code: up to two files and about sixty lines of old plus new. Larger is a big change (below).
- A draft past about eighty lines before the code is research, not a message: cut it.

## Batch opening

```
**<n> bugs: <what they have in common, in plain words>**

<Two to four sentences for someone with no context: what a customer or the staff run into, and why these go together.>

1. #<n> <title in plain words> — <where it shows: on a page, in a server reply, only in a test, in the build, or a legal or provider rule>
2. …

**Settings:** <what fix-setup found, one line; each gap with what you will do instead>
**Writes outside this repo:** a comment on each of these issues at the end, new issues only when you say yes, one branch and one PR (you merge it).
**At the end:** a final review tidies the code on its own (the PR lists every tidy-up) and brings you each bug it proves, like these.

<The one question the batch needs first: "Is the app running at <address>, or shall I start it?" (browser or API bugs); "Can you save <document> and give me its path?" (an outside rule without its source); else the service the tests need.>
```

## Kinds

| Kind | You verify it by | Messages |
|---|---|---|
| Browser: seen on a page | a `browser:drive` run of the steps | A, B, then the re-check |
| API: seen in a server reply | sending the request | A, B, then the re-check |
| Test-only: no page or reply shows it yet | the proving test's failing output | one |
| Build or deploy | the failing build or check output; with an engine that answers on fix-setup's `containers` line, a local image build and run of the production setup, before and after the fix | one |
| Outside rule (law, provider contract, standard) | the rule's source, linked | one; no source → no fix: leave it open, saying what is missing |

A bug that shows as something not happening (a retry that never runs, a missing log line) is an API bug seen in the server log (field-guide.md "Reproducing").

Pick the kind by where a person can see the bug today. A bug hidden behind another bug is test-only until that one is fixed; say so in the batch opening.

## Message A: "Did you see it?" (browser and API bugs)

```
**#<n> — <title in plain words>**

<Two to four sentences: what goes wrong, for whom, what they see instead.>

**How it happens**
1. <A person or the system does something> — `path:line`
2. <What happens to the value next> — `path:line`
3. <The wrong result, and who sees it> — `path:line`

**See it yourself** (<"checked with browser:drive: " and what the log showed, one line; or "not verified: " and why>)
1. Open <address> (and sign in as <test account> when the bug needs it).
2. <…>
3. You see <the wrong thing>.

Did you see it?
```

## Message B: "Approve?" (after the yes)

````
**#<n> — the fix**

**After the fix:** <what the same person sees instead; what deliberately stays the same>
**Also covered:** <the failure modes that apply and how: errors that come and go, duplicates or double clicks, cleanup and leaks, local versus cloud or other environment differences; or "none apply">
**Promise:** <the promise in the user's words>; this fix covers <the paths>; it leaves <the paths, or "none">.

**The change** — <n> file(s)
`path/file:lines`
Old:
```<lang>
…
```
New:
```<lang>
…
```

**Test:** `<test name>` in `<file>` stays: every fix keeps the test that proved the bug, and a check confirms the test fails when the fix is taken out. The bug got through because <the gap, for example "the old tests called the handler directly, never the route">.
**Check afterwards:** <the same steps and what the screen shows now; a restart the fix needs>

Approve?
````

## One message (test-only, build, outside rule)

The problem and the chain as in message A, then the evidence in place of the steps, then everything from "After the fix" on, as in message B:

````
**The failing test** — `<test name>`
```
<the failing assertion: expected and actual, a few lines>
```
````

## Re-check (after the commit)

```
**#<n> fixed** (<short commit>). <A restart it needs, if any.> Same steps as before; now you see <the right thing>.

Does it work now?
```

## Closures

```
**#<n> — <title>**

<What the issue says, one sentence.>
**What I found:** <not a defect / already fixed in <commit> / duplicate of #<m> / obsolete since <change>>, because <the evidence: a file:line, a test run, a drive log line>.
**Proposal:** close #<n>. <Optional: a one-line hardening, marked optional.>

Close it?
```

## Big change: the choice first

A genuine fork: the message stops after "After the fix" and shows the options instead of the code. More than two files without a fork: no options; say so in one line and show the code file by file (phases when it passes the size budget), one approval per phase.

Before listing options, ask whether the data model or the feature itself is the cause (a reason kept in free text, a rarely used feature that creates a race); if so, that root-cause fix is option (a), beside the symptom fix. Two bugs that share a mechanism: the shared helper is shown first, then each call site.

```
**Two ways to fix it**
(a) <what it does> — touches `file-one` (<what changes>), `file-two` (<what changes>)
(b) <what it does> — touches `file-three` (<what changes>)
I'd take (a), because <one clause>.

(a) or (b)?
```

After the pick, the next message shows the old and new code, file by file. More than about four files → phases, one approval each, behaviour changes apart from refactors; say the number of phases up front, counted only after reading every file the chosen option touches.

Offer options only for genuine decisions: a product or UX choice, scope beyond the batch, two designs with different costs. Two unanswered questions are not a fork: go and answer them. In a security-relevant area (sign-in, payments, uploads, personal data) add one line per option naming the governing rules (for example OWASP ASVS, the relevant RFC): which it meets, what stays unmet and where that goes (an issue, a later batch). "I don't want this" ends that option, without argument. A choice on security, privacy, licences, money or a third-party service opens with one line: what is common practice, with its source (a standard, the provider's documentation, how mainstream sites do it). An option that adds a step users see gets two more lines: what the user sees, and whether mainstream sites show that step; when they do not, the textbook option is the alternative, not the recommendation.

## Writing

- Each chain step is a sentence first and a citation second: "the address form sends nothing when the street is empty — `address-form.ts:42`", not "`address-form.ts:42` returns early".
- Show the code you will actually apply, every file; never "and the same in the other two".
- Code blocks are verbatim excerpts of the file as it is or will be: real line breaks, no notes inside the code. Check a helper's code against the file before pasting it.
- Texts that site users or the owner see, and log events, describe the problem in plain words; they never name configuration keys or their values (keys go stale when a setting changes; the deployment docs name them). A fix that adds or changes such a text follows this rule.
- No padding: no hedges, no restated context, no "one thing you should know" paragraph standing in for a link you did not trace.
