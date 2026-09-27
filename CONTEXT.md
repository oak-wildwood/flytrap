# Nuthatch

Nuthatch reviews a pull request and reports what it finds on the PR, on demand or as a check.
Its review rubric and output contract are meant to outlive any one AI harness.

## Language

### The review

**Review**:
One pass of Nuthatch over one pull request, producing Findings and a Verdict.
_Avoid_: Report, run (a run is the CI job that carries a Review)

**Rubric**:
The fixed set of categories a Review judges against: Correctness, Security, Performance,
Maintainability, Testing, and Conventions.
_Avoid_: Axes, checklist

**Changed lines**:
The lines a pull request adds or modifies. A Review judges only these, never code that was
already there.
_Avoid_: Diff scope

**Conventions**:
The reviewed repository's own rules, as written in its agent instruction files (AGENTS.md, CLAUDE.md).
_Avoid_: Standards, style guide

**Spec**:
The issue or issues a pull request says it closes. When there is one, the Review also checks that
the change does what the Spec asked. It is optional; an issue merely mentioned is not a Spec.
_Avoid_: Ticket, requirements

### What a review produces

**Finding**:
One problem in the Changed lines, with a location, a Rubric category, and a Severity.
_Avoid_: Comment, issue (an issue is a GitHub issue)

**Severity**:
How much a Finding matters: **Blocker** (must fix before merge), **Suggestion** (recommended),
or **Nitpick** (optional).
_Avoid_: Priority, level

**Verdict**:
The Review's overall judgement: **Approve**, **Approve with suggestions**, or **Request Changes**.
_Avoid_: Result, status

### Portability

**Harness**:
The agent runtime that runs a Review, such as Claude Code or Codex.
_Avoid_: Model, provider, engine

**Adapter**:
The only Harness-specific part of Nuthatch: it gets a Harness to run a Review and hand back
Findings.
_Avoid_: Driver, plugin
