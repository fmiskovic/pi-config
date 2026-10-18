/**
 * A small, forgiving parser for POSIX-style shell commands.
 *
 * Good enough to find the commands a line will run, so that the gates can
 * reason about `rm -fr x`, `sudo git push -f`, `bash -c "..."`, `$(...)`,
 * and pipes. It does not expand variables, aliases, or globs, and it is not a
 * security boundary against a determined adversary; it catches mistakes.
 *
 * Unbalanced quotes and parentheses never throw: the rest of the input is
 * taken as the quoted text or the substitution body.
 */

export interface Redirect {
	readonly op: string;
	readonly target: string;
}

export interface SimpleCommand {
	readonly argv: readonly string[];
	readonly redirects: readonly Redirect[];
	/** Pipelines from `$(...)`, backticks, and `<(...)` inside this command. */
	readonly nested: readonly Pipeline[];
}

/** Commands joined by `|`. */
export type Pipeline = readonly SimpleCommand[];

/** Stands in for a substitution's output in `argv`. Contains no shell syntax. */
export const SUBSTITUTION = "⟨subst⟩";

const MAX_DEPTH = 8;
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish"]);
const KEYWORDS = new Set(["if", "then", "else", "elif", "do", "while", "until", "!"]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** Wrappers that run the command after them, and their options that take a value. */
const WRAPPERS: Record<string, readonly string[]> = {
	sudo: ["-u", "-g", "-h", "-p", "-C", "-D", "-r", "-t", "-U"],
	doas: ["-u", "-C"],
	env: ["-u", "-C", "-S"],
	command: [],
	builtin: [],
	exec: ["-a"],
	nohup: [],
	time: ["-f", "-o"],
	nice: ["-n"],
	timeout: ["-s", "-k"],
	xargs: ["-I", "-n", "-P", "-L", "-d", "-E", "-s", "-a"],
	stdbuf: ["-i", "-o", "-e"],
};

/** Wrappers whose first positional argument is not the command (`timeout 10 cmd`). */
const WRAPPERS_WITH_POSITIONAL = new Set(["timeout"]);

interface Scan<T> {
	readonly value: T;
	/** Index of the last character consumed. */
	readonly end: number;
}

/** Find the `)` that closes a `(` just before `start`, skipping quoted text. */
function scanBalanced(source: string, start: number): Scan<string> {
	let depth = 1;
	for (let i = start; i < source.length; i++) {
		const c = source[i];
		if (c === "\\") i++;
		else if (c === "'" || c === '"') i = scanQuoted(source, i + 1, c).end;
		else if (c === "(") depth++;
		else if (c === ")" && --depth === 0) return { value: source.slice(start, i), end: i };
	}
	return { value: source.slice(start), end: source.length };
}

function scanQuoted(source: string, start: number, quote: string): Scan<string> {
	for (let i = start; i < source.length; i++) {
		if (source[i] === "\\" && quote === '"') i++;
		else if (source[i] === quote) return { value: source.slice(start, i), end: i };
	}
	return { value: source.slice(start), end: source.length };
}

function scanRedirectOp(source: string, start: number): Scan<string> {
	let end = start;
	while (end + 1 < source.length && "<>&|".includes(source[end + 1]) && end - start < 2) end++;
	return { value: source.slice(start, end + 1), end };
}

/** Builds pipelines word by word. Local mutable state, never shared. */
function createBuilder() {
	const pipelines: Pipeline[] = [];
	let pipeline: SimpleCommand[] = [];
	let argv: string[] = [];
	let redirects: Redirect[] = [];
	let nested: Pipeline[] = [];
	let word: string | null = null;
	let quoted = false;
	let pendingRedirect: string | null = null;

	const isGroupBrace = () => !quoted && (word === "}" || (word === "{" && argv.length === 0));

	return {
		hasWord: () => word !== null,
		append(text: string, isQuoted = false) {
			word = (word ?? "") + text;
			quoted ||= isQuoted;
		},
		addNested(inner: readonly Pipeline[]) {
			nested = [...nested, ...inner];
			word = (word ?? "") + SUBSTITUTION;
		},
		startRedirect(op: string) {
			if (word !== null && /^\d+$/.test(word) && !quoted) word = null;
			this.endWord();
			pendingRedirect = op;
		},
		endWord() {
			if (word !== null && pendingRedirect !== null) {
				redirects = [...redirects, { op: pendingRedirect, target: word }];
				pendingRedirect = null;
			} else if (word !== null && !isGroupBrace()) {
				argv = [...argv, word];
			}
			word = null;
			quoted = false;
		},
		endCommand() {
			this.endWord();
			if (argv.length > 0 || redirects.length > 0 || nested.length > 0) {
				pipeline = [...pipeline, { argv, redirects, nested }];
			}
			argv = [];
			redirects = [];
			nested = [];
			pendingRedirect = null;
		},
		endPipeline() {
			this.endCommand();
			if (pipeline.length > 0) pipelines.push(pipeline);
			pipeline = [];
		},
		result(): Pipeline[] {
			this.endPipeline();
			return pipelines;
		},
	};
}

type Builder = ReturnType<typeof createBuilder>;

/** Handle a double-quoted string starting after its opening quote. */
function readDoubleQuoted(source: string, start: number, builder: Builder, depth: number): number {
	builder.append("", true);
	for (let i = start; i < source.length; i++) {
		const c = source[i];
		if (c === '"') return i;
		if (c === "\\" && i + 1 < source.length) {
			const next = source[++i];
			builder.append('$`"\\\n'.includes(next) ? next : `\\${next}`, true);
		} else if (c === "$" && source[i + 1] === "(") {
			const inner = scanBalanced(source, i + 2);
			builder.addNested(parseShell(inner.value, depth + 1));
			i = inner.end;
		} else if (c === "`") {
			const inner = scanQuoted(source, i + 1, "`");
			builder.addNested(parseShell(inner.value, depth + 1));
			i = inner.end;
		} else {
			builder.append(c, true);
		}
	}
	return source.length;
}

/** Handle one character outside quotes. Returns the index of the last character consumed. */
function readUnquoted(source: string, i: number, builder: Builder, depth: number): number {
	const c = source[i];
	const next = source[i + 1];

	if (c === " " || c === "\t") builder.endWord();
	else if (c === "\n" || c === ";" || c === "(" || c === ")") builder.endPipeline();
	else if (c === "#" && !builder.hasWord()) return scanQuoted(source, i, "\n").end - 1;
	else if (c === "\\") {
		if (next !== "\n" && next !== undefined) builder.append(next);
		return i + 1;
	} else if (c === "'") {
		const quoted = scanQuoted(source, i + 1, "'");
		builder.append(quoted.value, true);
		return quoted.end;
	} else if (c === '"') return readDoubleQuoted(source, i + 1, builder, depth);
	else if (c === "`" || (c === "$" && next === "(") || ((c === "<" || c === ">") && next === "(")) {
		const inner = c === "`" ? scanQuoted(source, i + 1, "`") : scanBalanced(source, i + 2);
		builder.addNested(parseShell(inner.value, depth + 1));
		return inner.end;
	} else if (c === "<" || c === ">" || (c === "&" && next === ">")) {
		const op = scanRedirectOp(source, i);
		builder.startRedirect(op.value);
		return op.end;
	} else if (c === "|") {
		if (next === "|") {
			builder.endPipeline();
			return i + 1;
		}
		builder.endCommand();
		return next === "&" ? i + 1 : i;
	} else if (c === "&") {
		builder.endPipeline();
		return next === "&" ? i + 1 : i;
	} else builder.append(c);
	return i;
}

/** Parse without heredoc handling. Heredoc bodies must already be removed. */
function parseScript(source: string, depth: number): Pipeline[] {
	const builder = createBuilder();
	for (let i = 0; i < source.length; i++) {
		i = readUnquoted(source, i, builder, depth);
	}
	return builder.result();
}

/** `<<EOF`, `<<-EOF`, `<<'EOF'`, `<<"EOF"`, but not the here-string `<<<`. */
const HEREDOC = /(?<!<)<<(-?)[ \t]*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/g;

function feedsShell(line: string, depth: number): boolean {
	return allCommands(parseScript(line, depth)).some(
		(c) =>
			SHELLS.has(unwrapCommand(c.argv)[0] ?? "") && c.redirects.some((r) => r.op === "<<" || r.op === "<<-"),
	);
}

/**
 * Remove heredoc bodies, which are text, not commands. A body fed to a shell
 * (`bash <<EOF`) is returned separately so it can be parsed as a script.
 */
function splitHeredocs(source: string, depth: number): { script: string; shellBodies: string[] } {
	const lines = source.split("\n");
	const kept: string[] = [];
	const shellBodies: string[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i++];
		kept.push(line);
		for (const [, dash, , delimiter] of line.matchAll(HEREDOC)) {
			const body: string[] = [];
			while (i < lines.length && (dash ? lines[i].replace(/^\t+/, "") : lines[i]) !== delimiter) {
				body.push(lines[i++]);
			}
			i++;
			if (feedsShell(line, depth)) shellBodies.push(body.join("\n"));
		}
	}
	return { script: kept.join("\n"), shellBodies };
}

export function parseShell(source: string, depth = 0): Pipeline[] {
	if (depth > MAX_DEPTH) return [];
	const { script, shellBodies } = splitHeredocs(source, depth);
	return [...parseScript(script, depth), ...shellBodies.flatMap((body) => parseShell(body, depth + 1))];
}

/** Every pipeline, including those nested in substitutions, in source order. */
function flattenPipelines(pipelines: readonly Pipeline[]): Pipeline[] {
	return pipelines.flatMap((pipeline) => [pipeline, ...flattenPipelines(pipeline.flatMap((c) => c.nested))]);
}

/** Every command, including those nested in substitutions, in source order. */
export function allCommands(pipelines: readonly Pipeline[]): SimpleCommand[] {
	return flattenPipelines(pipelines).flat();
}

function basename(word: string): string {
	return word.slice(word.lastIndexOf("/") + 1);
}

function unwrap(argv: readonly string[]): { argv: string[]; wrappers: string[] } {
	let wrappers: string[] = [];
	let i = 0;
	while (i < argv.length) {
		const name = basename(argv[i]);
		if (ASSIGNMENT.test(argv[i]) || KEYWORDS.has(argv[i])) {
			i++;
			continue;
		}
		const valueOptions = WRAPPERS[name];
		if (!valueOptions) break;
		wrappers = [...wrappers, name];
		i++;
		while (i < argv.length && argv[i].startsWith("-") && !ASSIGNMENT.test(argv[i])) {
			if (argv[i] === "--") {
				i++;
				break;
			}
			i += valueOptions.includes(argv[i]) ? 2 : 1;
		}
		if (WRAPPERS_WITH_POSITIONAL.has(name)) i++;
	}
	const rest = argv.slice(i);
	return { argv: rest.length > 0 ? [basename(rest[0]), ...rest.slice(1)] : [], wrappers };
}

/** The command that actually runs, without `sudo`, `env`, `VAR=x`, `xargs`, and similar in front. */
export function unwrapCommand(argv: readonly string[]): string[] {
	return unwrap(argv).argv;
}

/** The wrappers in front of the command that actually runs, such as `sudo`. */
export function commandWrappers(argv: readonly string[]): string[] {
	return unwrap(argv).wrappers;
}

/** The script passed to `sh -c` (or `bash -lc`, `eval`, and so on), if this command has one. */
export function inlineScript(argv: readonly string[]): string | undefined {
	const [name, ...args] = unwrapCommand(argv);
	if (name === "eval") return args.length > 0 ? args.join(" ") : undefined;
	if (!name || !SHELLS.has(name)) return undefined;
	const flagIndex = args.findIndex((a) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a));
	return flagIndex === -1 ? undefined : args[flagIndex + 1];
}

/**
 * Every pipeline the command would run: top-level ones, those in
 * substitutions, and those in `sh -c` scripts, in source order.
 */
export function pipelinesIn(source: string, depth = 0): Pipeline[] {
	if (depth > MAX_DEPTH) return [];
	return flattenPipelines(parseShell(source)).flatMap((pipeline) => [
		pipeline,
		...pipeline.flatMap((command) => {
			const script = inlineScript(command.argv);
			return script === undefined ? [] : pipelinesIn(script, depth + 1);
		}),
	]);
}
