# Flytrap replaces gh-repo-init's `@review` action

gh-repo-init already had a `code-review` action (`@review`) that wrapped a third-party plugin skill
and silently posted nothing (gh-repo-init#40–#42). The redesign scoped in gh-repo-init#45 is built
here as Flytrap, not in place. gh-repo-init keeps only #45's diagnostics, which show the denied tool
call, and its `code-review.yml` template switches to calling Flytrap once Flytrap works on Oak's
repos. That leaves one review action to maintain, not two.

The rubric is Oak's own `pr-review.md` (six categories, Blocker/Suggestion/Nitpick, three-way
verdict), not mattpocock's two-axis Standards/Spec skill. That skill has no correctness category,
isn't pinned, and is written for interactive use. The one idea kept from it is checking the change
against a linked spec issue, as an optional input.
