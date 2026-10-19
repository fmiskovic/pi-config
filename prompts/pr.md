---
description: Review the whole branch, then push it and open a pull request
argument-hint: "[base branch] [notes for the description]"
---
Open a pull request for the current branch. Arguments, if any: $@
The first argument is the base branch if it names one; otherwise use the repository's default branch.

1. If the working tree has uncommitted changes, show me `git status` and stop.
2. If the current branch is the base branch, stop and tell me.
3. Read the project's contribution rules: `CONTRIBUTING.md` and the project's
   `AGENTS.md` or `CLAUDE.md`, if they exist. They take precedence over the defaults
   below. If they require something the branch does not meet, such as a single
   squashed commit, a `Signed-off-by` trailer on every commit, or an issue link in the
   commit message, stop and tell me what to fix. Do not rewrite history yourself.
4. Find the merge base and read the whole branch: `git log --oneline <base>..HEAD` and
   `git diff <base>...HEAD`. Not just the last commit.
5. Use the subagent tool to run these in parallel on the branch diff against the base:
   - the language reviewer: "go-reviewer" for `.go` changes, "java-reviewer" for
     `.java` changes, otherwise "reviewer" (for a mix, each that applies),
   - "security-reviewer".
6. If any reviewer reports a CRITICAL or HIGH finding, or a failing test, stop. Show me
   those findings and do not push.
7. Look for a pull request template (`.github/pull_request_template.md` or
   `.github/PULL_REQUEST_TEMPLATE/`) and follow it if there is one. Otherwise write:
   - a title in the project's commit-message convention, or `<type>: <description>`
     if it has none,
   - **Summary**: what changed and why, from the whole branch,
   - **Test plan**: the commands that were run with their actual results, and a
     checklist of anything still to verify by hand.
   No co-author or "generated with" lines.
8. Push with `git push -u origin <branch>`, then create the pull request with
   `gh pr create --base <base> --title ... --body-file ...`. Do not force-push.
   Creating the pull request asks me for confirmation.

Report the pull request URL and list any MEDIUM or LOW findings the reviewers raised.
