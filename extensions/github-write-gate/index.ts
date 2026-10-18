/**
 * GitHub Write Gate
 *
 * Asks for confirmation before any GitHub MCP tool call that is not declared
 * read-only (creating pull requests, pushing or deleting files, merging,
 * commenting, and so on). Read-only calls pass through.
 *
 * With no UI to ask (print mode, subagents), write calls are blocked.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describeCall, needsConfirmation } from "./policy.ts";

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		const annotations = pi.getAllTools().find((tool) => tool.name === event.toolName)?.annotations;
		if (!needsConfirmation(event.toolName, annotations)) return undefined;

		if (!ctx.hasUI) {
			return { block: true, reason: `${event.toolName} writes to GitHub and was blocked (no UI for confirmation).` };
		}

		const approved = await ctx.ui.confirm("Allow GitHub write?", describeCall(event.toolName, event.input));
		return approved ? undefined : { block: true, reason: `${event.toolName} was not approved by the user.` };
	});
}
