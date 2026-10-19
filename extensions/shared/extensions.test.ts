/**
 * Loads every extension the way pi does (the default export, called with the
 * API) and checks what each one registers. Catches extensions that throw on
 * load or stop listening to the events they depend on.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import dirtyRepoGuard from "../dirty-repo-guard.ts";
import githubWriteGate from "../github-write-gate/index.ts";
import permissionGate from "../permission-gate/index.ts";
import secretGuard from "../secret-guard/index.ts";
import subagent from "../subagent/index.ts";
import { createFakePi, fakeContext } from "./fake-pi.ts";

const EXPECTED_EVENTS = {
	"dirty-repo-guard": [dirtyRepoGuard, ["session_before_switch", "session_before_fork"]],
	"github-write-gate": [githubWriteGate, ["tool_call"]],
	"permission-gate": [permissionGate, ["tool_call"]],
	"secret-guard": [secretGuard, ["session_start", "tool_call"]],
} as const;

for (const [name, [extension, events]] of Object.entries(EXPECTED_EVENTS)) {
	test(`${name} loads and handles ${events.join(", ")}`, () => {
		const pi = createFakePi();
		extension(pi.api);
		assert.deepEqual(pi.handledEvents().sort(), [...events].sort());
	});
}

test("subagent loads and registers the subagent tool", () => {
	const pi = createFakePi();
	subagent(pi.api);
	assert.deepEqual(pi.registeredTools(), ["subagent"]);
});

test("dirty-repo-guard asks only when the tree has uncommitted changes", async () => {
	const clean = createFakePi({ exec: () => ({ stdout: "", stderr: "", code: 0 }) });
	dirtyRepoGuard(clean.api);
	assert.equal(await clean.emit("session_before_fork", {}, fakeContext()), undefined);

	const dirty = createFakePi({ exec: () => ({ stdout: " M a.ts\n", stderr: "", code: 0 }) });
	dirtyRepoGuard(dirty.api);
	assert.deepEqual(await dirty.emit("session_before_fork", {}, fakeContext({ hasUI: false })), { cancel: true });
	assert.equal(await dirty.emit("session_before_fork", {}, fakeContext({ answers: ["Yes, proceed anyway"] })), undefined);
});
