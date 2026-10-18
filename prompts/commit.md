---
description: Review the staged changes, then commit them with a conventional message
argument-hint: "[notes for the commit message]"
---
Commit the staged changes in this repository. Notes for the message, if any: $@

1. Run `git status` and `git diff --staged`. If nothing is staged, show me `git status`
   and stop: ask me what to stage. Do not stage anything yourself.
2. If the current branch is the default branch (`main` or `master`), stop and ask
   whether to create a branch first.
3. Use the subagent tool to run these in parallel on the staged changes (`git diff --staged`):
   - "go-reviewer" if the staged changes include `.go` files, otherwise "reviewer",
   - "security-reviewer".
4. If either reports a CRITICAL or HIGH finding, or a failing test, stop. Show me those
   findings and do not commit.
5. Otherwise write the commit message: `<type>: <description>` with a lowercase
   imperative description under 72 characters, where type is one of `feat`, `fix`,
   `refactor`, `docs`, `test`, `chore`, `perf`, `ci`. Add a short body only when the why
   is not obvious from the diff. No co-author or "generated with" lines.
6. Commit with that message. Do not push.

Report the commit hash and message, and list any MEDIUM or LOW findings the reviewers
raised so I can decide whether to follow up.
