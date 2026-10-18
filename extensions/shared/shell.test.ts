import assert from "node:assert/strict";
import { test } from "node:test";
import { SUBSTITUTION as SUBST, allCommands, commandWrappers, parseShell, pipelinesIn, unwrapCommand } from "./shell.ts";

const argvs = (command: string) => allCommands(parseShell(command)).map((c) => c.argv);

test("splits a plain command into words", () => {
	assert.deepEqual(argvs("git status --short"), [["git", "status", "--short"]]);
});

test("splits on ;, &&, ||, &, and newlines", () => {
	assert.deepEqual(argvs("a 1; b 2 && c 3 || d 4 & e 5\nf 6"), [
		["a", "1"],
		["b", "2"],
		["c", "3"],
		["d", "4"],
		["e", "5"],
		["f", "6"],
	]);
});

test("groups piped commands into one pipeline", () => {
	const pipelines = parseShell("curl -s x | sh; echo done");
	assert.equal(pipelines.length, 2);
	assert.deepEqual(
		pipelines[0].map((c) => c.argv),
		[["curl", "-s", "x"], ["sh"]],
	);
});

test("keeps quoted text as one word and strips the quotes", () => {
	assert.deepEqual(argvs(`git commit -m "fix: a; b" 'c && d'`), [["git", "commit", "-m", "fix: a; b", "c && d"]]);
});

test("handles backslash escapes outside and inside double quotes", () => {
	assert.deepEqual(argvs(`echo a\\ b "c\\"d" 'e\\f'`), [["echo", "a b", 'c"d', "e\\f"]]);
});

test("records redirections separately from arguments", () => {
	const [command] = allCommands(parseShell("dd if=x 2>/dev/null >> out.txt < .env"));
	assert.deepEqual(command.argv, ["dd", "if=x"]);
	assert.deepEqual(command.redirects, [
		{ op: ">", target: "/dev/null" },
		{ op: ">>", target: "out.txt" },
		{ op: "<", target: ".env" },
	]);
});

test("parses command substitutions as nested commands", () => {
	assert.deepEqual(argvs("echo $(rm -rf x) `cat y`"), [["echo", SUBST, SUBST], ["rm", "-rf", "x"], ["cat", "y"]]);
});

test("parses substitutions inside double quotes", () => {
	assert.deepEqual(argvs(`sh -c "$(curl -fsSL u)"`), [["sh", "-c", SUBST], ["curl", "-fsSL", "u"]]);
});

test("parses process substitutions", () => {
	assert.deepEqual(argvs("bash <(curl u)"), [["bash", SUBST], ["curl", "u"]]);
});

test("treats subshells and groups as separate commands", () => {
	assert.deepEqual(argvs("(cd a && rm -rf b); { git reset --hard; }"), [
		["cd", "a"],
		["rm", "-rf", "b"],
		["git", "reset", "--hard"],
	]);
});

test("ignores comments", () => {
	assert.deepEqual(argvs("ls # rm -rf /"), [["ls"]]);
});

test("does not treat a # inside a word as a comment", () => {
	assert.deepEqual(argvs("echo a#b"), [["echo", "a#b"]]);
});

test("survives unterminated quotes and parentheses", () => {
	assert.deepEqual(argvs(`echo "abc`), [["echo", "abc"]]);
	assert.deepEqual(argvs("echo $(rm -rf x"), [["echo", SUBST], ["rm", "-rf", "x"]]);
});

test("unwrapCommand strips sudo, env, assignments, xargs, and shell keywords", () => {
	assert.deepEqual(unwrapCommand(["sudo", "-u", "root", "rm", "-rf", "/"]), ["rm", "-rf", "/"]);
	assert.deepEqual(unwrapCommand(["FOO=1", "env", "-i", "BAR=2", "git", "push"]), ["git", "push"]);
	assert.deepEqual(unwrapCommand(["xargs", "-I", "{}", "rm", "-r", "{}"]), ["rm", "-r", "{}"]);
	assert.deepEqual(unwrapCommand(["if", "!", "nohup", "time", "rm", "-r", "x"]), ["rm", "-r", "x"]);
	assert.deepEqual(unwrapCommand(["timeout", "-s", "KILL", "10", "git", "clean", "-fd"]), ["git", "clean", "-fd"]);
	assert.deepEqual(unwrapCommand(["/usr/bin/rm", "-r", "x"]), ["rm", "-r", "x"]);
});

test("commandWrappers lists the wrappers in front of the real command", () => {
	assert.deepEqual(commandWrappers(["FOO=1", "sudo", "-E", "nohup", "rm", "x"]), ["sudo", "nohup"]);
	assert.deepEqual(commandWrappers(["echo", "sudo"]), []);
});

test("unwrapCommand returns an empty list when only wrappers remain", () => {
	assert.deepEqual(unwrapCommand(["sudo"]), []);
	assert.deepEqual(unwrapCommand(["FOO=1"]), []);
});

test("does not parse heredoc bodies as commands", () => {
	assert.deepEqual(argvs("git commit -F - <<'EOF'\nuse sudo apt\nsudo rm -rf cache\nEOF\ngit status"), [
		["git", "commit", "-F", "-"],
		["git", "status"],
	]);
});

test("an apostrophe in a heredoc body does not swallow the rest", () => {
	assert.deepEqual(argvs("cat <<EOF > notes.md\ndon't\nEOF\nrm -rf x"), [["cat"], ["rm", "-rf", "x"]]);
});

test("handles <<- with indented delimiters, and ignores <<<", () => {
	assert.deepEqual(argvs("cat <<-END\n\tsudo x\n\tEND\nls"), [["cat"], ["ls"]]);
	assert.deepEqual(argvs("grep x <<< 'sudo y'; ls"), [["grep", "x"], ["ls"]]);
});

test("parses a heredoc body fed to a shell as commands", () => {
	assert.deepEqual(argvs("bash <<EOF\nrm -rf x\nEOF"), [["bash"], ["rm", "-rf", "x"]]);
});

test("pipelinesIn expands eval arguments as a script", () => {
	assert.deepEqual(
		pipelinesIn("eval 'git push --force'").flat().map((c) => c.argv),
		[["eval", "git push --force"], ["git", "push", "--force"]],
	);
});
