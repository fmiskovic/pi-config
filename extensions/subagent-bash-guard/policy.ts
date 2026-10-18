/**
 * Allow-list policy for shell commands run by a restricted subagent.
 *
 * A command is allowed only if it is a single simple command that starts with
 * one of the allowed prefixes. Anything the shell could use to run a second
 * command or write a file is rejected outright rather than parsed, so quoting
 * tricks cannot get around the check.
 */

export interface CommandCheck {
	allowed: boolean;
	reason?: string;
}

/** Chaining, pipes, redirection, substitution, grouping, escapes, and newlines. */
const SHELL_METACHARACTERS = /[;&|`$<>(){}\\\n\r]/;

/** Options that make otherwise read-only git commands write files or run programs. */
const BLOCKED_OPTIONS = ["--output", "--ext-diff"];

function normalize(command: string): string {
	return command.trim().split(/\s+/).filter(Boolean).join(" ");
}

function usesBlockedOption(command: string): string | undefined {
	const tokens = command.split(" ").map((token) => token.replace(/^["']+/, ""));
	return BLOCKED_OPTIONS.find((option) => tokens.some((token) => token === option || token.startsWith(`${option}=`)));
}

/**
 * Parse the comma-separated allow list from the environment.
 *
 * `undefined` means the variable is unset and the process is not restricted.
 * An empty string means it is restricted with nothing allowed.
 */
export function parseAllowList(value: string | undefined): string[] | undefined {
	if (value === undefined) return undefined;
	return value.split(",").map(normalize).filter(Boolean);
}

export function checkCommand(command: string, allowList: readonly string[]): CommandCheck {
	const listed = allowList.length > 0 ? allowList.join(", ") : "none";
	const normalized = normalize(command);

	if (!normalized) {
		return { allowed: false, reason: `Empty command. Allowed commands: ${listed}.` };
	}
	if (SHELL_METACHARACTERS.test(command)) {
		return {
			allowed: false,
			reason: `Blocked: this agent may only run a single plain command, with no pipes, chaining, redirection, substitution, or escapes. Allowed commands: ${listed}.`,
		};
	}
	if (!allowList.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix} `))) {
		return { allowed: false, reason: `Blocked: this agent may only run these commands: ${listed}.` };
	}
	const blockedOption = usesBlockedOption(normalized);
	if (blockedOption) {
		return { allowed: false, reason: `Blocked: the ${blockedOption} option is not allowed for this agent.` };
	}
	return { allowed: true };
}
