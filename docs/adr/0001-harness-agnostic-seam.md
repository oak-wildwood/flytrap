# The rubric and findings schema are the contract; only the Claude adapter ships

The review rubric (a portable Agent Skill) and the findings schema are the seam between Flytrap and
whichever harness runs the review. Nothing on either side of that seam may assume Claude, but v1
ships only a Claude adapter. A second adapter (Codex, opencode) waits until someone needs it.

The alternatives were a Claude-only tool, which is simpler but is just a wrapper around `@claude`,
and shipping several adapters now, which costs a second subscription and maintenance for users we
don't have. A future reader may ask why there's a schema and an adapter layer with only one
harness behind them. The schema is there so the posting code never depends on which model wrote
the findings.
