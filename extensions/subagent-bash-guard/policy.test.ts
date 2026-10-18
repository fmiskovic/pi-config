import assert from "node:assert/strict";
import { test } from "node:test";
import { checkCommand, parseAllowList } from "./policy.ts";

const ALLOW = ["git status", "git diff", "git log", "git show", "git blame"];

const allowed = (command: string) => assert.equal(checkCommand(command, ALLOW).allowed, true, command);
const blocked = (command: string) => assert.equal(checkCommand(command, ALLOW).allowed, false, command);

test("allows a listed command with no arguments", () => {
	allowed("git status");
});

test("allows a listed command with arguments", () => {
	allowed("git diff HEAD~1 -- internal/export.go");
	allowed("git log --oneline -n 20");
	allowed('git log --grep="fix bug" --author=filip');
	allowed("git show HEAD:README.md");
});

test("ignores surrounding and repeated whitespace", () => {
	allowed("  git   diff   HEAD  ");
});

test("blocks commands that are not listed", () => {
	blocked("rm -rf build");
	blocked("go test ./...");
	blocked("git push origin main");
	blocked("git commit -m x");
	blocked("git merge-base HEAD main");
});

test("blocks a listed prefix that is only part of a longer word", () => {
	blocked("git difftool");
	blocked("git logx");
});

test("blocks an empty command", () => {
	blocked("");
	blocked("   ");
});

test("blocks chaining, pipes, and redirection", () => {
	blocked("git status; rm -rf build");
	blocked("git status && rm -rf build");
	blocked("git status || true");
	blocked("git diff | sh");
	blocked("git diff > out.patch");
	blocked("git diff < in.txt");
	blocked("git status &");
	blocked("git status\nrm -rf build");
});

test("blocks command and variable substitution", () => {
	blocked("git log $(rm -rf build)");
	blocked("git log `rm -rf build`");
	blocked("git show $HOME");
	blocked("git diff <(ls)");
});

test("blocks escapes and grouping", () => {
	blocked("git status \\; rm x");
	blocked("(git status)");
	blocked("{ git status; }");
});

test("blocks environment prefixes and git global options", () => {
	blocked("GIT_EXTERNAL_DIFF=evil git diff");
	blocked("git -c core.pager=evil log");
	blocked("git --exec-path=/tmp status");
});

test("blocks options that write files or run external programs", () => {
	blocked("git diff --output=/tmp/x.patch");
	blocked("git log -p --output /tmp/x");
	blocked("git diff --ext-diff");
	blocked('git log --output="/tmp/x"');
});

test("gives a reason that names the allowed commands", () => {
	const result = checkCommand("rm -rf build", ALLOW);
	assert.equal(result.allowed, false);
	assert.match(result.reason ?? "", /git status/);
});

test("blocks everything when the allow list is empty", () => {
	assert.equal(checkCommand("git status", []).allowed, false);
});

test("parseAllowList returns undefined when the variable is unset", () => {
	assert.equal(parseAllowList(undefined), undefined);
});

test("parseAllowList splits, trims, and collapses whitespace", () => {
	assert.deepEqual(parseAllowList(" git status ,git   diff,, "), ["git status", "git diff"]);
});

test("parseAllowList returns an empty list for a set but empty variable", () => {
	assert.deepEqual(parseAllowList(""), []);
});
