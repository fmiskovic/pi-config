/**
 * Secret Guard
 *
 * Asks before a tool call reads, writes, or prints secrets: dotenv files,
 * private keys, cloud and registry credentials, pi's own auth files, and
 * secret-looking environment variables. See policy.ts for what counts.
 *
 * Approvals can cover the rest of the session for the same secrets. With no
 * UI to ask (print mode, subagents), these calls are blocked.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { findSecretsInToolCall } from "./policy.ts";

const ALLOW_ONCE = "Allow once";
const ALLOW_SESSION = "Allow these for the rest of the session";
const BLOCK = "Block";

export default function (pi: ExtensionAPI) {
	let sessionAllowed: ReadonlySet<string> = new Set();

	pi.on("session_start", async () => {
		sessionAllowed = new Set();
	});

	pi.on("tool_call", async (event, ctx) => {
		const secrets = findSecretsInToolCall(event.toolName, event.input, ctx.cwd).filter((s) => !sessionAllowed.has(s));
		if (secrets.length === 0) return undefined;

		const list = secrets.map((s) => `  • ${s}`).join("\n");
		if (!ctx.hasUI) {
			return {
				block: true,
				reason: `Blocked: ${event.toolName} would read or expose secrets, and there is no UI to ask.\n${list}\nDo not try to read these another way. Ask the user for the specific non-secret value you need.`,
			};
		}

		const choice = await ctx.ui.select(`🔑 ${event.toolName} would touch secrets:\n\n${list}\n\nAllow?`, [
			ALLOW_ONCE,
			ALLOW_SESSION,
			BLOCK,
		]);
		if (choice === ALLOW_SESSION) sessionAllowed = new Set([...sessionAllowed, ...secrets]);
		if (choice === ALLOW_ONCE || choice === ALLOW_SESSION) return undefined;
		return {
			block: true,
			reason: "Blocked by user: the call would read or expose secrets. Do not try to read them another way.",
		};
	});
}
