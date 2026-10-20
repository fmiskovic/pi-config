#!/usr/bin/env bash
#
# Symlink this repo's config into pi's agent directory.
#
# Safe to re-run: links that already point here are left alone, and anything
# else in the way is moved to a timestamped backup directory, never deleted.
# Machine-local files (auth.json, settings.json, sessions/) are not touched.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
BACKUP_DIR="$AGENT_DIR/.backup-$(date +%Y%m%d-%H%M%S)"

LINKS=(AGENTS.md mcp.json agents prompts extensions)

link() {
	local name="$1"
	local source="$REPO_DIR/$name"
	local target="$AGENT_DIR/$name"

	if [[ -L "$target" && "$(readlink "$target")" == "$source" ]]; then
		echo "ok      $name"
		return
	fi

	if [[ -e "$target" || -L "$target" ]]; then
		mkdir -p "$BACKUP_DIR"
		mv "$target" "$BACKUP_DIR/"
		echo "backup  $name -> $BACKUP_DIR/$name"
	fi

	ln -s "$source" "$target"
	echo "linked  $name"
}

main() {
	mkdir -p "$AGENT_DIR"
	for name in "${LINKS[@]}"; do
		link "$name"
	done

	if [[ ! -e "$AGENT_DIR/settings.json" ]]; then
		cp "$REPO_DIR/settings.example.json" "$AGENT_DIR/settings.json"
		echo "created settings.json from settings.example.json"
	fi

	local missing=()
	for var in CONTEXT7_API_KEY BRAVE_API_KEY GITHUB_PERSONAL_ACCESS_TOKEN KEYCLOAK_URL KEYCLOAK_ADMIN KEYCLOAK_ADMIN_PASSWORD; do
		[[ -n "${!var:-}" ]] || missing+=("$var")
	done
	if ((${#missing[@]} > 0)); then
		echo
		echo "warning: not set in this shell, so the matching MCP servers will fail: ${missing[*]}"
	fi
}

main "$@"
