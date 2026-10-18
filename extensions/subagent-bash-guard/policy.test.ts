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

test("keeps git options that share a name with blocked go options", () => {
	allowed("git log -c");
	allowed("git show -c HEAD");
});

const GO_ALLOW = ["go vet", "go test", "golangci-lint run", "staticcheck"];
const goAllowed = (command: string) => assert.equal(checkCommand(command, GO_ALLOW).allowed, true, command);
const goBlocked = (command: string) => assert.equal(checkCommand(command, GO_ALLOW).allowed, false, command);

test("allows go vet, go test, and linters with read-only options", () => {
	goAllowed("go vet ./...");
	goAllowed("go test -race -run TestExport ./internal/export/...");
	goAllowed("go test -count=1 -mod=readonly ./...");
	goAllowed("golangci-lint run ./...");
	goAllowed("staticcheck ./...");
});

test("blocks go options that run other programs", () => {
	goBlocked("go test -exec /tmp/evil ./...");
	goBlocked("go test --exec=/tmp/evil ./...");
	goBlocked("go test -toolexec evil ./...");
	goBlocked("go vet -vettool=/tmp/evil ./...");
});

test("blocks go options that write files or change go.mod", () => {
	goBlocked("go test -c ./pkg");
	goBlocked("go test -o pkg.test ./pkg");
	goBlocked("go test -coverprofile=c.out ./...");
	goBlocked("go test -cpuprofile cpu.out ./...");
	goBlocked("go test -mod=mod ./...");
	goBlocked("go test ./... -args -update");
	goBlocked("go test ./... -update");
	goBlocked("golangci-lint run --fix");
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

test("blocks options hidden by quotes inside the token", () => {
	goBlocked('go test -"o" /tmp/x');
	goBlocked("go test -'c' ./pkg");
	goBlocked('go test -ex"ec" /tmp/evil ./...');
});

test("blocks fuzzing and linter options that write files", () => {
	goBlocked("go test -fuzz=FuzzParse ./pkg");
	goBlocked("golangci-lint run --output.json.path=x.json");
	goBlocked("golangci-lint run --cpu-profile-path=x");
	goBlocked("golangci-lint run --mem-profile-path x");
	goAllowed("golangci-lint run --timeout=5m ./...");
});
