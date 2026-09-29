# flytrap
LLM-powered PR code review — @flytrap on demand or as a PR check. Harness-agnostic review skill + findings schema.

## Using it

Add a `CLAUDE_CODE_OAUTH_TOKEN` secret to your repo, then copy this into
`.github/workflows/flytrap.yml`:

```yaml
name: Flytrap

on:
  issue_comment:
    types: [created]

permissions:
  contents: read
  issues: read # the Spec: the issues a pull request closes
  pull-requests: write

jobs:
  review:
    if: github.event.issue.pull_request && contains(github.event.comment.body, '@flytrap')
    runs-on: ubuntu-latest
    steps:
      - uses: oak-wildwood/flytrap@v1
        with:
          claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
```

A collaborator with write, maintain or admin permission then comments `@flytrap` on a pull request
and gets back one comment-only review: a Verdict and summary, then an inline comment on each
Finding, with a one-click suggested change where it has one. See
[`examples/flytrap.yml`](examples/flytrap.yml) for the same file with comments.

### Versions

`@v1` follows the latest 1.x release, so you get fixes and new features without breaking changes.
To pin one exact release instead, use its tag, for example `oak-wildwood/flytrap@v1.0.0`, or a
commit SHA. The action, the Rubric and the findings schema are versioned together, so any of these
gives you a consistent set. [Releases](https://github.com/oak-wildwood/flytrap/releases) lists
what changed.

### Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `claude_code_oauth_token` | One of this or `anthropic_api_key` | — | Claude Code OAuth token for the Claude Adapter |
| `anthropic_api_key` | One of this or `claude_code_oauth_token` | — | Anthropic API key for the Claude Adapter |
| `model` | No | `opus` | Model the Claude Adapter runs, unless a comment picks one (see below) |
| `github_token` | No | `${{ github.token }}` | Token Flytrap's own steps use to read the PR and post the Review |
| `exclude` | No | — | Extra glob patterns, one per line, dropped from the diff on top of the defaults |
| `max_diff_size` | No | `100000` | Characters of diff, after excludes, over which Flytrap posts a "too large" comment instead of reviewing |

Give exactly one of `claude_code_oauth_token` and `anthropic_api_key`. Setting neither or both
fails the job with a clear error before any model call.

### Choosing a model per comment

Add `use <name>` right after the mention to run that one Review on a different model:

```
@flytrap use sonnet5.5
```

`sonnet`, `opus`, `fable` and `haiku` mean the newest of each family Flytrap lists, and a version
such as `sonnet5.5` or `haiku 4.5` (or a full model ID) picks one exactly. Case, spaces and dashes
don't matter. The Review ends with the model that ran it.

Only listed models work (see [`src/model.js`](src/model.js)); anything else, such as
`@flytrap use gpt4`, gets a comment naming the ones that do, and no model call. See
[ADR 0005](docs/adr/0005-model-choice-is-an-allowlist.md) for why. Without `use <name>`, the `model`
input applies.

### Write-access and fork-PR behavior

Only a comment from a collaborator with `write`, `maintain` or `admin` permission on the repo
starts a Review; a comment from anyone else, or from a bot, is ignored before any checkout or
model call. This holds for fork pull requests too, where the run has the base repository's
secrets: the PR's head commit is checked out by SHA through the base repository, so a Review
runs without needing access to the fork, and nothing in the checkout is ever executed — the model
can only read files, with `Read`, `Glob` and `Grep`.

Lockfiles, build output, minified files, other generated paths and anything your default branch's
`.gitattributes` marks `linguist-generated` are dropped from the diff before review; the `exclude`
input adds your own patterns on top. Excluded files are still listed for the model, which reviews
any that look hand-written. A diff still over `max_diff_size`
characters (default 100000) gets a short "too large to review" comment instead of a model call.

## How it fits together

| Piece | Where | What it does |
| --- | --- | --- |
| Rubric | [`skills/flytrap-review/SKILL.md`](skills/flytrap-review/SKILL.md) | The review instructions, as a portable Agent Skill |
| Findings schema | [`schema/findings.schema.json`](schema/findings.schema.json) | What a Harness must hand back |
| `flytrap prepare` | [`src/prepare.js`](src/prepare.js) | Checks the commenter's permission, then gathers the diff and prompt |
| Claude Adapter | [`action.yml`](action.yml) | Runs `claude-code-action` with only `Read,Glob,Grep` and `--json-schema` |
| `flytrap post-review` | [`src/post-review.js`](src/post-review.js) | Checks for a permission denial, validates the Findings, and posts the review; `--plan` prints it instead |

The model never writes to GitHub; see [`docs/adr`](docs/adr) for why.

## Evaluating the Rubric

[`test/evals/fixtures`](test/evals/fixtures) holds a small, fixed eval set: three diffs with a
planted bug each (an off-by-one, a command injection, a missing null check) and one clean diff,
each with its expected Findings written down. Run **Flytrap Rubric eval** by hand from the Actions
tab ([`.github/workflows/flytrap-eval.yml`](.github/workflows/flytrap-eval.yml)) to put the set
through the real Claude Adapter; the report shows which planted bugs each diff's Review found or
missed, plus the clean diff's Verdict and Finding count. It costs usage on every run, so it never
runs on a pull request. It uses this repo's own fixtures and CLI, so it's for flytrap and its forks,
not something to copy into another repo.

## Releasing

Bump `version` in `package.json` on a PR and merge it, then run `scripts/release.sh X.Y.Z` from an
up-to-date `main`. It runs the tests, creates the immutable `vX.Y.Z` tag, moves the major tag
(`v1`) to it, and publishes a GitHub release. This repo's own review workflow stays on `@main`, so
Flytrap reviews its own PRs with the latest merged code.

## Developing

Plain Node 20+, no dependencies. `npm test` runs the `node:test` suite.

```sh
node bin/flytrap.js post-review --pr 1 --plan \
  --findings test/fixtures/findings-mix.json --diff test/fixtures/review.diff
```
