# The model never writes to GitHub

The model reads the repository and returns Findings as schema-validated JSON (`structured_output`
from `claude-code-action` with `--json-schema`), and nothing else. Every write, including the review,
inline comments, collapsing earlier reviews and check status, happens in shell steps that hold the
token.

The diff being reviewed is untrusted input: a PR can contain text written to steer the model. With
no write tools, the worst a hostile diff can do is produce a bad review. Posting is also
deterministic (placing a Finding in or out of a diff hunk, deduplicating against earlier runs), so
it belongs in tested code rather than in a prompt. A run that produces no JSON, or has any
permission denial, fails the job instead of passing silently.

**Considered:** letting the model post with `gh pr comment` or the GitHub MCP tools. It's simpler,
but it lets the PR author influence what gets written, and a run that gives up still shows green.
