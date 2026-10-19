# Global instructions

These apply in every project. A project's own `AGENTS.md` or `CLAUDE.md` takes
precedence where it says something different.

## Documentation lookups

When a task involves a library, framework, SDK, API, CLI tool, or cloud service,
fetch current documentation from the `context7` MCP server before answering or
writing code, even for well-known libraries. Resolve the library ID first, then
query the docs with the full question. Prefer it over web search for library docs.

Do not use it for refactoring, business-logic debugging, code review, or general
programming concepts.

Use the `brave-search` MCP server for wider research, and the `github` MCP server
or the `gh` CLI to look for existing implementations before writing something new.

## Before writing new code

- Read the code you are about to change and follow its existing patterns.
- Check whether the project, a package registry, or an open-source project already
  solves the problem. Prefer a proven library over hand-rolled utility code.
- For work that spans several files or has unclear scope, plan first.

## Coding style

- Do not mutate existing objects. Return a new copy with the change.
- Prefer many small, focused files over a few large ones: 200-400 lines is typical,
  800 is the limit. Organize by feature or domain, not by type.
- Keep functions under 50 lines and nesting to 4 levels or fewer.
- Handle errors explicitly at every level. Never swallow them silently. Give
  user-facing code a clear message and log the detail on the server side.
- Validate all external input at system boundaries (user input, API responses,
  file content), with a schema where one is available. Fail fast with a clear message.
- No hardcoded values that belong in constants or configuration.
- Match the surrounding code: its naming, idiom, and comment density.

## Testing

Work test-first:

1. Write the test and run it. It must fail, and for the right reason.
2. Write the least code that makes it pass.
3. Refactor with the tests green.

Aim for 80% coverage of the code you change. Use unit tests for logic, integration
tests for API endpoints and database operations, and end-to-end tests for critical
user flows. When a test fails, fix the implementation, not the test, unless the test
is wrong. Always run the tests yourself and report the actual result.

## Git

- Commit messages: `<type>: <description>`, with an optional body. Types: `feat`,
  `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`. If the project's
  `CONTRIBUTING.md` sets its own rules (a format, a `Signed-off-by` trailer, an issue
  link, one commit per PR), follow those instead.
- Do not add co-author or "generated with" attribution lines.
- Commit or push only when asked. Do not commit straight to the default branch
  unless asked.
- For a pull request, review the whole branch (`git diff <base>...HEAD`), not just
  the last commit, and include a summary and a test plan.

## Security

Before any commit, check:

- no hardcoded secrets (API keys, passwords, tokens); use environment variables or
  a secret manager,
- all user input is validated,
- queries are parameterized and output is escaped,
- authentication and authorization are enforced,
- error messages do not leak sensitive data.

If you find a security problem, stop and report it before continuing. Treat any
secret that may have been exposed as needing rotation.

Do not read secret files (`.env`, private keys, credential files) or print secret
environment variables. If you need a value from one, ask for that value. If a guard
blocks a command, do not work around it with another command that does the same
thing; tell me what you need and why.

## Subagents

The `subagent` tool runs these agents in a separate context:

- `planner`: an implementation plan for multi-file or unclear work. Read-only.
- `tdd-guide`: implements a feature or bug fix test-first.
- `reviewer`: reviews changes after code is written or before a commit. Read-only.
- `go-reviewer`: reviews Go changes and runs `go vet`, the affected tests with
  `-race`, and linters. Use instead of `reviewer` for Go.
- `java-reviewer`: reviews Java changes, with Keycloak-specific checks. Read-only.
  Use instead of `reviewer` for Java.
- `security-reviewer`: reviews changes for vulnerabilities before a commit or PR,
  and after changes to auth, input handling, external calls, or dependencies.
  Read-only.
- `explainer`: explains unfamiliar code before it is changed. Read-only.

Use them when the task fits. Run independent subagent tasks in parallel.

## Reporting

Say plainly what you did and what happened. If a test failed or a step was skipped,
say so with the output. Confirm before anything destructive or hard to undo.
