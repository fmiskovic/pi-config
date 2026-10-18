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

interface OptionRules {
	/** Option names, without dashes, that are blocked with any value. */
	readonly names: readonly string[];
	/** Option name prefixes, without dashes, that are blocked with any value. */
	readonly prefixes?: readonly string[];
	/** Option names, without dashes, that are blocked only with one of these values. */
	readonly values?: Readonly<Record<string, readonly string[]>>;
}

/**
 * Options that make an otherwise read-only command write files or run other
 * programs, keyed by program. Names are compared without leading dashes,
 * because Go accepts both `-exec` and `--exec`.
 */
const BLOCKED_OPTIONS: Readonly<Record<string, OptionRules>> = {
	git: { names: ["output", "ext-diff"] },
	go: {
		names: [
			"exec",
			"toolexec",
			"vettool",
			"o",
			"c",
			"coverprofile",
			"cpuprofile",
			"memprofile",
			"blockprofile",
			"mutexprofile",
			"trace",
			"outputdir",
			"args",
			"update",
			"fuzz",
		],
		values: { mod: ["mod"] },
	},
	"golangci-lint": { names: ["fix", "cpu-profile-path", "mem-profile-path", "trace-path"], prefixes: ["output."] },
};

function normalize(command: string): string {
	return command.trim().split(/\s+/).filter(Boolean).join(" ");
}

function usesBlockedOption(command: string): string | undefined {
	// The shell drops quotes anywhere in a word, so `-"o"` and `-ex"ec"` are `-o` and `-exec`.
	const tokens = command.split(" ").map((token) => token.replace(/["']/g, ""));
	const rules = BLOCKED_OPTIONS[tokens[0]];
	if (!rules) return undefined;

	for (const [index, token] of tokens.entries()) {
		if (!/^--?[^-]/.test(token)) continue;
		const [option, inlineValue] = token.split(/=(.*)/s);
		const name = option.replace(/^--?/, "");
		if (rules.names.includes(name) || rules.prefixes?.some((p) => name.startsWith(p))) return option;
		const value = inlineValue ?? tokens[index + 1];
		if (rules.values?.[name]?.includes(value)) return `${option}=${value}`;
	}
	return undefined;
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
