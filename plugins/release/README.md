# release

Works out each package's next version from conventional commits, updates its version file and changelog, makes one `chore(release)` commit and one annotated tag per release, and (with the action) pushes them and creates the GitHub releases. Packages release separately, so a commit counts only for the packages whose folder it touches.

`node scripts/release.mjs` prints the plan and writes nothing; add `--write` to release. The `release:preview` skill runs the dry run.

## Config

`release` in `<project>/.claude/ai-dev-team.json`:

```json
{ "release": { "packages": ["plugins/*"], "versionFile": ".claude-plugin/plugin.json", "tag": "{name}-v{version}", "patch": "any" } }
```

Defaults: `packages` `["."]`, `tag` `"v{version}"`, `patch` `["fix","perf"]` (or `"any"`), `initial` `"0.1.0"`. Also `changelog` (file name per package). The action commits as `github-actions[bot]`.

## Bump rules

- A breaking change (`!` or a `BREAKING CHANGE:` line) bumps major, or minor while the version is below 1.0.
- `feat` bumps minor.
- Types listed in `patch`, or any type when `patch` is `"any"`, bump patch.
- Merge commits, `chore(release)` commits and non-conventional subjects never count.

## Workflow

```yaml
on:
  push:
    branches: [main]
concurrency:
  group: release
  cancel-in-progress: false
permissions:
  contents: write
jobs:
  release:
    if: ${{ !startsWith(github.event.head_commit.message, 'chore(release)') }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: main
          fetch-depth: 0
          ssh-key: ${{ secrets.RELEASE_DEPLOY_KEY }}
      - uses: BarbaMatei/ai-dev-team/plugins/release@release-v<version>
```

Use the latest `release-v...` tag of this repository for `<version>`.

## Good to know

- The checkout needs the full history and tags, or every package looks like a first release.
- A protected branch needs a key that may bypass the protection; the built-in token cannot push to it.
- Pushes made with the built-in token do not start other workflows; pushes made with a deploy key do, so skip the `chore(release)` commits as above.
- For a project with one version, semantic-release is the usual choice; this plugin is for repositories that release several packages separately.
