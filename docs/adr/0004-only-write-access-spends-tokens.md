# Only a commenter with write access can spend the repo's tokens

A `@nuthatch` comment starts a run in the base repository, where its secrets are available, even on
a PR opened from a fork. So the first step of every run checks the commenter's permission on the
repo and stops, with no model call and no checkout, unless it is `write`, `maintain` or `admin`.
Nuthatch never sets `claude-code-action`'s `allowed_non_write_users` or `allowed_bots`.

`claude-code-action` already does a similar check. We check again ourselves because this is
Nuthatch's guarantee, not the adapter's. A future adapter might not check, and one input on the
wrapped action can turn its check off. Don't remove this step because it looks redundant.
