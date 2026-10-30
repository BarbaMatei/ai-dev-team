# review

Proven code review for Claude Code: a review finding counts only when a failing test proves it, and every fix keeps that test as its regression test. Plain Node (>= 22), no dependencies. Config lives in `<project>/.claude/ai-dev-team.json`; every key is optional.

## The pieces

| Piece | What it does | Config keys it reads |
|---|---|---|
| `review-bolt` skill | When a branch's code is done: simplify, at most two proven review rounds, fixes, mutate-check, the PR body | `tests`, `triggers`, `areas`, `rulesDir`, `decisions`, `bugs` |
| `sweep-area` skill | Owner-started bug sweep of one area of the default branch; files proven bugs as issues | `areas`, `rulesDir`, `tests`, `bugs` |
| `prove-findings` skill | Keeps only findings a fresh subagent's failing test proves | `tests`, `areas`, `rulesDir` |
| `design-critic` agent | One adversarial pass over a design before coding a trigger-area change | `rulesDir` |
| `areas.mjs` | Touched areas and trigger, files of an area, areas of a file, the same bug shape nearby | `rulesDir`, `areas`, `triggers` |
| `decisions.mjs` | Matches a finding to past owner decisions | `decisions` |
| `mutate-check.mjs` | Breaks one line, requires the test to fail, restores the file | `tests` |

A bolt is one unit of work on its own branch, reviewed as one PR. An area is a rule file in `rulesDir` (default `.claude/rules`) with its `paths:` globs, plus each `areas` entry; in `areas`, a glob starting with `!` excludes the files it matches, and an exclusion in a config area merged into a rule area applies to that rule area too.

```json
{
  "tests": { "unit": { "command": "dotnet test App.Tests --filter \"FullyQualifiedName~{filter}\"", "cwd": "src", "buildError": "error CS\\d{4}|Build FAILED" } },
  "areas": { "web": ["src/app/**"] },
  "triggers": ["payments", "auth"],
  "decisions": "docs/decisions.md",
  "bugs": { "label": "bug" }
}
```

## How a change flows

1. Before coding a change in a trigger area, `design-critic` attacks its technical design.
2. Code test-first until the branch's tests pass; then `review-bolt` runs `simplify`.
3. Round 1: `code-review high` on the whole diff (plus `security-review` on trigger areas) → `prove-findings` → fix each proven bug; the same bug nearby is fixed too, elsewhere it becomes an issue.
4. Round 2, only if round 1 changed code: `code-review medium` on the fix lines → prove → fix. No round 3: the rest goes under "Needs owner".
5. `mutate-check` each regression test, attach past decisions, write the PR body; the owner reviews and merges.

The PR body is written to `review-bolt-pr-<branch>.md` in the session's scratchpad (else the OS temp folder), never inside `.git` or the working tree: Claude Code asks permission for files in `.git`, which stalls a headless run. `--no-pr` stops there.

## Scripts

```
node scripts/areas.mjs touched [--base <ref>] | files <area> | of <file>... | nearby --pattern <regex> [--max <n>] [--base <ref>]
node scripts/decisions.mjs --path <file> --text "<finding>"
node scripts/mutate-check.mjs --file <path> --line <n> [--replace <text>] --kind <tests key> --test <filter>
```

`of` prints `<file><TAB><area>,<area>` (`-` when none); `nearby --max <n>` prints nothing and exits 3 above `<n>` sites, so a too-broad pattern is narrowed. A claim that is what the spec asks for becomes `by-design` in prove-findings and lands under Risks. For compiled languages set `tests.<kind>.buildError` (a regex of your compiler's error lines): without it a mutant that fails to compile reads as `GUARDED`, and mutate-check adds a `note:` line saying so.

review-bolt and sweep-area file proven bugs (with repro and the proving test) as GitHub issues; on a public repo those issues are public, so use a private repo, or a label your private tracker picks up, if that matters.

mutate-check prints `GUARDED` (exit 0), or `NOT GUARDED` / `INVALID: <reason>` (exit 1), and always restores the file. Bad arguments or invalid config: one line on stderr, exit 2.

## Does `/code-review` see `.claude/rules`?

Not reliably (Claude Code 2.1.292, tested 2026-10-28). A path-scoped rule attaches only when the reviewer uses the Read tool on a matching file, and reviewers often read through `git diff` instead. When a rule does attach, the reviewer treats it as untrusted tool output and ignores it.

How it was tested: a canary rule on one source file, a one-line change to that file, three headless `/code-review` runs. Low effort: no rule finding (it read only the diff). Medium, rule committed on the branch: found, but only because the rule file showed up in the diff and the reviewer opened it. Medium control, rule invisible to git: the rule attached when the reviewer read the file, but the reviewer said the user had not written it and ignored it.

What the plugin does: `prove-findings` starts with a Rule checklist. A cheap subagent reads the touched areas' rule files and checks every added line against them, so bug-class rules count whether or not the reviewer saw them. Re-test after a Claude Code upgrade before dropping it.
