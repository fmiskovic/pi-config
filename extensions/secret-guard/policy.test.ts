import assert from "node:assert/strict";
import { test } from "node:test";
import { findSecretsInCommand, findSecretsInToolCall, isSecretPath, secretKey } from "./policy.ts";

test("recognizes dotenv files but not their templates", () => {
	for (const path of [".env", ".env.local", ".env.production", "app/.env", ".envrc", "prod.env"]) {
		assert.ok(isSecretPath(path), path);
	}
	for (const path of [".env.example", ".env.sample", ".env.template", ".env.dist", "environment.ts", "src/env.go"]) {
		assert.ok(!isSecretPath(path), path);
	}
});

test("recognizes keys and certificates stores", () => {
	for (const path of ["server.pem", "tls/server.key", "cert.p12", "cert.pfx", "keycloak.jks", "app.keystore", "AuthKey.p8"]) {
		assert.ok(isSecretPath(path), path);
	}
	assert.ok(!isSecretPath("messages.properties"));
});

test("recognizes SSH private keys but not public keys", () => {
	assert.ok(isSecretPath("~/.ssh/id_ed25519"));
	assert.ok(isSecretPath("/Users/me/.ssh/id_rsa"));
	assert.ok(!isSecretPath("~/.ssh/id_ed25519.pub"));
	assert.ok(!isSecretPath("~/.ssh/known_hosts"));
});

test("recognizes credential files by name and location", () => {
	for (const path of [
		"~/.aws/credentials",
		"$HOME/.aws/credentials",
		"~/.netrc",
		"~/.git-credentials",
		"~/.pgpass",
		"~/.npmrc",
		"~/.pypirc",
		"~/.docker/config.json",
		"~/.kube/config",
		"~/.config/gh/hosts.yml",
		"~/.pi/agent/auth.json",
		"/Users/me/.pi/agent/mcp-auth.json",
		"~/.claude/.credentials.json",
		"~/.gnupg/private-keys-v1.d/x.key",
		"credentials.json",
		"client_secret_123.json",
		"secrets.yaml",
		"terraform.tfstate",
		"terraform.tfstate.backup",
		"prod.tfvars",
	]) {
		assert.ok(isSecretPath(path), path);
	}
	for (const path of ["~/.aws/config", "~/.kube", "docker-compose.yml", "package.json", "auth.go", "config.json"]) {
		assert.ok(!isSecretPath(path), path);
	}
});

test("recognizes globs that would match a secret", () => {
	assert.ok(isSecretPath(".env*"));
	assert.ok(isSecretPath("*.pem"));
	assert.ok(isSecretPath("id_*"));
	assert.ok(!isSecretPath("certs/*"), "a bare wildcard is too broad to gate");
	assert.ok(!isSecretPath("*.go"));
	assert.ok(!isSecretPath("src/*.ts"));
});

test("finds secret files read by shell commands", () => {
	assert.deepEqual(findSecretsInCommand("cat .env"), [".env"]);
	assert.deepEqual(findSecretsInCommand("grep TOKEN ~/.aws/credentials"), ["~/.aws/credentials"]);
	assert.deepEqual(findSecretsInCommand("source .env.local && go run ."), [".env.local"]);
	assert.deepEqual(findSecretsInCommand("node -e x < .env"), [".env"]);
	assert.deepEqual(findSecretsInCommand("docker run --env-file=.env img"), [".env"]);
	assert.deepEqual(findSecretsInCommand('bash -c "cat ~/.ssh/id_rsa"'), ["~/.ssh/id_rsa"]);
	assert.deepEqual(findSecretsInCommand("head $(echo .env)"), [".env"]);
});

test("does not flag commands that only mention safe files", () => {
	assert.deepEqual(findSecretsInCommand("cp .env.example .env.sample"), []);
	assert.deepEqual(findSecretsInCommand("go test ./..."), []);
	assert.deepEqual(findSecretsInCommand("git diff -- src/env.go"), []);
});

test("finds environment dumps", () => {
	assert.deepEqual(findSecretsInCommand("env"), ["environment variables"]);
	assert.deepEqual(findSecretsInCommand("printenv"), ["environment variables"]);
	assert.deepEqual(findSecretsInCommand("env | sort"), ["environment variables"]);
	assert.deepEqual(findSecretsInCommand("export -p"), ["environment variables"]);
	assert.deepEqual(findSecretsInCommand("printenv HOME"), []);
	assert.deepEqual(findSecretsInCommand("env FOO=1 go test ./..."), []);
});

test("finds secret-looking variable references", () => {
	assert.deepEqual(findSecretsInCommand("echo $GITHUB_PERSONAL_ACCESS_TOKEN"), ["$GITHUB_PERSONAL_ACCESS_TOKEN"]);
	assert.deepEqual(findSecretsInCommand('echo "x: ${BRAVE_API_KEY}"'), ["$BRAVE_API_KEY"]);
	assert.deepEqual(findSecretsInCommand("printenv AWS_SECRET_ACCESS_KEY"), ["$AWS_SECRET_ACCESS_KEY"]);
	assert.deepEqual(findSecretsInCommand("echo $DB_PASSWORD"), ["$DB_PASSWORD"]);
	assert.deepEqual(findSecretsInCommand("echo $HOME $PATH $KEYBOARD"), []);
});

test("finds secret paths in file tool calls", () => {
	assert.deepEqual(findSecretsInToolCall("read", { path: ".env" }), [".env"]);
	assert.deepEqual(findSecretsInToolCall("edit", { path: "config/prod.env", edits: [] }), ["config/prod.env"]);
	assert.deepEqual(findSecretsInToolCall("write", { path: "~/.aws/credentials", content: "" }), ["~/.aws/credentials"]);
	assert.deepEqual(findSecretsInToolCall("grep", { pattern: "KEY", path: ".env.local" }), [".env.local"]);
	assert.deepEqual(findSecretsInToolCall("grep", { pattern: "KEY", glob: "*.pem" }), ["*.pem"]);
	assert.deepEqual(findSecretsInToolCall("bash", { command: "cat .env" }), [".env"]);
});

test("ignores safe and listing-only tool calls", () => {
	assert.deepEqual(findSecretsInToolCall("read", { path: "README.md" }), []);
	assert.deepEqual(findSecretsInToolCall("ls", { path: "~/.ssh" }), []);
	assert.deepEqual(findSecretsInToolCall("find", { pattern: "*.pem" }), []);
	assert.deepEqual(findSecretsInToolCall("read", {}), []);
	assert.deepEqual(findSecretsInToolCall("bash", { command: 42 }), []);
});

test("flags variables only when a command prints them", () => {
	assert.deepEqual(findSecretsInCommand('curl -H "Authorization: Bearer $TOKEN" x'), []);
	assert.deepEqual(findSecretsInCommand("git commit -m 'use $GITHUB_TOKEN in CI'"), []);
	assert.deepEqual(findSecretsInCommand("docker build --build-arg T=$NPM_TOKEN ."), []);
	assert.deepEqual(findSecretsInCommand('printf "%s" "$API_TOKEN"'), ["$API_TOKEN"]);
	assert.deepEqual(findSecretsInCommand("echo $DATABASE_URL"), ["$DATABASE_URL"]);
});

test("does not treat names that merely contain TOKEN as secrets", () => {
	assert.deepEqual(findSecretsInCommand("echo $MAX_TOKENS $TOKENIZERS_PARALLELISM"), []);
});

test("does not flag generic globs that also match ordinary files", () => {
	assert.deepEqual(findSecretsInCommand("cat *.json"), []);
	assert.deepEqual(findSecretsInCommand("find . -name '*.yaml'"), []);
	assert.deepEqual(findSecretsInCommand("grep -r foo --include='*.json' ."), []);
	assert.deepEqual(findSecretsInCommand("cat *.pem"), ["*.pem"]);
});

test("does not flag commands that touch a secret file without reading it", () => {
	assert.deepEqual(findSecretsInCommand("ls -la .env"), []);
	assert.deepEqual(findSecretsInCommand("touch .env"), []);
	assert.deepEqual(findSecretsInCommand("rm .env"), []);
	assert.deepEqual(findSecretsInCommand("cp .env.example .env"), []);
	assert.deepEqual(findSecretsInCommand("cp .env backup.txt"), [".env"]);
	assert.deepEqual(findSecretsInCommand("git add .env"), [".env"]);
});

test("flags commands that print credentials", () => {
	assert.deepEqual(findSecretsInCommand("gh auth token"), ["gh auth token"]);
	assert.deepEqual(findSecretsInCommand("gh auth status --show-token"), ["gh auth status --show-token"]);
	assert.deepEqual(findSecretsInCommand("kubectl config view --raw"), ["kubectl config view --raw"]);
	assert.deepEqual(findSecretsInCommand("gcloud auth print-access-token"), ["gcloud auth print-access-token"]);
	assert.deepEqual(findSecretsInCommand("aws configure export-credentials"), ["aws configure export-credentials"]);
	assert.deepEqual(findSecretsInCommand("gh auth status"), []);
	assert.deepEqual(findSecretsInCommand("kubectl config view"), []);
});

test("flags secret paths inside interpreter one-liners", () => {
	assert.deepEqual(findSecretsInCommand(`python3 -c "print(open('.env').read())"`), [".env"]);
	assert.deepEqual(findSecretsInCommand(`node -e "require('fs').readFileSync('server.key')"`), ["server.key"]);
	assert.deepEqual(findSecretsInCommand('git commit -m "stop tracking .env"'), []);
});

test("flags process environments, cloud credentials, and whole secret directories", () => {
	assert.deepEqual(findSecretsInCommand("cat /proc/1/environ"), ["/proc/1/environ"]);
	assert.ok(isSecretPath("~/.config/gcloud/application_default_credentials.json"));
	assert.deepEqual(findSecretsInCommand("tar czf x.tgz .ssh"), [".ssh"]);
	assert.deepEqual(findSecretsInCommand("cp -r ~/.aws /tmp/x"), ["~/.aws"]);
});

test("a heredoc body does not hide a later secret read", () => {
	assert.deepEqual(findSecretsInCommand("cat <<EOF > x\ndon't\nEOF\ncat .env"), [".env"]);
});

test("secretKey gives every spelling of a file the same key", () => {
	const home = "/home/me";
	assert.equal(secretKey(".env", "/p", home), "/p/.env");
	assert.equal(secretKey("./.env", "/p", home), "/p/.env");
	assert.equal(secretKey("/p/.env", "/elsewhere", home), "/p/.env");
	assert.equal(secretKey("sub/../.env", "/p", home), "/p/.env");
	assert.equal(secretKey("~/.aws/credentials", "/p", home), "/home/me/.aws/credentials");
	assert.equal(secretKey("$HOME/.aws/credentials", "/p", home), "/home/me/.aws/credentials");
	assert.equal(secretKey("${HOME}/.aws/credentials", "/p", home), "/home/me/.aws/credentials");
});

test("secretKey leaves variables, dumps, and commands unchanged", () => {
	assert.equal(secretKey("$GITHUB_TOKEN", "/p", "/home/me"), "$GITHUB_TOKEN");
	assert.equal(secretKey("environment variables", "/p", "/home/me"), "environment variables");
	assert.equal(secretKey("gh auth token", "/p", "/home/me"), "gh auth token");
});
