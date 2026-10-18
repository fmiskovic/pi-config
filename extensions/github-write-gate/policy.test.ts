import assert from "node:assert/strict";
import { test } from "node:test";
import { describeCall, needsConfirmation } from "./policy.ts";

test("does not gate tools outside the GitHub server", () => {
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

test("describeCall shows the tool name without the server prefix", () => {
	assert.match(describeCall("mcp__github__create_pull_request", {}), /^create_pull_request/);
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
