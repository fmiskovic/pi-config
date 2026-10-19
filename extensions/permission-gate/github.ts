/**
 * Which `gh` CLI commands write to GitHub.
 *
 * Mirrors the GitHub MCP write gate for the CLI: anything that creates,
 * changes, or deletes something on GitHub needs confirmation; reading and
 * local-only commands (`gh pr checkout`, `gh repo clone`) do not.
 */

const DELETES = new Set(["repo delete", "repo archive", "release delete"]);

/** Subcommands that write, by command group. */
const WRITES: Readonly<Record<string, readonly string[]>> = {
	pr: ["create", "merge", "close", "reopen", "edit", "comment", "review", "ready", "lock", "unlock", "update-branch"],
	issue: ["create", "close", "reopen", "edit", "comment", "delete", "transfer", "lock", "unlock", "pin", "unpin", "develop"],
	release: ["create", "edit", "upload", "delete", "delete-asset"],
	repo: ["create", "edit", "fork", "rename", "archive", "unarchive", "delete", "sync"],
	gist: ["create", "edit", "delete", "rename"],
	secret: ["set", "delete"],
	variable: ["set", "delete"],
	workflow: ["run", "enable", "disable"],
	run: ["cancel", "rerun", "delete"],
	label: ["create", "edit", "delete", "clone"],
	cache: ["delete"],
};

/** Options that add request fields; `gh api` sends a POST when any is present. */
const FIELD_OPTIONS = ["-f", "-F", "--field", "--raw-field", "--input"];

function apiMethod(args: readonly string[]): string | undefined {
	const index = args.findIndex((a) => a === "-X" || a === "--method");
	if (index !== -1) return args[index + 1]?.toUpperCase();
	const inline = args.find((a) => /^(-X|--method=)./.test(a));
	return inline?.replace(/^(-X|--method=)/, "").toUpperCase();
}

function hasFields(args: readonly string[]): boolean {
	return args.some((a) => FIELD_OPTIONS.some((o) => a === o || a.startsWith(`${o}=`)));
}

/** A GraphQL call is a write only when it sends a mutation. */
function isGraphqlRead(args: readonly string[]): boolean {
	return args[1] === "graphql" && !args.some((a) => /\bmutation\b/.test(a));
}

function apiDanger(args: readonly string[]): string | undefined {
	const method = apiMethod(args) ?? (hasFields(args) && !isGraphqlRead(args) ? "POST" : "GET");
	if (method === "GET" || method === "HEAD") return undefined;
	return method === "DELETE"
		? "gh api DELETE: deletes GitHub resources"
		: `gh api ${method}: writes to GitHub`;
}

/** Why a `gh` command needs confirmation, or undefined if it only reads. */
export function ghDanger(args: readonly string[]): string | undefined {
	const [group, verb] = args;
	if (group === "api") return apiDanger(args);
	const pair = `${group} ${verb}`;
	if (DELETES.has(pair)) return `gh ${pair}: deletes or archives GitHub resources`;
	return group && verb && WRITES[group]?.includes(verb) ? `gh ${pair}: writes to GitHub` : undefined;
}
