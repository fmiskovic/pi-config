---
description: Reviewer reviews code changes, or the uncommitted changes if no target is given
argument-hint: "[what to review]"
---
Use the subagent tool to run the "reviewer" agent on: ${@:-the uncommitted changes in this repository}

Do not fix anything yet. Show me its findings in full, most severe first, with its verdict.
