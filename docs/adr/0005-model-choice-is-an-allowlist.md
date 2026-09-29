# A comment can pick the model, but only from a list

`@flytrap use sonnet5.5` runs that Review on Sonnet 5.5 instead of the workflow's default. The name
is matched against the list in `src/model.js`, and what reaches the Adapter is the model ID from the
list, never the commenter's text. A name that isn't listed stops the run with a comment naming the
ones that are, and makes no model call.

The comment is untrusted text, and the model name is interpolated into `claude-code-action`'s
`claude_args`. Passing it through would let a commenter add CLI flags such as `--allowedTools`,
which would undo ADR 0003. It would also let a commenter pick any model, including an expensive one,
on the repo's tokens. The parse comes after the permission check (ADR 0004), so only a commenter
with write access gets to choose at all.

The cost is one line in `src/model.js` for each new model, and bumping a family name such as
`sonnet` when a newer model of that family is added.

The eval workflow does not follow this. It takes its model from its own dispatch input, so a comment
can't change what the eval measures.

**Considered:** a free-form `model` value passed straight to `--model`. It needs no list to maintain,
but it is the injection above. **Also considered:** a per-repo `model` input only, which is what
existed before; it can't change the model for one hard PR without editing the workflow.
