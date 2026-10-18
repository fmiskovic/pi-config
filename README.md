# pi-config

My configuration for the [pi coding agent](https://github.com/earendil-works/pi):
global instructions, subagents, prompt templates, MCP servers, and a few safety
extensions.

## Install

Requires pi, Node.js 24+, and `npx` (used by the Brave Search MCP server).

```bash
git clone git@github.com:fmiskovic/pi-config.git ~/dev/pi-config
~/dev/pi-config/install.sh
```

`install.sh` symlinks `AGENTS.md`, `mcp.json`, `agents/`, `prompts/`, and
`extensions/` into `~/.pi/agent` (or `$PI_CODING_AGENT_DIR`). Anything already
there is moved to `~/.pi/agent/.backup-<timestamp>/`, not deleted. It is safe
to re-run. If there is no `settings.json` yet, it creates one from
`settings.example.json`.

Because the files are symlinked, edits made on any machine land in this repo:
commit them, then `git pull` elsewhere. No reinstall is needed.

### Secrets

Nothing secret is stored in this repo. Each machine keeps its own:

- `~/.pi/agent/auth.json`: created when you log in to a provider in pi.
- These environment variables, read by `mcp.json`. Set them in your shell profile
  or load them from a secret manager:

| Variable | Used by |
|---|---|
| `CONTEXT7_API_KEY` | `context7` (library documentation) |
| `BRAVE_API_KEY` | `brave-search` (web search) |
| `GITHUB_PERSONAL_ACCESS_TOKEN` | `github` (repos, issues, PRs) |

If the GitHub token has write scopes, the `github-write-gate` extension is the
only thing that asks before the agent writes to GitHub. Keep it enabled, or use
a read-only token.

## What's included

### Instructions

`AGENTS.md` applies to every project: documentation lookups via Context7, coding
style, test-first workflow, git conventions, security checks, and when to use
subagents. A project's own `AGENTS.md` or `CLAUDE.md` takes precedence.

### Subagents

Run by the `subagent` tool, each in its own pi process and context window.

| Agent | Does | Access |
|---|---|---|
| `planner` | Writes an implementation plan | Read-only |
| `tdd-guide` | Implements test-first | Full |
| `reviewer` | Reviews changes for correctness, security, regressions | Read-only |
| `go-reviewer` | Reviews Go changes; runs `go vet`, tests with `-race`, linters | No edits; runs tests |
| `security-reviewer` | Reviews changes for vulnerabilities; runs `govulncheck` | Read-only |
| `explainer` | Explains how code works | Read-only |

The access limits are enforced, not just requested: these agents get no edit or
write tools, and their shell is limited to the commands in their `bashAllow`
frontmatter, with options that write files or run other programs (`git diff
--output`, `go test -exec`, `-toolexec`, `-o`, `golangci-lint --fix`, and so on)
blocked. `go-reviewer` runs the project's own tests, so it is not strictly
read-only.

### Prompts

| Command | Runs |
|---|---|
| `/plan <task>` | `planner` |
| `/review [target]` | `go-reviewer` for Go changes, else `reviewer`; uncommitted changes by default |
| `/security [target]` | `security-reviewer`, on uncommitted changes by default |
| `/commit [notes]` | Reviews the staged changes, then commits with a conventional message. Stops on a CRITICAL or HIGH finding; never pushes |
| `/pr [base] [notes]` | Reviews the whole branch, then pushes it and opens a pull request with a summary and test plan |
| `/explain <question>` | `explainer` |
| `/tdd <task>` | `planner` → `tdd-guide` → `reviewer` as a chain |

### Extensions

| Extension | Does |
|---|---|
| `subagent/` | The `subagent` tool: single, parallel, and chained runs |
| `subagent-bash-guard/` | Enforces an agent's `bashAllow` list in its child process: one plain command, no pipes, chaining, redirection, or substitution |
| `github-write-gate/` | Asks before any GitHub MCP call not declared read-only; blocks them when there is no UI (print mode, subagents) |
| `permission-gate/` | Asks before commands that are hard to undo: recursive `rm`, `sudo`, `git push --force`/`--delete`, `git reset --hard`, `git clean -f`, discarding changes with `git checkout`/`git restore`, `git switch -f`, `git branch -D`, `git stash drop`, `curl … \| sh`, `eval` of any of these, `dd of=`, `mkfs`, raw disk writes, `find -delete`, `kubectl delete`, `terraform destroy`, `docker system prune`, `aws s3 rm --recursive`, `gh repo delete` |
| `secret-guard/` | Asks before a tool reads, writes, or prints secrets: `.env*` (not templates), private keys and keystores, `~/.aws/credentials`, `~/.kube/config`, `.netrc`, `.npmrc`, Terraform state, pi's own `auth.json`, `/proc/*/environ`, environment dumps, `echo $*_TOKEN`-style prints, and commands that print credentials (`gh auth token`, `kubectl config view --raw`, `gcloud auth print-access-token`). Using a variable without printing it (`curl -H "Bearer $TOKEN"`) is fine. Approvals can cover the rest of the session |
| `dirty-repo-guard.ts` | Asks before starting or forking a session with uncommitted changes |
| `shared/` | The shell parser both gates use, so flag order, `sudo`, `xargs`, `bash -c "…"`, `$(…)`, and pipes do not hide a command. Not loaded as an extension |

Every gate also hooks calls made from `codemode` scripts. With no UI to ask (print
mode, subagents), anything a gate would ask about is blocked.

The gates catch mistakes, not a determined adversary. They match command words and
paths, so a program that opens a secret file by itself, or a command spelled in a way
the parser cannot see through (a downloaded script saved and then run, a command run
over `ssh`), gets past them. Keep real secrets out of the agent's reach too.

## Tests

```bash
npm test
```

Runs the tests for the shell parser and all three gates' policies with Node's
built-in test runner. CI runs the same on every push.

## Credits

`subagent/`, `permission-gate/`, and `dirty-repo-guard.ts` are based on the
example extensions shipped with pi (MIT). `subagent/` adds `bashAllow` support,
`permission-gate/` is rewritten around a shell parser, and `dirty-repo-guard.ts`
is unchanged.

## License

MIT. See [LICENSE](LICENSE).
