import assert from "node:assert/strict";
import { test } from "node:test";
import { describeCall, gatedServer, needsConfirmation } from "./policy.ts";

test("does not gate tools outside the gated servers", () => {
	assert.equal(needsConfirmation("bash", undefined), false);
	assert.equal(needsConfirmation("mcp__context7__query_docs", { readOnlyHint: true }), false);
	assert.equal(needsConfirmation("mcp__brave_search__brave_web_search", undefined), false);
});

test("does not gate GitHub tools declared read-only", () => {
	assert.equal(needsConfirmation("mcp__github__list_issues", { readOnlyHint: true }), false);
	assert.equal(needsConfirmation("mcp__github__get_file_contents", { readOnlyHint: true, idempotentHint: false }), false);
});

test("gates GitHub tools declared as writes", () => {
	assert.equal(needsConfirmation("mcp__github__create_pull_request", { readOnlyHint: false }), true);
	assert.equal(needsConfirmation("mcp__github__delete_file", { readOnlyHint: false, destructiveHint: true }), true);
});

test("gates GitHub tools with missing annotations", () => {
	assert.equal(needsConfirmation("mcp__github__some_new_tool", undefined), true);
	assert.equal(needsConfirmation("mcp__github__some_new_tool", {}), true);
});

test("does not match a different server whose name only starts with github", () => {
	assert.equal(needsConfirmation("mcp__github_enterprise__delete_file", undefined), false);
});

test("gates GitLab tools the same way as GitHub tools", () => {
	assert.equal(needsConfirmation("mcp__gitlab__get_issue", { readOnlyHint: true }), false);
	assert.equal(needsConfirmation("mcp__gitlab__create_merge_request", { readOnlyHint: false }), true);
	assert.equal(needsConfirmation("mcp__gitlab__some_new_tool", undefined), true);
	assert.equal(needsConfirmation("mcp__gitlab_ce__create_issue", undefined), false);
});

test("gates every Keycloak tool, since the server declares no annotations", () => {
	assert.equal(needsConfirmation("mcp__keycloak__delete_user", undefined), true);
	assert.equal(needsConfirmation("mcp__keycloak__list_users", undefined), true);
	assert.equal(needsConfirmation("mcp__keycloak__list_realms", { readOnlyHint: true }), false);
	assert.equal(needsConfirmation("mcp__keycloak_prod__delete_user", undefined), false);
});

test("gatedServer names the server a tool belongs to", () => {
	assert.equal(gatedServer("mcp__github__create_pull_request"), "GitHub");
	assert.equal(gatedServer("mcp__gitlab__create_merge_request"), "GitLab");
	assert.equal(gatedServer("mcp__keycloak__reset_user_password"), "Keycloak");
	assert.equal(gatedServer("mcp__context7__query_docs"), undefined);
	assert.equal(gatedServer("bash"), undefined);
});

test("describeCall shows the tool name without the server prefix", () => {
	assert.match(describeCall("mcp__github__create_pull_request", {}), /^create_pull_request/);
	assert.match(describeCall("mcp__gitlab__create_merge_request", {}), /^create_merge_request/);
});

test("describeCall lists the arguments", () => {
	const text = describeCall("mcp__github__create_pull_request", { owner: "softika", repo: "kcac", title: "Add x" });
	assert.match(text, /owner: softika/);
	assert.match(text, /repo: kcac/);
	assert.match(text, /title: Add x/);
});

test("describeCall truncates long values", () => {
	const text = describeCall("mcp__github__create_or_update_file", { content: "x".repeat(5000) });
	assert.ok(text.length < 400, `length was ${text.length}`);
	assert.match(text, /…/);
});

test("describeCall serializes nested values and tolerates non-object input", () => {
	assert.match(describeCall("mcp__github__push_files", { files: [{ path: "a.go" }] }), /files: \[\{"path":"a.go"\}\]/);
	assert.equal(describeCall("mcp__github__get_me", undefined), "get_me");
	assert.equal(describeCall("mcp__github__get_me", "oops"), "get_me");
});
