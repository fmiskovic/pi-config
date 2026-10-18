---
description: Reviewer reviews code changes, or the uncommitted changes if no target is given
argument-hint: "[what to review]"
---
Review: ${@:-the uncommitted changes in this repository}

Use the subagent tool to run the "go-reviewer" agent if the changes are in Go (`.go` files), otherwise the "reviewer" agent.

Do not fix anything yet. Show me its findings in full, most severe first, with its verdict.
