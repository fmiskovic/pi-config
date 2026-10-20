/**
 * MCP Write Gate
 *
 * Asks for confirmation before any GitHub, GitLab, or Keycloak MCP tool call
 * that is not declared read-only (creating pull or merge requests, pushing or
 * deleting files, merging, deleting users, resetting passwords, and so on).
 * Read-only calls pass through.
 *
 * With no UI to ask (print mode, subagents), write calls are blocked.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describeCall, gatedServer, needsConfirmation } from "./policy.ts";

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		const annotations = pi.getAllTools().find((tool) => tool.name === event.toolName)?.annotations;
		if (!needsConfirmation(event.toolName, annotations)) return undefined;
		const server = gatedServer(event.toolName);

		if (!ctx.hasUI) {
			return { block: true, reason: `${event.toolName} writes to ${server} and was blocked (no UI for confirmation).` };
		}

		const approved = await ctx.ui.confirm(`Allow ${server} write?`, describeCall(event.toolName, event.input));
		return approved ? undefined : { block: true, reason: `${event.toolName} was not approved by the user.` };
	});
}
