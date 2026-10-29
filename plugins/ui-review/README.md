# ui-review

Reviews screenshots of your app against your design tokens and UI rules. A critic agent looks at the pictures; a script checks every colour-contrast claim, so only real findings stay. Plain Node (>= 22), no dependencies.

It does not take screenshots itself. Give it `.png` files, or routes: then it calls `e2e:capture` from the `e2e` plugin, which boots the app and takes them. Install `e2e` too if you want routes.

## The pieces

| Piece | What it does |
|---|---|
| `review-ui` skill | Gets the screenshots, runs the critic, checks contrast, writes the report |
| `ui-critic` agent | Reads only the screenshots, the token table and the rule files, and lists visible defects |
| `tokens.mjs` | Lists the design tokens and computes contrast ratios |

## Use

```
/ui-review:review-ui /prices /checkout --focus mobile
/ui-review:review-ui shots/prices@390x844.png
```

You get a numbered list of findings, each with the screenshot, the rule or token it breaks and the likely source file. The same list is saved as `ui-review.md` next to the screenshots. Then it asks which findings to file as GitHub issues, and files only those. If `gh` fails, the issue texts go to `ui-review-issues.md` in the temp folder. Nothing is committed.

More than 6 screenshots: it tells you the token cost first and waits for a yes.

## Scripts

```
node scripts/tokens.mjs list
node scripts/tokens.mjs contrast <a> <b>
```

- `list`: one `name<TAB>value` per token. Comments are removed and aliases (`$a: $b`) are resolved. SCSS maps and mixins are skipped. JSON keys are joined with `.`.
- `contrast`: the WCAG ratio such as `4.54:1`. `<a>` and `<b>` are `#rgb`, `#rrggbb` or a token name whose value is hex.
- No `uiReview.tokens`: `ui-review: set uiReview.tokens`, exit 2.

## Config

`<project>/.claude/ai-dev-team.json`:

```json
{ "uiReview": { "tokens": ["src/styles/_tokens.scss"], "rules": ["docs/ui-rules.md"], "viewports": ["390x844", "1280x800"], "label": "ui" } }
```

- `tokens`: SCSS (`$name: value;`), CSS (`--name: value;`) or JSON files.
- `rules`: your UI rule documents.
- `viewports`: default `390x844` and `1280x800`. `label`: issue label, default `ui`.

## Install

```
/plugin marketplace add BarbaMatei/ai-dev-team
/plugin install ui-review@ai-dev-team
```
