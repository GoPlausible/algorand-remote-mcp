import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as algosdk from "algosdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { processTealSource, registerAlgodTools } from "../src/tools/algodManager";
// createAlgoClient is duplicated verbatim in algodManager.ts and every apiManager/algod module;
// the apiManager/algod/account.ts copy is the one exported and tested as their representative
// (algodManager.ts exports reach the src/tools/index.ts barrel, where a second one would clash).
import { createAlgoClient } from "../src/tools/apiManager/algod/account";
import type { Env, Props } from "../src/types";

/**
 * Tests for Algod Manager logic
 * Tests TEAL source processing, client creation, and transaction encoding
 */

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

// Registers the algod tools on a stand-in server and returns their handlers by name
function captureAlgodTools(env: Partial<Env>): Map<string, ToolHandler> {
	const handlers = new Map<string, ToolHandler>();
	const server = {
		tool: (name: string, _description: string, _schema: unknown, handler: ToolHandler) => {
			handlers.set(name, handler);
		},
	};
	registerAlgodTools(server as unknown as McpServer, env as Env, {} as Props);
	return handlers;
}

// Calls one algod tool with fetch stubbed and returns the single request it made
async function captureAlgodRequest(
	toolName: string,
	args: Record<string, unknown>,
	responseBody: unknown,
): Promise<{ url: URL; body: Uint8Array }> {
	const fetchMock = vi.fn(
		async (_url: string, _init?: RequestInit) =>
			new Response(JSON.stringify(responseBody), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
	);
	vi.stubGlobal("fetch", fetchMock);
	const handler = captureAlgodTools({ ALGORAND_ALGOD: "https://algod.example.test" }).get(
		toolName,
	);
	if (!handler) {
		throw new Error(`Tool ${toolName} was not registered`);
	}

	await handler(args);

	expect(fetchMock).toHaveBeenCalledTimes(1);
	const [url, init] = fetchMock.mock.calls[0];
	return { url: new URL(url), body: init?.body as Uint8Array };
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("Algod Manager", () => {
	describe("processTealSource", () => {
		it("should normalize CRLF to LF", () => {
			const source = "#pragma version 8\r\nint 1\r\nreturn\r\n";
			const result = processTealSource(source);
			expect(result).not.toContain("\r\n");
			expect(result).toContain("\n");
		});

		it("should add trailing newline if missing", () => {
			const source = "#pragma version 8\nint 1\nreturn";
			const result = processTealSource(source);
			expect(result.endsWith("\n")).toBe(true);
		});

		it("should not double-add trailing newline", () => {
			const source = "#pragma version 8\nint 1\nreturn\n";
			const result = processTealSource(source);
			expect(result).toBe(source);
			expect(result.endsWith("\n\n")).toBe(false);
		});

		it("should handle empty source", () => {
			const result = processTealSource("");
			expect(result).toBe("\n");
		});

		it("should handle already normalized source", () => {
			const source = "#pragma version 8\nint 1\n";
			expect(processTealSource(source)).toBe(source);
		});
	});

	describe("TEAL source encoding", () => {
		it("should encode source to Uint8Array", () => {
			const source = "#pragma version 8\nint 1\nreturn\n";
			const bytes = new TextEncoder().encode(source);
			expect(bytes).toBeInstanceOf(Uint8Array);
			expect(bytes.length).toBeGreaterThan(0);
		});

		it("should preserve content through encode/decode round-trip", () => {
			const source = "#pragma version 8\nint 1\nreturn\n";
			const bytes = new TextEncoder().encode(source);
			const decoded = new TextDecoder().decode(bytes);
			expect(decoded).toBe(source);
		});

		it("should compile the normalized source through sdk_compile_teal", async () => {
			const { url, body } = await captureAlgodRequest(
				"sdk_compile_teal",
				{ source: "#pragma version 8\r\nint 1\r\nreturn" },
				{ hash: "TESTHASH", result: "CIEB" },
			);
			expect(url.pathname).toBe("/v2/teal/compile");
			expect(new TextDecoder().decode(body)).toBe("#pragma version 8\nint 1\nreturn\n");
		});
	});

	describe("createAlgoClient guard", () => {
		it("should return null for empty URL", () => {
			expect(createAlgoClient("", "token")).toBeNull();
		});

		it("should return Algodv2 instance for valid URL", () => {
			const client = createAlgoClient("https://testnet-api.algonode.cloud", "");
			expect(client).toBeDefined();
			expect(client).not.toBeNull();
			expect(client).toBeInstanceOf(algosdk.Algodv2);
		});

		// algodManager.ts checks env.ALGORAND_ALGOD before calling its own createAlgoClient,
		// so an empty URL returns this message and never reaches "Failed to create Algorand client"
		it("should make every algod tool report an unconfigured node URL without a request", async () => {
			const fetchMock = vi.fn();
			vi.stubGlobal("fetch", fetchMock);
			const handlers = captureAlgodTools({ ALGORAND_ALGOD: "" });
			const calls: Array<[string, Record<string, unknown>]> = [
				["sdk_compile_teal", { source: "#pragma version 8\nint 1\n" }],
				["sdk_disassemble_teal", { bytecode: "BoEB" }],
				["sdk_send_raw_transaction", { signedTxns: ["dGVzdDE="] }],
			];
			for (const [toolName, args] of calls) {
				const handler = handlers.get(toolName);
				expect(handler).toBeDefined();
				await expect(handler?.(args)).resolves.toEqual({
					content: [{ type: "text", text: "Algorand node URL not configured" }],
				});
			}
			expect(fetchMock).not.toHaveBeenCalled();
		});
	});

	describe("Base64 transaction encoding for sendRawTransaction", () => {
		it("should decode base64 to Buffer", () => {
			const base64Data = Buffer.from("hello world").toString("base64");
			const decoded = Buffer.from(base64Data, "base64");
			expect(decoded.toString()).toBe("hello world");
		});

		it("should handle array of base64 transactions", () => {
			const txns = ["dGVzdDE=", "dGVzdDI=", "dGVzdDM="]; // test1, test2, test3
			const decoded = txns.map((txn) => Buffer.from(txn, "base64"));
			expect(decoded).toHaveLength(3);
			expect(decoded[0].toString()).toBe("test1");
			expect(decoded[1].toString()).toBe("test2");
			expect(decoded[2].toString()).toBe("test3");
		});

		it("should submit the decoded transactions through sdk_send_raw_transaction", async () => {
			const { url, body } = await captureAlgodRequest(
				"sdk_send_raw_transaction",
				{ signedTxns: ["dGVzdDE=", "dGVzdDI="] },
				{ txId: "TESTTXID" },
			);
			expect(url.pathname).toBe("/v2/transactions");
			expect(Buffer.from(body).toString()).toBe("test1test2");
		});
	});

	describe("Bytecode disassembly input processing", () => {
		it("should decode base64 bytecode to bytes", () => {
			const base64Bytecode = Buffer.from([0x06, 0x81, 0x01]).toString("base64");
			const bytecodeBytes = Buffer.from(base64Bytecode, "base64");
			expect(bytecodeBytes).toBeInstanceOf(Buffer);
			expect(bytecodeBytes[0]).toBe(0x06);
			expect(bytecodeBytes[1]).toBe(0x81);
			expect(bytecodeBytes[2]).toBe(0x01);
		});

		it("should send the decoded bytecode through sdk_disassemble_teal", async () => {
			const { url, body } = await captureAlgodRequest(
				"sdk_disassemble_teal",
				{ bytecode: Buffer.from([0x06, 0x81, 0x01]).toString("base64") },
				{ result: "#pragma version 6\npushint 1\n" },
			);
			expect(url.pathname).toBe("/v2/teal/disassemble");
			expect(Array.from(body)).toEqual([0x06, 0x81, 0x01]);
		});
	});
});
