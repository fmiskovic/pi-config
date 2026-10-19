import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createFakePi, fakeContext } from "../shared/fake-pi.ts";
import bashGuard, { BASH_ALLOW_ENV } from "./index.ts";

afterEach(() => {
	delete process.env[BASH_ALLOW_ENV];
});

const bash = (command: string) => ({ toolName: "bash", input: { command } });

test("does nothing when the process is not a restricted subagent", () => {
	const pi = createFakePi();
	bashGuard(pi.api);
	assert.deepEqual(pi.handledEvents(), []);
});

test("enforces the allow list from the environment", async () => {
	process.env[BASH_ALLOW_ENV] = "git status,go vet";
	const pi = createFakePi();
	bashGuard(pi.api);
	const ctx = fakeContext({ hasUI: false });

	assert.equal(await pi.emit("tool_call", bash("git status"), ctx), undefined);
	assert.equal(await pi.emit("tool_call", bash("go vet ./..."), ctx), undefined);
	assert.equal(((await pi.emit("tool_call", bash("rm -rf x"), ctx)) as { block: boolean }).block, true);
	assert.equal(((await pi.emit("tool_call", bash("go vet -vettool=x ./..."), ctx)) as { block: boolean }).block, true);
});

test("blocks a shell call with no command string", async () => {
	process.env[BASH_ALLOW_ENV] = "git status";
	const pi = createFakePi();
	bashGuard(pi.api);
	const result = (await pi.emit("tool_call", { toolName: "bash", input: {} }, fakeContext({ hasUI: false }))) as { block: boolean };
	assert.equal(result.block, true);
});

test("an empty allow list blocks every command", async () => {
	process.env[BASH_ALLOW_ENV] = "";
	const pi = createFakePi();
	bashGuard(pi.api);
	const result = (await pi.emit("tool_call", bash("git status"), fakeContext({ hasUI: false }))) as { block: boolean };
	assert.equal(result.block, true);
});
