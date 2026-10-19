---
description: Review the staged changes in proportion to their risk, then commit them
argument-hint: "[notes for the commit message]"
---
Commit the staged changes in this repository. Notes for the message, if any: $@

1. Run `git status`, `git diff --staged --stat`, and `git diff --staged`. If nothing is
   staged, show me `git status` and stop: ask me what to stage. Do not stage anything
   yourself.
2. If the current branch is the default branch (`main` or `master`), stop and ask
   whether to create a branch first.
3. Read the project's commit rules: `CONTRIBUTING.md` and the project's `AGENTS.md` or
   `CLAUDE.md`, if they exist. They take precedence over the defaults below, for example
   a required `Signed-off-by` (use `git commit --signoff`), an issue link such as
   `Closes #1234`, or a different message format.
4. Choose the review by what is staged:
   - **Docs or comments only** (`.md`, `.txt`, `.adoc`, or comment-only changes): no
     subagent review. Check the text yourself.
   - **Otherwise**, run the language reviewer with the subagent tool: "go-reviewer" for
     `.go` files, "java-reviewer" for `.java` files, otherwise "reviewer". For a mix,
     run each that applies, in parallel.
   - **Also run "security-reviewer"**, in parallel, if the change touches any of:
     dependency files (`go.mod`, `go.sum`, `package.json`, lockfiles, `pom.xml`,
     `build.gradle*`), authentication, authorization, sessions, tokens, or crypto,
     HTTP handlers or routes, SQL or migrations, file paths built from input,
     `Dockerfile` or CI workflows, or more than 200 changed lines.
   Give each reviewer the staged diff (`git diff --staged`) as its target. Tell me
   which reviewers you ran and, if you skipped security-reviewer, why.
5. If any reviewer reports a CRITICAL or HIGH finding, or a failing test, stop. Show me
   those findings and do not commit.
6. Write the commit message. Unless the project's rules say otherwise:
   `<type>: <description>` with a lowercase imperative description under 72
   characters, where type is one of `feat`, `fix`, `refactor`, `docs`, `test`,
   `chore`, `perf`, `ci`. Add a short body only when the why is not obvious from the
   diff. No co-author or "generated with" lines.
7. Commit with that message, adding `--signoff` if the project requires it. Do not
   push.

Report the commit hash and message, and list any MEDIUM or LOW findings the reviewers
raised so I can decide whether to follow up.
