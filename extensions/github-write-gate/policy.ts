/**
 * Decides which GitHub MCP tool calls need confirmation, and how to show them.
 *
 * Relies on the `readOnlyHint` annotation the GitHub server declares for each
 * tool. A tool with no annotations is treated as a write, so a newly added
 * tool is gated until it is known to be read-only.
 */

/** MCP tool annotations (only `readOnlyHint` is used here). */
export interface ToolAnnotations {
	title?: string;
	readOnlyHint?: boolean;
	destructiveHint?: boolean;
	idempotentHint?: boolean;
	openWorldHint?: boolean;
}

/** Pi names MCP tools `mcp__<server>__<tool>`. */
const GITHUB_TOOL_PREFIX = "mcp__github__";

const MAX_VALUE_LENGTH = 80;
const MAX_ARGUMENTS = 8;

export function needsConfirmation(toolName: string, annotations: ToolAnnotations | undefined): boolean {
	if (!toolName.startsWith(GITHUB_TOOL_PREFIX)) return false;
	return annotations?.readOnlyHint !== true;
}

function formatValue(value: unknown): string {
	const text = typeof value === "string" ? value : JSON.stringify(value);
	const singleLine = (text ?? "").replace(/\s+/g, " ");
	return singleLine.length > MAX_VALUE_LENGTH ? `${singleLine.slice(0, MAX_VALUE_LENGTH)}…` : singleLine;
}

/** A short, human-readable summary of a call for the confirmation dialog. */
export function describeCall(toolName: string, input: unknown): string {
	const shortName = toolName.startsWith(GITHUB_TOOL_PREFIX) ? toolName.slice(GITHUB_TOOL_PREFIX.length) : toolName;
	if (typeof input !== "object" || input === null || Array.isArray(input)) return shortName;

	const entries = Object.entries(input);
	if (entries.length === 0) return shortName;

	const lines = entries.slice(0, MAX_ARGUMENTS).map(([key, value]) => `  ${key}: ${formatValue(value)}`);
	const omitted = entries.length - lines.length;
	return [shortName, ...lines, ...(omitted > 0 ? [`  (${omitted} more)`] : [])].join("\n");
}
