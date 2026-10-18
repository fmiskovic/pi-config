/**
 * Subagent Bash Guard
 *
 * Enforces the `bashAllow` list from an agent's frontmatter. The subagent
 * extension passes that list to the child pi process in the
 * PI_SUBAGENT_BASH_ALLOW environment variable; this extension runs in the
 * child and blocks every shell command that is not on it.
 *
 * Does nothing in a process where the variable is unset, so normal sessions
 * and unrestricted agents are unaffected.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { checkCommand, parseAllowList } from "./policy.ts";

export const BASH_ALLOW_ENV = "PI_SUBAGENT_BASH_ALLOW";

const SHELL_TOOLS = ["bash", "powershell"];

export default function (pi: ExtensionAPI) {
	const allowList = parseAllowList(process.env[BASH_ALLOW_ENV]);
	if (allowList === undefined) return;

	pi.on("tool_call", async (event) => {
		if (!SHELL_TOOLS.includes(event.toolName)) return undefined;

		const command = (event.input as { command?: unknown }).command;
		if (typeof command !== "string") {
			return { block: true, reason: "Blocked: shell command is missing or not a string." };
		}

		const result = checkCommand(command, allowList);
		return result.allowed ? undefined : { block: true, reason: result.reason ?? "Blocked by subagent bash guard." };
	});
}
