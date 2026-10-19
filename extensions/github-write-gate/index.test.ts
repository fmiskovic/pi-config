import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePi, fakeContext } from "../shared/fake-pi.ts";
import githubWriteGate from "./index.ts";

function setup() {
	const pi = createFakePi({
		tools: [
			{ name: "mcp__github__get_me", annotations: { readOnlyHint: true } },
			{ name: "mcp__github__create_pull_request", annotations: { readOnlyHint: false } },
			{ name: "mcp__github__new_tool" },
		],
	});
	githubWriteGate(pi.api);
	return pi;
}

const call = (toolName: string) => ({ toolName, input: { owner: "me", repo: "x" } });

test("lets read-only GitHub tools and other tools through without asking", async () => {
	const pi = setup();
	const ctx = fakeContext();
	assert.equal(await pi.emit("tool_call", call("mcp__github__get_me"), ctx), undefined);
	assert.equal(await pi.emit("tool_call", call("bash"), ctx), undefined);
	assert.deepEqual(ctx.prompts, []);
});

test("asks before a write and follows the answer", async () => {
	const pi = setup();
	assert.equal(await pi.emit("tool_call", call("mcp__github__create_pull_request"), fakeContext({ answers: [true] })), undefined);
	const denied = (await pi.emit("tool_call", call("mcp__github__create_pull_request"), fakeContext({ answers: [false] }))) as {
		block: boolean;
	};
	assert.equal(denied.block, true);
});

test("treats a tool with no annotations as a write", async () => {
	const ctx = fakeContext({ answers: [false] });
	const result = (await setup().emit("tool_call", call("mcp__github__new_tool"), ctx)) as { block: boolean };
	assert.equal(result.block, true);
	assert.equal(ctx.prompts.length, 1);
});

test("blocks writes when there is no UI", async () => {
	const result = (await setup().emit("tool_call", call("mcp__github__create_pull_request"), fakeContext({ hasUI: false }))) as {
		block: boolean;
	};
	assert.equal(result.block, true);
});
