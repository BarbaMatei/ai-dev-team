---
name: review-ui
description: Use when asked to review how screens look, or before merging a UI change. Takes screenshots (or boots the app and captures routes), has a critic agent compare them with the design tokens and UI rules, checks every contrast claim with a script, and writes a report. Args - <route or .png>... [--focus <topic>].
---

# Review UI

You review how screens look and report what is visibly wrong. You change no project files and commit nothing.

- **Args:** `<route or .png>...` (`/prices`, a full `http(s)://` address, or a screenshot path) and optional `--focus <topic>`.
- **Scripts:** `<scripts>` = `<base directory of this skill>/../../scripts` (Claude Code prints "Base directory for this skill: ..." when this skill loads). Run them from the project root.
- **Temp files:** `<tmp>` = the session's scratchpad directory if Claude Code lists one, else the OS temp folder (`node -e "console.log(require('os').tmpdir())"`); never inside `.git` or the working tree.
- **Config:** `uiReview` in `<project>/.claude/ai-dev-team.json`: `tokens` (token files, required), `rules` (UI rule docs), `viewports` (default `["390x844","1280x800"]`), `label` (issue label, default `ui`).

## Steps

1. Screenshots. `.png` paths: use them. Routes: invoke `e2e:capture` with the Skill tool, with the routes and `--viewports <uiReview.viewports, comma-joined>`; its reply is a folder path, then file names. Neither possible (no `e2e:capture` skill, no `.png`): ask for screenshot paths and stop.
2. More than 6 screenshots: announce "≈ <n × 3>k tokens, go?" and wait for an explicit yes. Anything else ends the review here.
3. `node "<scripts>/tokens.mjs" list > "<tmp>/ui-tokens.txt"`. Exit 2: show its line and stop.
4. Dispatch one `ui-critic` agent (Agent tool, `subagent_type: ui-review:ui-critic`) with the screenshot full paths, `<tmp>/ui-tokens.txt`, the `uiReview.rules` files and the focus. Keep its lines.
5. Check its output:
   1. Every finding that names two colours: `node "<scripts>/tokens.mjs" contrast <a> <b>`. Drop the finding when the ratio is 4.5 or more, or 3 or more when the line says `large text`. Exit 2 (a colour that is not hex): keep the finding.
   2. Every `capture` line, when the screenshots came from routes: its file name starts with the route's slug (`/` is `root`, `/a/b?x` is `a-b`, lowercase). Run `e2e:capture` once more with only those routes, the same `--viewports` and `--wait 10000`, then run the critic again on just the new files. Still failing: report it as a `capture` line. When the input was `.png` files: report the `capture` lines as they are, no recapture.
   3. Count the dropped findings.
6. Per finding, find the source file as best you can: the route's component from the project's router (Grep). Unsure: write `source: unknown`.
7. Write `ui-review.md` in the screenshots' folder: the screenshots reviewed, the findings numbered with screenshot, rule or token and source file, and the dropped count.
8. Reply with the numbered findings. Then ask once which to file as GitHub issues and wait for the answer. For each one picked:
   1. Write its body to `<tmp>/ui-issue-<n>.md`: the finding, the screenshot file name, the rule or token, the source file.
   2. `gh issue create --label <uiReview.label ?? ui> --title "<finding, under 70 characters>" --body-file <that path>`.
9. `gh` missing or failing (for example the label does not exist): append each would-be body to `<tmp>/ui-review-issues.md` and name its full path in the reply.

## Reply

At most 10 lines: the report's full path, the numbered findings (`n. <severity> <file> — <what>`), the dropped count, and the question about issues. After the answer, add the issue numbers or the fallback file path.
