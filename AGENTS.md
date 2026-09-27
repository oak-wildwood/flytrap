<!--
  Starter AGENTS.md, written by gh-repo-init.

  This file is a skeleton, not a finished document. Fill it in or delete it —
  a half-filled AGENTS.md is worse than none, because an agent will read the
  prompts below as though they were facts about your project.

  The test for every line you add: could a fresh session work this out by
  reading the code? If yes, cut it. `ls` already lists the directories and the
  package manifest already lists the stack, and both cost context every single
  session they sit here.

  What earns its place is what the code cannot say: what this project is for,
  what breaks quietly, and what must never happen.
-->

# Agent instructions

Instructions for AI coding agents working in this repository. Humans should read the README.

## What this project is, and why it constrains you

<!--
  One short paragraph. Not the elevator pitch — the thing an agent would
  misjudge from the source alone.

  Useful shape: "Read from the source this looks like X. It isn't, because Y."
  If nothing about this project is surprising, delete this section rather than
  padding it.
-->

## Hard rules

<!--
  Prohibitions with consequences behind them: data that must never be
  fabricated, systems that must never be called from tests, files that are
  generated and must never be hand-edited.

  State the consequence, not just the rule. "Never edit src/generated/" is a
  rule an agent may weigh against the task in front of it. "Never edit
  src/generated/ — the next build overwrites it and the change is silently
  lost" is a rule it can reason about, and reasoning survives situations you
  didn't anticipate.

  If you have none of these, delete the section. An empty ruleset is honest;
  an invented one dilutes the rules you add later.
-->

## Invariants that are easy to break by accident

<!--
  The things a plausible-looking edit breaks quietly — where the code compiles,
  the tests pass, and something is now subtly wrong.

  These are usually the hardest-won knowledge in a codebase and the least
  visible in it. Ordering assumptions, identifiers that are permanent because
  something stored them, caches that must be invalidated together.
-->

## Working in this repo

<!--
  Non-obvious workflow only. Skip anything already in the package manifest's
  scripts or in a standard invocation for your tooling.
-->

### PR titles become commit messages

This repo squash-merges, and the squashed commit takes the **PR title** as its subject with an
empty body. So the PR title is not a label on a discussion — it is the permanent record of the
change in `git log`, and it is the only part that survives the merge.

Write it as a conventional commit: `type: imperative summary`, lowercase after the colon, no
trailing period, under about 70 characters.

```
feat: add CSV export to the reports page
fix: stop the date filter dropping the last day of the range
test: add coverage for the retry path
docs: record why we hand-roll the parser
ci: run the formatter check on pull requests
refactor: extract the pagination hook
chore: bump the linter to 10.2
```

Use `feat` and `fix` for changes a user would notice, and `refactor` for ones they wouldn't.
`test`, `docs`, `ci` and `chore` cover the rest. When a change spans several types, name the one
that carries the point of the PR rather than the one touching the most files.

Individual commits on the branch don't survive the squash, so they're for the reviewer rather than
for history. Use them to separate things worth reviewing apart — a mechanical reformat from a
behavioural change, say — and don't agonise over their wording.
