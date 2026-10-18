/**
 * Permission Gate
 *
 * Asks for confirmation before shell commands that are hard to undo:
 * recursive deletes, privilege escalation, force pushes, discarding local git
 * changes, piping downloads into a shell, raw disk writes, and destructive
 * infrastructure or GitHub commands. See policy.ts for the full list.
 *
 * With no UI to ask (print mode, subagents), these commands are blocked.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { findDangers } from "./policy.ts";

const SHELL_TOOLS = ["bash"];

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		if (!SHELL_TOOLS.includes(event.toolName)) return undefined;

		const command = (event.input as { command?: unknown }).command;
		if (typeof command !== "string") return undefined;

		const dangers = findDangers(command);
		if (dangers.length === 0) return undefined;

		const list = dangers.map((d) => `  • ${d}`).join("\n");
		if (!ctx.hasUI) {
			return {
				block: true,
				reason: `Blocked: this command needs user confirmation and there is no UI to ask.\n${list}\nAsk the user to run it themselves if it is needed.`,
			};
		}

		const choice = await ctx.ui.select(`⚠️ Dangerous command:\n\n  ${command}\n\n${list}\n\nAllow?`, ["Yes", "No"]);
		return choice === "Yes" ? undefined : { block: true, reason: "Blocked by user." };
	});
}
