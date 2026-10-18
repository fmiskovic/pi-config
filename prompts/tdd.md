---
description: Planner plans, tdd-guide implements test-first, reviewer reviews
argument-hint: "<feature or bug fix>"
---
Use the subagent tool with the chain parameter to execute this workflow:

1. First, use the "planner" agent to create an implementation plan for: $@
2. Then, use the "tdd-guide" agent to implement the plan from the previous step test-first (use {previous} placeholder)
3. Finally, use the "reviewer" agent to review the uncommitted changes, given this implementation report (use {previous} placeholder)

Execute this as a chain, passing output between steps via {previous}. Do not commit. When it finishes, report the tests that were run with their actual results and the reviewer's findings and verdict.
