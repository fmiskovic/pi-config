import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePi, fakeContext } from "../shared/fake-pi.ts";
import secretGuard from "./index.ts";

const ALLOW_ONCE = "Allow once";
const ALLOW_SESSION = "Allow these for the rest of the session";

function setup() {
	const pi = createFakePi();
	secretGuard(pi.api);
	return pi;
}

const read = (path: string) => ({ toolName: "read", input: { path } });

test("lets calls that touch no secrets through without asking", async () => {
	const ctx = fakeContext();
	assert.equal(await setup().emit("tool_call", read("README.md"), ctx), undefined);
	assert.deepEqual(ctx.prompts, []);
});

test("blocks secret reads when there is no UI", async () => {
	const result = (await setup().emit("tool_call", read(".env"), fakeContext({ hasUI: false }))) as { block: boolean; reason: string };
	assert.equal(result.block, true);
	assert.match(result.reason, /\.env/);
});

test("blocks when the user says Block", async () => {
	const result = (await setup().emit("tool_call", read(".env"), fakeContext({ answers: ["Block"] }))) as { block: boolean };
	assert.equal(result.block, true);
});

test("Allow once allows this call and asks again next time", async () => {
	const pi = setup();
	const ctx = fakeContext({ answers: [ALLOW_ONCE, ALLOW_ONCE] });
	assert.equal(await pi.emit("tool_call", read(".env"), ctx), undefined);
	assert.equal(await pi.emit("tool_call", read(".env"), ctx), undefined);
	assert.equal(ctx.prompts.length, 2);
});

test("a session approval covers every spelling of the same file", async () => {
	const pi = setup();
	const ctx = fakeContext({ cwd: "/work", answers: [ALLOW_SESSION] });
	assert.equal(await pi.emit("tool_call", read(".env"), ctx), undefined);
	assert.equal(await pi.emit("tool_call", read("./.env"), ctx), undefined);
	assert.equal(await pi.emit("tool_call", read("/work/.env"), ctx), undefined);
	assert.equal(await pi.emit("tool_call", { toolName: "bash", input: { command: "cat .env" } }, ctx), undefined);
	assert.equal(ctx.prompts.length, 1);
});

test("a session approval does not cover other secrets", async () => {
	const pi = setup();
	const ctx = fakeContext({ answers: [ALLOW_SESSION, "Block"] });
	await pi.emit("tool_call", read(".env"), ctx);
	const result = (await pi.emit("tool_call", read("server.key"), ctx)) as { block: boolean };
	assert.equal(result.block, true);
});

test("a new session forgets earlier approvals", async () => {
	const pi = setup();
	const ctx = fakeContext({ answers: [ALLOW_SESSION, ALLOW_ONCE] });
	await pi.emit("tool_call", read(".env"), ctx);
	await pi.emit("session_start", {}, ctx);
	await pi.emit("tool_call", read(".env"), ctx);
	assert.equal(ctx.prompts.length, 2);
});
