# pi-config

My configuration for the [pi coding agent](https://github.com/earendil-works/pi):
global instructions, subagents, prompt templates, MCP servers, and a few safety
extensions.

## Install

Requires pi, Node.js 24+, `npx` (used by the Brave Search and Keycloak MCP servers),
and Docker (used by the Terraform MCP server).

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
| `KEYCLOAK_URL`, `KEYCLOAK_ADMIN`, `KEYCLOAK_ADMIN_PASSWORD` | `keycloak` (admin API of a local Keycloak) |

If the GitHub token has write scopes, the `mcp-write-gate` extension is the only
thing that asks before the agent writes to GitHub (or to a GitLab MCP server named
`gitlab`, if you add one). Keep it enabled, or use a read-only token. It also gates
the `keycloak` server: that server logs in as a Keycloak admin and marks none of
its tools read-only, so every Keycloak call asks, list calls included.

## What's included

### Instructions

`AGENTS.md` applies to every project: documentation lookups via Context7, coding
style, test-first workflow, git conventions, security checks, and when to use
subagents. A project's own `AGENTS.md` or `CLAUDE.md` takes precedence.

### Subagents

Run by the `subagent` tool, each in its own pi process and context window.

| Agent | Does | Access |
|---|---|---|
| `planner` | Writes an implementation plan (on `gpt-6.1-sol`) | Read-only |
| `tdd-guide` | Implements test-first | Full |
| `reviewer` | Reviews changes for correctness, security, regressions | Read-only |
| `go-reviewer` | Reviews Go changes; runs `go vet`, tests with `-race`, linters | No edits; runs tests |
| `java-reviewer` | Reviews Java changes, with Keycloak-specific checks (provider lifecycle, sessions, admin permissions) | Read-only |
| `security-reviewer` | Reviews changes for vulnerabilities; runs `govulncheck` | Read-only |
| `explainer` | Explains how code works (on `gpt-6.1-sol`) | Read-only |

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
| `/review [target]` | The reviewer for the language (`go-reviewer`, `java-reviewer`, else `reviewer`); uncommitted changes by default |
| `/security [target]` | `security-reviewer`, on uncommitted changes by default |
| `/commit [notes]` | Reviews the staged changes in proportion to their risk, then commits. Docs-only changes get no subagent review; `security-reviewer` runs only for dependency, auth, input-handling, CI, or large changes. Stops on a CRITICAL or HIGH finding; never pushes |
| `/pr [base] [notes]` | Reviews the whole branch with the language reviewer and `security-reviewer`, then pushes it and opens a pull request with a summary and test plan |

`/commit` and `/pr` follow a project's own `CONTRIBUTING.md` rules first, such as
Keycloak's `Signed-off-by` trailer, `Closes #issue` link, and one commit per PR.
| `/explain <question>` | `explainer` |
| `/tdd <task>` | `planner` → `tdd-guide` → `reviewer` as a chain |

### Extensions

| Extension | Does |
|---|---|
| `subagent/` | The `subagent` tool: single, parallel, and chained runs |
| `subagent-bash-guard/` | Enforces an agent's `bashAllow` list in its child process: one plain command, no pipes, chaining, redirection, or substitution |
| `mcp-write-gate/` | Asks before any GitHub, GitLab, or Keycloak MCP call not declared read-only; blocks them when there is no UI (print mode, subagents) |
| `permission-gate/` | Asks before commands that are hard to undo: recursive `rm`, `sudo`, `git push --force`/`--delete`, `git reset --hard`, `git clean -f`, discarding changes with `git checkout`/`git restore`, `git switch -f`, `git branch -D`, `git stash drop`, `curl … \| sh`, `eval` of any of these, `dd of=`, `mkfs`, raw disk writes, `find -delete`, `kubectl delete`, `terraform destroy`, `docker system prune`, `aws s3 rm --recursive`, and `gh` commands that write to GitHub (`gh pr create`/`merge`, `gh issue close`, `gh release create`, `gh api -X POST`, and so on; reads like `gh pr view` pass) |
| `secret-guard/` | Asks before a tool reads, writes, or prints secrets: `.env*` (not templates), private keys and keystores, `~/.aws/credentials`, `~/.kube/config`, `.netrc`, `.npmrc`, Terraform state, pi's own `auth.json`, `/proc/*/environ`, environment dumps, `echo $*_TOKEN`-style prints, and commands that print credentials (`gh auth token`, `kubectl config view --raw`, `gcloud auth print-access-token`). Using a variable without printing it (`curl -H "Bearer $TOKEN"`) is fine. Approvals can cover the rest of the session |
| `dirty-repo-guard.ts` | Asks before starting or forking a session with uncommitted changes |
| `shared/` | The shell parser both gates use, so flag order, `sudo`, `xargs`, `bash -c "…"`, `eval`, `$(…)`, heredocs, and pipes do not hide a command; plus a fake pi API for tests. Not loaded as an extension |

Every gate also hooks calls made from `codemode` scripts. With no UI to ask (print
mode, subagents), anything a gate would ask about is blocked.

The gates catch mistakes, not a determined adversary. They match command words and
paths, so a program that opens a secret file by itself, or a command spelled in a way
the parser cannot see through (a downloaded script saved and then run, a command run
over `ssh`), gets past them. Keep real secrets out of the agent's reach too, and use
the sandbox below for repositories you do not trust.

## Sandbox

`sandbox/pi-sandbox` runs pi in a Docker container that can only see the directory
you start it from:

```bash
ln -s ~/dev/pi-config/sandbox/pi-sandbox ~/.local/bin/pi-sandbox   # once
cd ~/dev/some-untrusted-repo
pi-sandbox                    # first run: use /login inside
pi-sandbox -- -p "list the failing tests"
```

| | Host pi | `pi-sandbox` |
|---|---|---|
| Files | Everything your user can read | The current directory only, at `/workspace` (`--read-only` to mount it read-only) |
| pi login and sessions | `~/.pi/agent` | Its own, in the `pi-sandbox-home` Docker volume |
| This config | Symlinked | Mounted read-only |
| SSH keys, cloud credentials, other repos | Reachable | Not mounted |
| GitHub token | Always | Only with `--github` |
| `git push` | Your credentials | No credentials, so pushes fail |
| Network | Open | Open (the model API needs it) |

The image matches your host pi and Go versions (`pi-sandbox:<pi>-go<go>`) and runs as
an unprivileged user. Rebuild it after updating pi with `pi-sandbox --rebuild`. The
container has its own pi login so your host OAuth tokens are never copied in.
It has no Java toolchain and no Go linters; add them to `sandbox/Dockerfile` if you
need them there.

## Tests

```bash
npm ci --ignore-scripts   # once: pi's types and TypeScript, pinned to the pi you run
npm run check             # type-check, then all tests
```

The tests cover the shell parser, every gate's policy, and the wiring: each
extension is loaded against a fake pi API (`extensions/shared/fake-pi.ts`) and its
handlers are exercised. The type-check runs against pi's own type definitions, so an
event or API that pi renames fails CI instead of silently disabling a gate. CI runs
both on every push.

The dev dependencies pin pi 1.3.0. When you update pi, set the `@earendil-works/*`
versions in `package.json` to the new version, then run `npm install` and
`npm run check`. They are only for type-checking and tests: pi loads the extensions
with its own copies of these packages.

## Credits

`subagent/`, `permission-gate/`, and `dirty-repo-guard.ts` are based on the
example extensions shipped with pi (MIT). `subagent/` adds `bashAllow` support,
`permission-gate/` is rewritten around a shell parser, and `dirty-repo-guard.ts`
is unchanged.

## License

MIT. See [LICENSE](LICENSE).
