/**
 * Decides which shell commands are dangerous enough to need confirmation.
 *
 * Works on parsed commands (see ../shared/shell.ts), so flag order, chaining,
 * wrappers like `sudo` or `xargs`, substitutions, and `bash -c` scripts do
 * not hide a match. Meant to catch mistakes, not to contain an adversary.
 */

import {
	commandWrappers,
	inlineScript,
	type Pipeline,
	pipelinesIn,
	SUBSTITUTION,
	type SimpleCommand,
	unwrapCommand,
} from "../shared/shell.ts";

type Rule = (args: readonly string[]) => string | undefined;

const DOWNLOADERS = new Set(["curl", "wget"]);
const INTERPRETERS = new Set([
	"sh",
	"bash",
	"zsh",
	"dash",
	"ksh",
	"fish",
	"python",
	"python3",
	"perl",
	"ruby",
	"node",
	"deno",
	"bun",
	"php",
	"eval",
	"source",
	".",
]);
/** Interpreters that run every argument as code, rather than a script file. */
const EVALUATORS = new Set(["eval", "source", "."]);
/** Options that make an interpreter run code from an argument or a module, not from stdin. */
const CODE_FROM_ARGUMENT = new Set(["-c", "-m", "-e", "-p", "-E", "-r", "--eval", "--print"]);
const KUBECTL_VALUE_OPTIONS = new Set(["-n", "--namespace", "--context", "--kubeconfig", "--cluster", "--user", "-s", "--server"]);
const ESCALATION = new Set(["sudo", "doas"]);
const RAW_DISK = /^\/dev\/(r?disk\d|sd[a-z]|nvme|hd[a-z]|xvd|vd[a-z]|mmcblk)/;

/** Arguments before a `--` end-of-options marker. */
function optionsPart(args: readonly string[]): readonly string[] {
	const end = args.indexOf("--");
	return end === -1 ? args : args.slice(0, end);
}

/** Letters of every combined short option, such as `-xdf`. */
function shortFlags(args: readonly string[]): string {
	return optionsPart(args)
		.filter((a) => /^-[a-zA-Z]+$/.test(a))
		.map((a) => a.slice(1))
		.join("");
}

function hasLong(args: readonly string[], ...names: string[]): boolean {
	return optionsPart(args).some((a) => names.some((n) => a === n || a.startsWith(`${n}=`)));
}

/** Split `git [global options] <subcommand> <args>`. */
function gitSubcommand(args: readonly string[]): { sub: string | undefined; rest: readonly string[] } {
	const takesValue = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"]);
	let i = 0;
	while (i < args.length && args[i].startsWith("-")) i += takesValue.has(args[i]) ? 2 : 1;
	return { sub: args[i], rest: args.slice(i + 1) };
}

const GIT_RULES: Record<string, Rule> = {
	push: (rest) => {
		const flags = shortFlags(rest);
		const refspecs = rest.filter((a) => !a.startsWith("-"));
		const forced =
			hasLong(rest, "--force", "--force-with-lease", "--force-if-includes", "--mirror", "--delete", "--prune") ||
			/[fd]/.test(flags) ||
			refspecs.some((r) => r.length > 1 && (r.startsWith("+") || r.startsWith(":")));
		return forced ? "git push --force/--delete: rewrites or deletes remote branches" : undefined;
	},
	reset: (rest) => (rest.includes("--hard") ? "git reset --hard: discards uncommitted changes" : undefined),
	clean: (rest) =>
		shortFlags(rest).includes("f") || hasLong(rest, "--force") ? "git clean -f: deletes untracked files" : undefined,
	checkout: (rest) =>
		rest.includes("--") || rest.includes(".") || shortFlags(rest).includes("f") || hasLong(rest, "--force")
			? "git checkout -- / . / -f: discards uncommitted changes"
			: undefined,
	restore: (rest) => {
		const flags = shortFlags(rest);
		const staged = hasLong(rest, "--staged") || flags.includes("S");
		const worktree = hasLong(rest, "--worktree") || flags.includes("W");
		return !staged || worktree ? "git restore: discards uncommitted changes" : undefined;
	},
	branch: (rest) => {
		const flags = shortFlags(rest);
		const deletes = flags.includes("d") || hasLong(rest, "--delete");
		const forced = flags.includes("f") || hasLong(rest, "--force");
		return flags.includes("D") || (deletes && forced) ? "git branch -D: deletes an unmerged branch" : undefined;
	},
	switch: (rest) =>
		shortFlags(rest).includes("f") || hasLong(rest, "--force", "--discard-changes")
			? "git switch -f / --discard-changes: discards uncommitted changes"
			: undefined,
	worktree: (rest) =>
		rest[0] === "remove" && (shortFlags(rest).includes("f") || hasLong(rest, "--force"))
			? "git worktree remove --force: deletes a worktree with uncommitted changes"
			: undefined,
	stash: (rest) =>
		rest[0] === "drop" || rest[0] === "clear" ? "git stash drop/clear: deletes stashed changes" : undefined,
	"filter-branch": () => "git filter-branch: rewrites repository history",
	"filter-repo": () => "git filter-repo: rewrites repository history",
};

function ghApiMethod(args: readonly string[]): string | undefined {
	const index = args.findIndex((a) => a === "-X" || a === "--method");
	if (index !== -1) return args[index + 1];
	const inline = args.find((a) => /^(-X|--method=)./.test(a));
	return inline?.replace(/^(-X|--method=)/, "");
}

const GH_DELETES = new Set(["repo delete", "repo archive", "release delete"]);

/** The first argument that is neither an option nor an option's value. */
function kubectlSubcommand(args: readonly string[]): string | undefined {
	for (let i = 0; i < args.length; i++) {
		if (KUBECTL_VALUE_OPTIONS.has(args[i])) i++;
		else if (!args[i].startsWith("-")) return args[i];
	}
	return undefined;
}

const DOCKER_DELETES = new Set(["system prune", "volume rm", "volume prune", "image prune", "container prune"]);

const COMMAND_RULES: Record<string, Rule> = {
	rm: (args) => {
		const recursiveLong = optionsPart(args).some((a) => a.length >= 5 && "--recursive".startsWith(a));
		return /[rR]/.test(shortFlags(args)) || recursiveLong ? "rm -r: deletes a directory tree" : undefined;
	},
	su: () => "su: runs commands as another user",
	chmod: (args) => worldWritable("chmod", args),
	chown: (args) => worldWritable("chown", args),
	git: (args) => {
		const { sub, rest } = gitSubcommand(args);
		return sub ? GIT_RULES[sub]?.(rest) : undefined;
	},
	dd: (args) => (args.some((a) => a.startsWith("of=")) ? "dd of=…: writes raw data to a file or device" : undefined),
	diskutil: (args) =>
		/^(erase|zero|randomdisk|secureerase|partitiondisk|reformat)/i.test(args[0] ?? "")
			? `diskutil ${args[0]}: erases a disk`
			: undefined,
	find: (args) => {
		const execIndex = args.findIndex((a) => a === "-exec" || a === "-execdir" || a === "-ok");
		const execsRm = execIndex !== -1 && unwrapCommand(args.slice(execIndex + 1))[0] === "rm";
		return args.includes("-delete") || execsRm ? "find -delete / -exec rm: deletes matching files" : undefined;
	},
	kubectl: (args) => (kubectlSubcommand(args) === "delete" ? "kubectl delete: deletes cluster resources" : undefined),
	docker: (args) =>
		DOCKER_DELETES.has(`${args[0]} ${args[1]}`)
			? `docker ${args[0]} ${args[1]}: deletes containers, images, or volumes`
			: undefined,
	aws: (args) =>
		args[0] === "s3" &&
		((args[1] === "rm" && hasLong(args, "--recursive")) || (args[1] === "rb" && hasLong(args, "--force")))
			? "aws s3 rm --recursive / rb --force: deletes bucket contents"
			: undefined,
	terraform: (args) =>
		args[0] === "destroy" || (args[0] === "apply" && args.includes("-destroy"))
			? "terraform destroy: destroys infrastructure"
			: undefined,
	gh: (args) => {
		const pair = `${args[0]} ${args[1]}`;
		if (GH_DELETES.has(pair)) return `gh ${pair}: deletes or archives GitHub resources`;
		const method = args[0] === "api" ? ghApiMethod(args) : undefined;
		return method?.toUpperCase() === "DELETE" ? "gh api DELETE: deletes GitHub resources" : undefined;
	},
};

function worldWritable(name: string, args: readonly string[]): string | undefined {
	const mode = args.find((a) => /^0?777$/.test(a) || a === "a+rwx");
	return mode ? `${name} ${mode}: makes files world-writable` : undefined;
}

function commandDangers(command: SimpleCommand): string[] {
	const escalations = commandWrappers(command.argv)
		.filter((w) => ESCALATION.has(w))
		.map((w) => `${w}: runs a command as another user`);
	const [name, ...args] = unwrapCommand(command.argv);
	const ruleDanger = name?.startsWith("mkfs")
		? "mkfs: formats a filesystem"
		: name
			? COMMAND_RULES[name]?.(args)
			: undefined;
	const deviceWrites = command.redirects
		.filter((r) => r.op.includes(">") && RAW_DISK.test(r.target))
		.map((r) => `writes to ${r.target}: overwrites a raw disk`);
	return [...escalations, ...(ruleDanger ? [ruleDanger] : []), ...deviceWrites];
}

function commandName(command: SimpleCommand): string | undefined {
	return unwrapCommand(command.argv)[0];
}

/** Whether an interpreter reads its program from stdin, as in `curl … | sh`. */
function readsScriptFromStdin(args: readonly string[]): boolean {
	if (args.includes("-") || args.includes("-s")) return true;
	if (args.some((a) => CODE_FROM_ARGUMENT.has(a))) return false;
	return !args.some((a) => !a.startsWith("-"));
}

/** The arguments an interpreter runs as code: the `-c` script, or the script file. */
function programArguments(argv: readonly string[]): string[] {
	const [name, ...args] = unwrapCommand(argv);
	if (EVALUATORS.has(name ?? "")) return args;
	const codeIndex = args.findIndex((a) => CODE_FROM_ARGUMENT.has(a) || /^-[a-zA-Z]*c$/.test(a));
	if (codeIndex !== -1) return args.slice(codeIndex + 1, codeIndex + 2);
	const script = inlineScript(argv) ?? args.find((a) => !a.startsWith("-"));
	return script === undefined ? [] : [script];
}

/** Whether a download's output is run as the program, as in `sh -c "$(curl …)"` or `bash <(curl …)`. */
function runsDownload(command: SimpleCommand): boolean {
	if (!programArguments(command.argv).some((a) => a.includes(SUBSTITUTION))) return false;
	const nested = command.nested.flatMap((p) => p.flatMap((c) => [c, ...c.nested.flat()]));
	return nested.some((c) => DOWNLOADERS.has(commandName(c) ?? ""));
}

function pipelineDangers(pipeline: Pipeline): string[] {
	return pipeline.flatMap((command, index) => {
		const [name, ...args] = unwrapCommand(command.argv);
		if (!name || !INTERPRETERS.has(name)) return [];
		const downloadsBefore =
			readsScriptFromStdin(args) && pipeline.slice(0, index).some((c) => DOWNLOADERS.has(commandName(c) ?? ""));
		if (downloadsBefore) return [`pipes a download into ${name}: runs remote code`];
		return runsDownload(command) ? [`runs a download with ${name}: runs remote code`] : [];
	});
}

/** Reasons the command needs confirmation, one per kind of danger. Empty when it is safe. */
export function findDangers(command: string): string[] {
	const pipelines = pipelinesIn(command);
	const dangers = [...pipelines.flat().flatMap(commandDangers), ...pipelines.flatMap(pipelineDangers)];
	return [...new Set(dangers)];
}
