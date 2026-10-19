---
description: Reviewer reviews code changes, or the uncommitted changes if no target is given
argument-hint: "[what to review]"
---
Review: ${@:-the uncommitted changes in this repository}

Use the subagent tool to run the reviewer for the language of the changes: "go-reviewer" for `.go` files, "java-reviewer" for `.java` files, otherwise "reviewer". If the changes mix languages, run each that applies, in parallel.

Do not fix anything yet. Show me its findings in full, most severe first, with its verdict.
