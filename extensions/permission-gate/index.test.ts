import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePi, fakeContext } from "../shared/fake-pi.ts";
import permissionGate from "./index.ts";

function setup() {
	const pi = createFakePi();
	permissionGate(pi.api);
	return pi;
}

const bash = (command: string) => ({ toolName: "bash", input: { command } });

test("lets safe commands and other tools through without asking", async () => {
	const pi = setup();
	const ctx = fakeContext();
	assert.equal(await pi.emit("tool_call", bash("git status"), ctx), undefined);
	assert.equal(await pi.emit("tool_call", { toolName: "read", input: { path: "x" } }, ctx), undefined);
	assert.deepEqual(ctx.prompts, []);
});

test("blocks a dangerous command when there is no UI, naming the danger", async () => {
	const result = (await setup().emit("tool_call", bash("git push --force"), fakeContext({ hasUI: false }))) as {
		block: boolean;
		reason: string;
	};
	assert.equal(result.block, true);
	assert.match(result.reason, /git push --force/);
});

test("asks before a dangerous command and follows the answer", async () => {
	const pi = setup();
	const yes = fakeContext({ answers: ["Yes"] });
	assert.equal(await pi.emit("tool_call", bash("rm -rf build"), yes), undefined);
	assert.equal(yes.prompts.length, 1);

	const no = fakeContext({ answers: ["No"] });
	assert.deepEqual(await pi.emit("tool_call", bash("rm -rf build"), no), { block: true, reason: "Blocked by user." });
});

test("treats a dismissed dialog as a refusal", async () => {
	const result = await setup().emit("tool_call", bash("sudo ls"), fakeContext({ answers: [undefined as unknown as string] }));
	assert.deepEqual(result, { block: true, reason: "Blocked by user." });
});
