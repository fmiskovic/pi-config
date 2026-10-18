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
| `explainer` | Explains how code works | Read-only |

"Read-only" is enforced, not just requested: these agents get no edit or write
tools, and their shell is limited to the git commands in their `bashAllow`
frontmatter.

### Prompts

| Command | Runs |
|---|---|
| `/plan <task>` | `planner` |
| `/review [target]` | `reviewer`, on uncommitted changes by default |
| `/explain <question>` | `explainer` |
| `/tdd <task>` | `planner` → `tdd-guide` → `reviewer` as a chain |

### Extensions

| Extension | Does |
|---|---|
| `subagent/` | The `subagent` tool: single, parallel, and chained runs |
| `subagent-bash-guard/` | Enforces an agent's `bashAllow` list in its child process: one plain command, no pipes, chaining, redirection, or substitution |
| `github-write-gate/` | Asks before any GitHub MCP call not declared read-only; blocks them when there is no UI (print mode, subagents) |
| `permission-gate.ts` | Asks before `rm -rf`, `sudo`, and `chmod`/`chown 777` |
| `dirty-repo-guard.ts` | Asks before starting or forking a session with uncommitted changes |

## Tests

```bash
npm test
```

Runs the policy tests for the two gates with Node's built-in test runner. CI
runs the same on every push.

## Credits

`subagent/`, `permission-gate.ts`, and `dirty-repo-guard.ts` are based on the
example extensions shipped with pi (MIT). `subagent/` adds `bashAllow` support;
the other two are unchanged.

## License

MIT. See [LICENSE](LICENSE).
