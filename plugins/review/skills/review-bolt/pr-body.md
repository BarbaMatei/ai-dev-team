## Summary

<two to four plain sentences a non-developer can follow: what changed and why>

## Spec

<link or path to the spec, story or issue this branch implements (from the branch name, commit messages or changed spec files), or "None found.">

## Requirements → tests

| Requirement | Test | mutate-check |
|---|---|---|
| <one acceptance criterion, in plain words> | <test name and file; no test → "none" and an item under Needs owner> | <verdict from the Test stage; not run → "-"> |

## Review

Rounds: <1|2> · proven: <n> · discarded: <n> · unverified: <n>

| Finding | Fix | Regression test | mutate-check |
|---|---|---|---|
| <file:line — claim> | <file:line — the fix in a few words; not fixed → "Not fixed, see Needs owner"> | <test name and file> | <GUARDED, NOT GUARDED, the INVALID line, or not mutate-checkable> |

<no fixes → "No proven findings." instead of the table>

Tests changed by fixes: <each `UPDATED-TEST` line; none → "None.">

<Rounds = 2 only: "Round-2 fixes are covered by their proving tests and are not re-reviewed.">

## Same bug elsewhere (not fixed here)

- <file:line — claim — issue #n, or "to file" with --no-pr; none → "None.">

## Past decisions

- <finding → decision heading (link); none → "None matched.">

## CI parity

<only CI checks that already ran on this branch, with their results; none → "Not run." Never run anything to fill this section.>

## Screenshots

<screenshots of each changed screen; UI changed but none taken → "Needed" plus an item under Needs owner; no UI change → "No UI change.">

## Risks

- <what could still go wrong, in plain words; no risks and no `BY-DESIGN` items → "None known.">
- <each `BY-DESIGN` item: file:line — claim; the spec or plan asks for it>

## Needs owner

- <question or open item> — default: <what the agent would do>

<nothing open → "Nothing." instead of the list>
