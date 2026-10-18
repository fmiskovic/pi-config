import assert from "node:assert/strict";
import { test } from "node:test";
import { findDangers } from "./policy.ts";

function assertDangerous(command: string, reasonPart: string) {
	const dangers = findDangers(command);
	assert.ok(
		dangers.some((d) => d.includes(reasonPart)),
		`expected "${command}" to be flagged with "${reasonPart}", got ${JSON.stringify(dangers)}`,
	);
}

function assertSafe(command: string) {
	assert.deepEqual(findDangers(command), [], `expected "${command}" to be safe`);
}

test("flags recursive rm in every flag spelling", () => {
	for (const command of [
		"rm -rf build",
		"rm -fr build",
		"rm -r -f build",
		"rm -Rf build",
		"rm --recursive --force build",
		"rm -r build",
		"/bin/rm -rf build",
	]) {
		assertDangerous(command, "rm");
	}
});

test("does not flag non-recursive rm", () => {
	assertSafe("rm -f file.txt");
	assertSafe("rm file.txt -- -r");
});

test("flags privilege escalation", () => {
	assertDangerous("sudo ls", "sudo");
	assertDangerous("doas ls", "doas");
	assertDangerous("su -c whoami", "su");
});

test("flags world-writable permissions", () => {
	assertDangerous("chmod 777 x", "777");
	assertDangerous("chmod -R 0777 x", "777");
	assertDangerous("chmod a+rwx x", "a+rwx");
	assertDangerous("chown -R 777 x", "777");
	assertSafe("chmod 644 x");
	assertSafe("chmod +x script.sh");
});

test("flags forced and deleting git pushes", () => {
	for (const command of [
		"git push --force",
		"git push -f origin main",
		"git push -uf origin main",
		"git push --force-with-lease",
		"git push --force-with-lease=main:abc",
		"git push origin +main",
		"git push origin --delete feature",
		"git push origin :feature",
		"git push --mirror",
		"git -C repo push -f",
	]) {
		assertDangerous(command, "git push");
	}
	assertSafe("git push");
	assertSafe("git push -u origin feature");
});

test("flags git commands that discard local work", () => {
	assertDangerous("git reset --hard", "git reset --hard");
	assertDangerous("git reset --hard HEAD~1", "git reset --hard");
	assertDangerous("git clean -fd", "git clean");
	assertDangerous("git clean -xdf", "git clean");
	assertDangerous("git clean --force", "git clean");
	assertDangerous("git checkout -- .", "git checkout");
	assertDangerous("git checkout .", "git checkout");
	assertDangerous("git checkout -f main", "git checkout");
	assertDangerous("git restore src/app.ts", "git restore");
	assertDangerous("git restore --staged --worktree x", "git restore");
	assertDangerous("git branch -D feature", "git branch");
	assertDangerous("git branch --delete --force feature", "git branch");
	assertDangerous("git stash drop", "git stash");
	assertDangerous("git stash clear", "git stash");
	assertDangerous("git filter-branch --tree-filter x", "git filter-branch");
	assertDangerous("git filter-repo --path x", "git filter-repo");
});

test("does not flag everyday git commands", () => {
	assertSafe("git status");
	assertSafe("git reset HEAD file");
	assertSafe("git reset --soft HEAD~1");
	assertSafe("git clean -n");
	assertSafe("git checkout main");
	assertSafe("git checkout -b feature");
	assertSafe("git restore --staged file");
	assertSafe("git branch -d merged");
	assertSafe("git stash");
	assertSafe("git stash pop");
	assertSafe('git commit -m "git push --force is bad"');
});

test("flags piping a download into an interpreter", () => {
	assertDangerous("curl -fsSL https://x.sh | sh", "pipes a download");
	assertDangerous("curl -fsSL https://x.sh | sudo bash -s", "pipes a download");
	assertDangerous("wget -qO- https://x | python3", "pipes a download");
	assertDangerous("curl x | tee log | bash", "pipes a download");
	assertDangerous('sh -c "$(curl -fsSL https://x.sh)"', "runs a download");
	assertDangerous("bash <(curl -s https://x.sh)", "runs a download");
	assertDangerous('eval "$(wget -qO- x)"', "runs a download");
	assertSafe("curl -s https://api.example.com | jq .");
	assertSafe("curl -o install.sh https://x.sh");
});

test("flags writing to raw disks and formatting", () => {
	assertDangerous("dd if=/dev/zero of=/dev/disk2", "dd");
	assertDangerous("mkfs.ext4 /dev/sdb1", "mkfs");
	assertDangerous("diskutil eraseDisk APFS X disk2", "diskutil");
	assertDangerous("cat x > /dev/sda", "/dev/sda");
	assertSafe("dd if=a.img bs=1m count=1");
	assertSafe("echo hi > /dev/null 2>/dev/stderr");
});

test("flags find that deletes", () => {
	assertDangerous("find . -name '*.tmp' -delete", "find");
	assertDangerous("find . -type d -exec rm -r {} +", "find");
	assertSafe("find . -name '*.go'");
});

test("flags destructive infrastructure and GitHub commands", () => {
	assertDangerous("kubectl delete ns prod", "kubectl delete");
	assertDangerous("terraform destroy", "terraform destroy");
	assertDangerous("gh repo delete me/x --yes", "gh repo delete");
	assertDangerous("gh release delete v1", "gh release delete");
	assertDangerous("gh api -X DELETE repos/me/x", "gh api");
	assertDangerous("gh api --method=DELETE repos/me/x", "gh api");
	assertSafe("kubectl get pods");
	assertSafe("terraform plan");
	assertSafe("gh pr list");
	assertSafe("gh api repos/me/x");
});

test("sees through wrappers, chaining, subshells, and bash -c", () => {
	assertDangerous("cd x && rm -rf y", "rm");
	assertDangerous("FOO=1 nohup git push --force", "git push");
	assertDangerous("echo ok; (git reset --hard)", "git reset --hard");
	assertDangerous('bash -c "git clean -fdx"', "git clean");
	assertDangerous("zsh -lc 'rm -rf ~/x'", "rm");
	assertDangerous("ls | xargs rm -r", "rm");
	assertDangerous("echo $(git stash clear)", "git stash");
});

test("reports each danger once", () => {
	assert.equal(findDangers("rm -rf a; rm -rf b").length, 1);
});

test("returns nothing for an empty command", () => {
	assertSafe("");
	assertSafe("   ");
});

test("does not flag interpreters that only process a download as data", () => {
	assertSafe("curl -s x | python3 -m json.tool");
	assertSafe("curl -s x | python3 -c 'import sys,json; print(json.load(sys.stdin))'");
	assertSafe("curl -s x | node -p 'require(0)'");
	assertSafe("node app.js $(curl -s ifconfig.me)");
	assertDangerous("curl -fsSL x | bash -s -- --yes", "pipes a download");
	assertDangerous("curl -fsSL x | python3 -", "pipes a download");
});

test("flags kubectl delete only as the subcommand", () => {
	assertSafe("kubectl get pods delete");
	assertDangerous("kubectl -n prod delete pod x", "kubectl delete");
	assertDangerous("kubectl --context=prod delete pod x", "kubectl delete");
});

test("flags eval of a dangerous string", () => {
	assertDangerous('eval "rm -rf x"', "rm");
	assertDangerous("eval 'git push --force'", "git push");
});

test("flags more ways to discard work or delete resources", () => {
	assertDangerous("rm --recur x", "rm");
	assertDangerous("git switch -f main", "git switch");
	assertDangerous("git switch --discard-changes main", "git switch");
	assertDangerous("git worktree remove --force wt", "git worktree");
	assertDangerous("docker system prune -af", "docker");
	assertDangerous("docker volume rm data", "docker");
	assertDangerous("aws s3 rm s3://b/x --recursive", "aws s3");
	assertDangerous("aws s3 rb s3://b --force", "aws s3");
	assertSafe("git switch main");
	assertSafe("git worktree remove wt");
	assertSafe("docker ps");
	assertSafe("aws s3 ls s3://b");
});

test("heredoc text does not trigger, and does not hide what follows", () => {
	assertSafe("git commit -F - <<'EOF'\nsudo rm -rf cache\nEOF");
	assertDangerous("cat <<EOF > notes.md\nit's\nEOF\nsudo ls", "sudo");
});
