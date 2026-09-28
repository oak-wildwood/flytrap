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
  pull-requests: write

jobs:
  review:
    if: github.event.issue.pull_request && contains(github.event.comment.body, '@flytrap')
    runs-on: ubuntu-latest
    steps:
      - uses: oak-wildwood/flytrap@main
        with:
          claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
```

A collaborator with write, maintain or admin permission then comments `@flytrap` on a pull request
and gets back one comment with a Verdict, a summary and the Findings. See
[`examples/flytrap.yml`](examples/flytrap.yml) for the same file with comments.

### Inputs

| Input | Required | Default | Description |
| --- | --- | --- | --- |
| `claude_code_oauth_token` | One of this or `anthropic_api_key` | — | Claude Code OAuth token for the Claude Adapter |
| `anthropic_api_key` | One of this or `claude_code_oauth_token` | — | Anthropic API key for the Claude Adapter |
| `model` | No | `opus` | Model the Claude Adapter runs |
| `github_token` | No | `${{ github.token }}` | Token Flytrap's own steps use to read the PR and post the Review |

Give exactly one of `claude_code_oauth_token` and `anthropic_api_key`. Setting neither or both
fails the job with a clear error before any model call.

### Write-access and fork-PR behavior

Only a comment from a collaborator with `write`, `maintain` or `admin` permission on the repo
starts a Review; a comment from anyone else, or from a bot, is ignored before any checkout or
model call. This holds for fork pull requests too, where the run has the base repository's
secrets: the PR head is checked out through the base repository (`refs/pull/N/head`), so a Review
runs without needing access to the fork, and nothing in the checkout is ever executed — the model
can only read files, with `Read`, `Glob` and `Grep`.

## How it fits together

| Piece | Where | What it does |
| --- | --- | --- |
| Rubric | [`skills/flytrap-review/SKILL.md`](skills/flytrap-review/SKILL.md) | The review instructions, as a portable Agent Skill |
| Findings schema | [`schema/findings.schema.json`](schema/findings.schema.json) | What a Harness must hand back |
| `flytrap prepare` | [`src/prepare.js`](src/prepare.js) | Checks the commenter's permission, then gathers the diff and prompt |
| Claude Adapter | [`action.yml`](action.yml) | Runs `claude-code-action` with only `Read,Glob,Grep` and `--json-schema` |
| `flytrap post-review` | [`src/post-review.js`](src/post-review.js) | Validates the Findings and posts the comment; `--plan` prints it instead |

The model never writes to GitHub; see [`docs/adr`](docs/adr) for why.

## Developing

Plain Node 20+, no dependencies. `npm test` runs the `node:test` suite.

```sh
node bin/flytrap.js post-review --pr 1 --plan --findings test/fixtures/findings-request-changes.json
```
