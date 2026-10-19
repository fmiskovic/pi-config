/**
 * A minimal stand-in for pi's ExtensionAPI and context, for testing how an
 * extension wires itself up: which events it handles and what its handlers
 * return. Test-only; not loaded by pi (this directory has no index.ts).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type Handler = (event: unknown, ctx: unknown) => unknown;

export interface FakeTool {
	readonly name: string;
	readonly annotations?: Record<string, unknown>;
}

export interface ExecResult {
	readonly stdout: string;
	readonly stderr: string;
	readonly code: number;
}

export interface FakePiOptions {
	readonly tools?: readonly FakeTool[];
	readonly exec?: (command: string, args: readonly string[]) => ExecResult;
}

export interface FakePi {
	readonly api: ExtensionAPI;
	/** Run every handler for the event in order, returning the first non-undefined result. */
	emit(event: string, payload: Record<string, unknown>, ctx: FakeContext): Promise<unknown>;
	readonly handledEvents: () => string[];
	readonly registeredTools: () => string[];
}

export interface FakeContext {
	readonly hasUI: boolean;
	readonly cwd: string;
	readonly ui: {
		select(title: string, options: string[]): Promise<string | undefined>;
		confirm(title: string, message: string): Promise<boolean>;
		notify(message: string, type?: string): void;
	};
	/** Every dialog title shown, in order. */
	readonly prompts: string[];
}

/** A context whose dialogs answer with `answers`, in order. */
export function fakeContext(options: { hasUI?: boolean; cwd?: string; answers?: readonly (string | boolean)[] } = {}): FakeContext {
	const answers = [...(options.answers ?? [])];
	const prompts: string[] = [];
	const next = (title: string) => {
		prompts.push(title);
		if (answers.length === 0) throw new Error(`Unexpected dialog: ${title}`);
		return answers.shift();
	};
	return {
		hasUI: options.hasUI ?? true,
		cwd: options.cwd ?? "/work",
		prompts,
		ui: {
			select: async (title) => next(title) as string | undefined,
			confirm: async (title) => next(title) as boolean,
			notify: () => undefined,
		},
	};
}

export function createFakePi(options: FakePiOptions = {}): FakePi {
	const handlers = new Map<string, Handler[]>();
	const tools: string[] = [];
	const known: Record<string, unknown> = {
		on: (event: string, handler: Handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
		getAllTools: () => options.tools ?? [],
		exec: async (command: string, args: readonly string[]) =>
			options.exec?.(command, args) ?? { stdout: "", stderr: "", code: 0 },
		registerTool: (tool: { name: string }) => tools.push(tool.name),
	};
	// Any other API method is accepted and ignored, so loading never fails on an unused method.
	const api = new Proxy(known, { get: (target, name) => target[name as string] ?? (() => undefined) });

	return {
		api: api as unknown as ExtensionAPI,
		async emit(event, payload, ctx) {
			for (const handler of handlers.get(event) ?? []) {
				const result = await handler({ type: event, ...payload }, ctx);
				if (result !== undefined) return result;
			}
			return undefined;
		},
		handledEvents: () => [...handlers.keys()],
		registeredTools: () => [...tools],
	};
}
