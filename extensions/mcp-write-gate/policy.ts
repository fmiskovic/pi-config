/**
 * Decides which GitHub, GitLab, and Keycloak MCP tool calls need confirmation,
 * and how to show them.
 *
 * Relies on the `readOnlyHint` annotation each server declares for its tools.
 * A tool with no annotations is treated as a write, so a newly added tool is
 * gated until it is known to be read-only.
 */

/** MCP tool annotations (only `readOnlyHint` is used here). */
export interface ToolAnnotations {
	title?: string;
	readOnlyHint?: boolean;
	destructiveHint?: boolean;
	idempotentHint?: boolean;
	openWorldHint?: boolean;
}

/** Pi names MCP tools `mcp__<server>__<tool>`. Keys are tool prefixes, values the names shown to the user. */
const GATED_SERVERS: Readonly<Record<string, string>> = {
	mcp__github__: "GitHub",
	mcp__gitlab__: "GitLab",
	mcp__keycloak__: "Keycloak",
};

const MAX_VALUE_LENGTH = 80;
const MAX_ARGUMENTS = 8;

function gatedPrefix(toolName: string): string | undefined {
	return Object.keys(GATED_SERVERS).find((prefix) => toolName.startsWith(prefix));
}

/** The display name of the gated server a tool belongs to, or undefined if it is not gated. */
export function gatedServer(toolName: string): string | undefined {
	const prefix = gatedPrefix(toolName);
	return prefix === undefined ? undefined : GATED_SERVERS[prefix];
}

export function needsConfirmation(toolName: string, annotations: ToolAnnotations | undefined): boolean {
	if (gatedPrefix(toolName) === undefined) return false;
	return annotations?.readOnlyHint !== true;
}

function formatValue(value: unknown): string {
	const text = typeof value === "string" ? value : JSON.stringify(value);
	const singleLine = (text ?? "").replace(/\s+/g, " ");
	return singleLine.length > MAX_VALUE_LENGTH ? `${singleLine.slice(0, MAX_VALUE_LENGTH)}…` : singleLine;
}

/** A short, human-readable summary of a call for the confirmation dialog. */
export function describeCall(toolName: string, input: unknown): string {
	const prefix = gatedPrefix(toolName);
	const shortName = prefix === undefined ? toolName : toolName.slice(prefix.length);
	if (typeof input !== "object" || input === null || Array.isArray(input)) return shortName;

	const entries = Object.entries(input);
	if (entries.length === 0) return shortName;

	const lines = entries.slice(0, MAX_ARGUMENTS).map(([key, value]) => `  ${key}: ${formatValue(value)}`);
	const omitted = entries.length - lines.length;
	return [shortName, ...lines, ...(omitted > 0 ? [`  (${omitted} more)`] : [])].join("\n");
}
