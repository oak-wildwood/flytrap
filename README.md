# nuthatch
LLM-powered PR code review — @nuthatch on demand or as a PR check. Harness-agnostic review skill + findings schema.

## Using it

Copy [`examples/nuthatch.yml`](examples/nuthatch.yml) into `.github/workflows/` and add a
`CLAUDE_CODE_OAUTH_TOKEN` secret. A collaborator with write, maintain or admin permission then
comments `@nuthatch` on a pull request and gets back one comment with a Verdict, a summary and the
Findings. Comments from anyone else are ignored before any checkout or model call.

## How it fits together

| Piece | Where | What it does |
| --- | --- | --- |
| Rubric | [`skills/nuthatch-review/SKILL.md`](skills/nuthatch-review/SKILL.md) | The review instructions, as a portable Agent Skill |
| Findings schema | [`schema/findings.schema.json`](schema/findings.schema.json) | What a Harness must hand back |
| `nuthatch prepare` | [`src/prepare.js`](src/prepare.js) | Checks the commenter's permission, then gathers the diff and prompt |
| Claude Adapter | [`action.yml`](action.yml) | Runs `claude-code-action` with only `Read,Glob,Grep` and `--json-schema` |
| `nuthatch post-review` | [`src/post-review.js`](src/post-review.js) | Validates the Findings and posts the comment; `--plan` prints it instead |

The model never writes to GitHub; see [`docs/adr`](docs/adr) for why.

## Developing

Plain Node 20+, no dependencies. `npm test` runs the `node:test` suite.

```sh
node bin/nuthatch.js post-review --pr 1 --plan --findings test/fixtures/findings-request-changes.json
```
