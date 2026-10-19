/**
 * Decides which tool calls would read or expose secrets: credential files,
 * private keys, dotenv files, and secret-looking environment variables.
 *
 * Matches on paths and command words, so it catches `cat .env` or
 * `read ~/.aws/credentials`, not a program that opens a secret file on its
 * own. Meant to stop the agent from pulling secrets into its context by
 * accident, not to contain an adversary.
 */

import * as path from "node:path";
import { commandWrappers, pipelinesIn, type SimpleCommand, unwrapCommand } from "../shared/shell.ts";

const DOTENV = /^\.env(rc)?(\..+)?$|\.env$/;
const DOTENV_TEMPLATE = /\.(example|sample|template|dist|tmpl|defaults)$/;
const KEY_EXTENSIONS = [".pem", ".key", ".p12", ".pfx", ".jks", ".keystore", ".p8", ".ppk"];
const SSH_PRIVATE_KEY = /^id_(rsa|dsa|ecdsa|ed25519)(_sk)?$/;
const SECRET_NAMES = new Set([".netrc", "_netrc", ".git-credentials", ".pgpass", ".npmrc", ".pypirc", "credentials.json"]);
const SECRET_NAME_PATTERNS = [/^client_secret.*\.json$/, /^secrets?\.(ya?ml|json|toml)$/, /\.tfstate(\.backup)?$/, /\.tfvars$/];
const SECRET_PATH_SUFFIXES = [
	".aws/credentials",
	".docker/config.json",
	".kube/config",
	".config/gh/hosts.yml",
	".pi/agent/auth.json",
	".pi/agent/mcp-auth.json",
	".claude/.credentials.json",
];
const SECRET_DIRECTORIES = [".gnupg/", ".config/gcloud/"];
/** Directories that are secret as a whole, such as `tar czf x.tgz ~/.ssh`. */
const SECRET_DIRECTORY_NAMES = new Set([".ssh", ".gnupg", ".aws"]);
const PROCESS_ENVIRONMENT = /^\/proc\/[^/]+\/environ$/;

/** Names a glob is tested against: if it could match one of these, it could match a secret. */
const SAMPLE_SECRET_NAMES = [
	".env",
	".env.local",
	".envrc",
	"server.pem",
	"server.key",
	"cert.p12",
	"keystore.jks",
	"app.keystore",
	"id_rsa",
	"id_ed25519",
	"credentials.json",
	"client_secret.json",
	"secrets.yaml",
	"terraform.tfstate",
	"prod.tfvars",
	".netrc",
	".git-credentials",
	".npmrc",
];

/** Ordinary file names: a glob that matches one of these is too broad to gate, such as `*.json`. */
const SAMPLE_ORDINARY_NAMES = [
	"package.json",
	"tsconfig.json",
	"config.yaml",
	"config.yml",
	"docker-compose.yml",
	"config.toml",
	"main.go",
	"index.ts",
	"readme.md",
	"notes.txt",
];

/** Name parts that mark an environment variable as secret: `GITHUB_TOKEN`, `DB_PASSWORD`. */
const SECRET_VARIABLE_PARTS = new Set(["TOKEN", "SECRET", "PASSWORD", "PASSWD", "PASSPHRASE", "APIKEY", "CREDENTIAL", "CREDENTIALS", "DSN"]);
const SECRET_VARIABLE_SUFFIXES = ["_KEY", "DATABASE_URL", "CONNECTION_STRING"];
/** Commands that print their arguments, and so print any secret variable in them. */
const PRINTERS = new Set(["echo", "printf", "print"]);
/** Commands that take a path but do not read the file's contents. */
const NON_READING = new Set(["ls", "touch", "stat", "test", "[", "rm", "mkdir", "chmod", "chown", "file"]);
/** Commands whose last argument is a destination that is written, not read. */
const COPIERS = new Set(["cp", "mv"]);
const CODE_INTERPRETERS = new Set(["python", "python3", "node", "deno", "bun", "ruby", "perl", "php"]);
const CODE_OPTIONS = new Set(["-c", "-e", "-p", "-E", "-r", "--eval", "--print"]);

/** Commands that print credentials, with an option they need for that, if any. */
const CREDENTIAL_PRINTERS: readonly { words: readonly string[]; option?: readonly string[] }[] = [
	{ words: ["gh", "auth", "token"] },
	{ words: ["gh", "auth", "status"], option: ["--show-token", "-t"] },
	{ words: ["kubectl", "config", "view"], option: ["--raw"] },
	{ words: ["gcloud", "auth", "print-access-token"] },
	{ words: ["gcloud", "auth", "print-identity-token"] },
	{ words: ["gcloud", "auth", "application-default", "print-access-token"] },
	{ words: ["aws", "configure", "export-credentials"] },
	{ words: ["aws", "sts", "get-session-token"] },
	{ words: ["az", "account", "get-access-token"] },
];

const VARIABLE_REFERENCE = /\$\{?([A-Za-z_][A-Za-z0-9_]*)/g;
const ENV_DUMP = "environment variables";
const FILE_TOOLS = new Set(["read", "edit", "write"]);
const SHELL_TOOLS = new Set(["bash", "powershell"]);

function globToRegExp(glob: string): RegExp {
	const body = glob.replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
	return new RegExp(`^${body}$`);
}

function isSecretName(name: string): boolean {
	if (DOTENV.test(name)) return !DOTENV_TEMPLATE.test(name);
	return (
		KEY_EXTENSIONS.some((ext) => name.endsWith(ext)) ||
		SSH_PRIVATE_KEY.test(name) ||
		SECRET_NAMES.has(name) ||
		SECRET_NAME_PATTERNS.some((p) => p.test(name))
	);
}

function isSecretGlob(name: string): boolean {
	if (!/[a-z0-9]/.test(name.replace(/[*?[\]]/g, ""))) return false;
	const pattern = globToRegExp(name);
	return SAMPLE_SECRET_NAMES.some((s) => pattern.test(s)) && !SAMPLE_ORDINARY_NAMES.some((s) => pattern.test(s));
}

function isSecretVariable(name: string): boolean {
	const upper = name.toUpperCase();
	return upper.split("_").some((part) => SECRET_VARIABLE_PARTS.has(part)) || SECRET_VARIABLE_SUFFIXES.some((s) => upper.endsWith(s));
}

/** Whether a path, or a glob, names a file that holds secrets. */
export function isSecretPath(raw: string): boolean {
	const normalized = raw.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
	if (!normalized) return false;
	const name = normalized.slice(normalized.lastIndexOf("/") + 1);
	const inDirectory = SECRET_DIRECTORIES.some((d) => normalized.startsWith(d) || normalized.includes(`/${d}`));
	const hasSuffix = SECRET_PATH_SUFFIXES.some((s) => normalized === s || normalized.endsWith(`/${s}`));
	if (inDirectory || hasSuffix || SECRET_DIRECTORY_NAMES.has(name) || PROCESS_ENVIRONMENT.test(normalized)) return true;
	return /[*?[]/.test(name) ? isSecretGlob(name) : isSecretName(name);
}

function isSecretPathFrom(candidate: string, cwd: string | undefined): boolean {
	return isSecretPath(candidate) || (cwd !== undefined && isSecretPath(path.resolve(cwd, candidate)));
}

/** Paths named inside an interpreter one-liner, such as `python3 -c "open('.env')"`. */
function codeCandidates(name: string, args: readonly string[]): string[] {
	if (!CODE_INTERPRETERS.has(name)) return [];
	const codeIndex = args.findIndex((a) => CODE_OPTIONS.has(a));
	const code = codeIndex === -1 ? undefined : args[codeIndex + 1];
	return code === undefined ? [] : code.split(/[^A-Za-z0-9_./~$-]+/).filter(Boolean);
}

/** Words a command reads as files: arguments, `--opt=value` values, redirect targets, and paths in one-liners. */
function fileCandidates(command: SimpleCommand): string[] {
	const [name = "", ...args] = unwrapCommand(command.argv);
	if (NON_READING.has(name)) return [];
	const positional = args.filter((a) => !a.startsWith("-"));
	const readArgs = COPIERS.has(name) ? positional.slice(0, -1) : args;
	const words = [...readArgs, ...command.redirects.map((r) => r.target)].filter((w) => !/\s/.test(w));
	const values = words.map((w) => (w.includes("=") ? w.slice(w.indexOf("=") + 1) : w));
	return [...values, ...codeCandidates(name, args)];
}

function credentialPrinters(command: SimpleCommand): string[] {
	const argv = unwrapCommand(command.argv);
	return CREDENTIAL_PRINTERS.filter(
		({ words, option }) =>
			words.every((w, i) => argv[i] === w) && (option === undefined || option.some((o) => argv.includes(o))),
	).map(({ words, option }) => [...words, ...(option ? [option[0]] : [])].join(" "));
}

/** Secret variables a printing command would print, such as `echo $GITHUB_TOKEN`. */
function printedVariables(command: SimpleCommand): string[] {
	const [name, ...args] = unwrapCommand(command.argv);
	if (!PRINTERS.has(name ?? "")) return [];
	return args.flatMap((a) => [...a.matchAll(VARIABLE_REFERENCE)].map((m) => m[1])).filter(isSecretVariable).map((n) => `$${n}`);
}

function environmentExposure(command: SimpleCommand): string[] {
	const [name, ...args] = unwrapCommand(command.argv);
	if (name === undefined) return commandWrappers(command.argv).includes("env") ? [ENV_DUMP] : [];
	if (name === "printenv") {
		return args.length === 0 ? [ENV_DUMP] : args.filter(isSecretVariable).map((a) => `$${a}`);
	}
	const dumpsAll =
		(name === "export" && (args.length === 0 || (args.length === 1 && args[0] === "-p"))) ||
		(name === "set" && args.length === 0) ||
		(name === "declare" && args.length === 1 && /^-[px]+$/.test(args[0]));
	return dumpsAll ? [ENV_DUMP] : [];
}

/** The secret files and variables a shell command would read or print. */
export function findSecretsInCommand(command: string, cwd?: string): string[] {
	const commands = pipelinesIn(command).flat();
	const files = commands.flatMap(fileCandidates).filter((w) => isSecretPathFrom(w, cwd));
	const exposures = commands.flatMap((c) => [...environmentExposure(c), ...printedVariables(c), ...credentialPrinters(c)]);
	const found = [...files, ...exposures];
	return [...new Set(found)];
}

function stringField(input: Record<string, unknown>, key: string): string[] {
	const value = input[key];
	return typeof value === "string" ? [value] : [];
}

/** The secrets a tool call would read, write, or print. Empty when it touches none. */
export function findSecretsInToolCall(toolName: string, input: unknown, cwd?: string): string[] {
	if (typeof input !== "object" || input === null) return [];
	const fields = input as Record<string, unknown>;

	if (SHELL_TOOLS.has(toolName)) {
		const [command] = stringField(fields, "command");
		return command === undefined ? [] : findSecretsInCommand(command, cwd);
	}
	const candidates = FILE_TOOLS.has(toolName)
		? stringField(fields, "path")
		: toolName === "grep"
			? [...stringField(fields, "path"), ...stringField(fields, "glob")]
			: [];
	return [...new Set(candidates.filter((c) => isSecretPathFrom(c, cwd)))];
}

const VARIABLE_LABEL = /^\$[A-Za-z_][A-Za-z0-9_]*$/;
const HOME_PREFIX = /^(~|\$HOME|\$\{HOME\})(?=\/|$)/;

/**
 * A stable key for a finding, so one approval covers every spelling of the
 * same file (`.env`, `./.env`, `/abs/.env`). Variable names and labels such
 * as `environment variables` are returned unchanged.
 */
export function secretKey(secret: string, cwd: string, home: string): string {
	if (VARIABLE_LABEL.test(secret) || /\s/.test(secret)) return secret;
	return path.resolve(cwd, secret.replace(HOME_PREFIX, home));
}
