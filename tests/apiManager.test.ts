import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as algosdk from "algosdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
// createAlgoClient is duplicated verbatim in algodManager.ts and every apiManager/algod module;
// the apiManager/algod/account.ts copy is the one exported and tested as their representative.
import { createAlgoClient } from "../src/tools/apiManager/algod/account";
import {
	processGlobalStateItem,
	registerApplicationApiTools,
} from "../src/tools/apiManager/algod/application";
import {
	getAssetsByAssetId,
	getAssetsByCreatorAddress,
	getAssetsByName,
	getAssetsByUnitName,
	registerAssetApiTools,
} from "../src/tools/apiManager/algod/asset";
// createIndexerClient is duplicated verbatim in every apiManager/indexer module;
// the indexer/account.ts copy is the one exported and tested as their representative.
import { createIndexerClient } from "../src/tools/apiManager/indexer/account";
import { registerIndexerTransactionTools } from "../src/tools/apiManager/indexer/transaction";
import { buildNfdAddressUrl, buildNfdUrl } from "../src/tools/apiManager/nfd";
import type { Env } from "../src/types";

/**
 * Tests for API Manager modules
 * Tests client creation, URL construction for algod/indexer/NFD, and address validation
 */

type ToolResult = { content: { type: string; text: string }[] };
type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;
type CapturedTool = { schema: Record<string, z.ZodTypeAny>; handler: ToolHandler };

// Registers a module's tools on a stand-in server and returns them by name
function captureTools(
	register: (server: McpServer, env: Env) => void,
	env: Partial<Env>,
): Map<string, CapturedTool> {
	const tools = new Map<string, CapturedTool>();
	const server = {
		tool: (
			name: string,
			_description: string,
			schema: Record<string, z.ZodTypeAny>,
			handler: ToolHandler,
		) => {
			tools.set(name, { schema, handler });
		},
	};
	register(server as unknown as McpServer, env as Env);
	return tools;
}

function getTool(tools: Map<string, CapturedTool>, name: string): CapturedTool {
	const tool = tools.get(name);
	if (!tool) {
		throw new Error(`Tool ${name} was not registered`);
	}
	return tool;
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

// In-memory stand-in for the VERIFIED_ASSETS KV namespace
function fakeKv(entries: Record<string, unknown>) {
	return {
		list: vi.fn(async ({ prefix }: { prefix: string }) => ({
			keys: Object.keys(entries)
				.filter((name) => name.startsWith(prefix))
				.map((name) => ({ name })),
		})),
		get: vi.fn(async (key: string) => (key in entries ? JSON.stringify(entries[key]) : null)),
	};
}

function envWithKv(kv: ReturnType<typeof fakeKv>): Env {
	return { VERIFIED_ASSETS: kv } as unknown as Env;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("API Manager - Algod Client", () => {
	describe("createAlgoClient", () => {
		it("should return null for empty URL", () => {
			expect(createAlgoClient("", "")).toBeNull();
		});

		it("should create Algodv2 for valid URL", () => {
			const client = createAlgoClient("https://testnet-api.algonode.cloud", "");
			expect(client).not.toBeNull();
			expect(client).toBeInstanceOf(algosdk.Algodv2);
		});

		it("should accept token parameter", () => {
			const client = createAlgoClient("https://testnet-api.algonode.cloud", "my-token");
			expect(client).not.toBeNull();
		});
	});
});

describe("API Manager - Indexer Client", () => {
	describe("createIndexerClient", () => {
		it("should return null for undefined URL", () => {
			expect(createIndexerClient(undefined)).toBeNull();
		});

		it("should return null for empty string URL", () => {
			expect(createIndexerClient("")).toBeNull();
		});

		it("should create Indexer for valid URL", () => {
			const client = createIndexerClient("https://testnet-idx.algonode.cloud");
			expect(client).not.toBeNull();
			expect(client).toBeInstanceOf(algosdk.Indexer);
		});
	});
});

describe("API Manager - NFD URL Construction", () => {
	const apiBase = "https://api.nf.domains";

	describe("buildNfdUrl", () => {
		it("should build basic NFD lookup URL", () => {
			const url = buildNfdUrl(apiBase, "example.algo");
			expect(url).toBe("https://api.nf.domains/nfd/example.algo");
		});

		it("should lowercase the name", () => {
			const url = buildNfdUrl(apiBase, "EXAMPLE.ALGO");
			expect(url).toBe("https://api.nf.domains/nfd/example.algo");
		});

		it("should add view=brief parameter", () => {
			const url = buildNfdUrl(apiBase, "test.algo", "brief");
			expect(url).toContain("view=brief");
		});

		it("should add includeSales parameter", () => {
			const url = buildNfdUrl(apiBase, "test.algo", undefined, true);
			expect(url).toContain("includeSales=true");
		});

		it("should combine view and includeSales", () => {
			const url = buildNfdUrl(apiBase, "test.algo", "brief", true);
			expect(url).toContain("view=brief");
			expect(url).toContain("includeSales=true");
		});

		it("should encode special characters in name", () => {
			const url = buildNfdUrl(apiBase, "test name.algo");
			expect(url).toContain("test%20name.algo");
		});

		it("should not add a view parameter for the full view", () => {
			const url = buildNfdUrl(apiBase, "test.algo", "full");
			expect(url).toBe("https://api.nf.domains/nfd/test.algo");
		});
	});

	describe("buildNfdAddressUrl", () => {
		const validAddr = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";

		it("should build NFD address lookup URL", () => {
			const url = buildNfdAddressUrl(apiBase, validAddr, 50, 0);
			expect(url).toContain(`/nfd/address/${validAddr}`);
			expect(url).toContain("limit=50");
			expect(url).toContain("offset=0");
		});

		it("should include view parameter", () => {
			const url = buildNfdAddressUrl(apiBase, validAddr, 50, 0, "full");
			expect(url).toContain("view=full");
		});

		it("should support pagination offset", () => {
			const url = buildNfdAddressUrl(apiBase, validAddr, 10, 20);
			expect(url).toContain("limit=10");
			expect(url).toContain("offset=20");
		});
	});
});

describe("API Manager - Algod Application", () => {
	describe("Box name encoding", () => {
		it("should encode box name as UTF-8 bytes", () => {
			const name = "mybox";
			const bytes = new TextEncoder().encode(name);
			expect(bytes).toBeInstanceOf(Uint8Array);
			expect(bytes.length).toBe(5);
		});

		it("should handle empty box name", () => {
			const bytes = new TextEncoder().encode("");
			expect(bytes.length).toBe(0);
		});

		it("should request the box by its UTF-8 encoded name", async () => {
			const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
				jsonResponse({ name: "bXlib3g=", round: 1, value: "aGVsbG8=" }),
			);
			vi.stubGlobal("fetch", fetchMock);
			const tools = captureTools(registerApplicationApiTools, {
				ALGORAND_ALGOD: "https://algod.example.test",
			});

			await getTool(tools, "algod_get_application_box_value").handler({
				appId: 123,
				name: "mybox",
			});

			expect(fetchMock).toHaveBeenCalledTimes(1);
			const url = new URL(fetchMock.mock.calls[0][0]);
			expect(url.pathname).toBe("/v2/applications/123/box");
			expect(url.searchParams.get("name")).toBe(
				`b64:${Buffer.from("mybox").toString("base64")}`,
			);
		});
	});

	describe("Global state processing", () => {
		it("should decode base64 key to UTF-8", () => {
			const base64Key = Buffer.from("mykey").toString("base64");
			const key = Buffer.from(base64Key, "base64").toString("utf-8");
			expect(key).toBe("mykey");

			const processed = processGlobalStateItem({
				key: base64Key,
				value: { type: 2, uint: 0 },
			});
			expect(processed.key).toBe("mykey");
			expect(processed.keyAsBase64).toBe(base64Key);
		});

		it("should identify bytes type (type=1)", () => {
			const value = { type: 1, bytes: Buffer.from("hello").toString("base64") };
			expect(value.type).toBe(1);
			const decoded = Buffer.from(value.bytes, "base64").toString("utf-8");
			expect(decoded).toBe("hello");

			const processed = processGlobalStateItem({
				key: Buffer.from("greeting").toString("base64"),
				value,
			});
			expect(processed.value).toEqual({ raw: value.bytes, asString: "hello", type: "bytes" });
		});

		it("should identify uint type (type!=1)", () => {
			const value = { type: 2, uint: 42 };
			expect(value.type).not.toBe(1);
			expect(value.uint).toBe(42);

			const processed = processGlobalStateItem({
				key: Buffer.from("counter").toString("base64"),
				value,
			});
			expect(processed).toEqual({
				key: "counter",
				keyAsBase64: Buffer.from("counter").toString("base64"),
				value: { raw: 42, type: "uint" },
			});
		});
	});
});

describe("API Manager - Algod Asset", () => {
	describe("Address validation", () => {
		it("should validate correct Algorand address", () => {
			const account = algosdk.generateAccount();
			expect(algosdk.isValidAddress(account.addr.toString())).toBe(true);
		});

		it("should reject invalid address", () => {
			expect(algosdk.isValidAddress("invalid")).toBe(false);
		});
	});

	describe("Pera API URL construction", () => {
		const assetId = 31566704;

		it("should build verification endpoint URL", async () => {
			const fetchMock = vi.fn(async (_url: string) =>
				jsonResponse({
					asset_id: assetId,
					verification_tier: "verified",
					explorer_url: `https://explorer.perawallet.app/asset/${assetId}/`,
				}),
			);
			vi.stubGlobal("fetch", fetchMock);
			const tools = captureTools(registerAssetApiTools, {});

			await getTool(tools, "pera_asset_verification_status").handler({ assetId });

			const url = fetchMock.mock.calls[0][0];
			expect(url).toBe(
				"https://mainnet.api.perawallet.app/v1/public/asset-verifications/31566704/",
			);
		});

		it("should build asset details endpoint URL", async () => {
			const fetchMock = vi.fn(async (_url: string) => jsonResponse({ asset_id: assetId }));
			vi.stubGlobal("fetch", fetchMock);
			const tools = captureTools(registerAssetApiTools, {});

			await getTool(tools, "pera_verified_asset_details").handler({ assetId });

			const url = fetchMock.mock.calls[0][0];
			expect(url).toBe("https://mainnet.api.perawallet.app/v1/public/assets/31566704/");
		});

		it("should build explorer URL", async () => {
			vi.stubGlobal(
				"fetch",
				vi.fn(async () => jsonResponse({ detail: "Not found." }, 404)),
			);
			const tools = captureTools(registerAssetApiTools, {});

			const result = await getTool(tools, "pera_asset_verification_status").handler({
				assetId,
			});

			const url = JSON.parse(result.content[0].text).data.explorer_url;
			expect(url).toBe("https://explorer.perawallet.app/asset/31566704/");
		});
	});
});

describe("API Manager - Indexer Transactions", () => {
	describe("Note prefix encoding", () => {
		it("should decode base64 note prefix to buffer", () => {
			const notePrefix = Buffer.from("test").toString("base64");
			const decoded = Buffer.from(notePrefix, "base64");
			expect(decoded.toString()).toBe("test");
		});

		it("should pass the note prefix, and the address role only with an address, to the search", async () => {
			const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
				jsonResponse({ "current-round": 1, transactions: [] }),
			);
			vi.stubGlobal("fetch", fetchMock);
			const tools = captureTools(registerIndexerTransactionTools, {
				ALGORAND_INDEXER: "https://indexer.example.test",
			});
			const search = getTool(tools, "indexer_search_for_transactions").handler;
			const address = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";
			const notePrefix = Buffer.from("test").toString("base64");

			await search({ notePrefix, address, addressRole: "sender" });
			await search({ addressRole: "receiver" });

			expect(fetchMock).toHaveBeenCalledTimes(2);
			const withAddress = new URL(fetchMock.mock.calls[0][0]);
			expect(withAddress.pathname).toBe("/v2/transactions");
			expect(withAddress.searchParams.get("note-prefix")).toBe(notePrefix);
			expect(withAddress.searchParams.get("address")).toBe(address);
			expect(withAddress.searchParams.get("address-role")).toBe("sender");
			const withoutAddress = new URL(fetchMock.mock.calls[1][0]);
			expect(withoutAddress.searchParams.has("address-role")).toBe(false);
		});
	});

	describe("Address role enum values", () => {
		it("should support sender, receiver, freeze-target", () => {
			const tools = captureTools(registerIndexerTransactionTools, {});
			const addressRole = getTool(tools, "indexer_search_for_transactions").schema
				.addressRole as z.ZodOptional<z.ZodEnum<[string, ...string[]]>>;
			const roles = addressRole.unwrap().options;
			expect(roles).toContain("sender");
			expect(roles).toContain("receiver");
			expect(roles).toContain("freeze-target");
			expect(roles).toEqual(["sender", "receiver", "freeze-target"]);
		});
	});
});

describe("API Manager - Asset KV key patterns", () => {
	const usdc = { asset_id: 31566704, name: "USDC", unit_name: "USDC" };

	it("should construct name-based key", async () => {
		const kv = fakeKv({ "key-USDC-31566704": usdc });
		const assets = await getAssetsByName("USDC", envWithKv(kv));
		expect(kv.list).toHaveBeenCalledWith({ prefix: "key-USDC-" });
		expect(assets).toEqual([usdc]);
	});

	it("should construct ID-based key", async () => {
		const kv = fakeKv({ "id-31566704": usdc });
		const asset = await getAssetsByAssetId(31566704, envWithKv(kv));
		expect(kv.get).toHaveBeenCalledWith("id-31566704");
		expect(asset).toEqual(usdc);
	});

	it("should construct creator-based key", async () => {
		const kv = fakeKv({ "creator-ADDR123-31566704": usdc });
		const assets = await getAssetsByCreatorAddress("ADDR123", envWithKv(kv));
		expect(kv.list).toHaveBeenCalledWith({ prefix: "creator-ADDR123-" });
		expect(assets).toEqual([usdc]);
	});

	it("should construct unit-based key", async () => {
		const kv = fakeKv({ "unit-USDC-31566704": usdc });
		const assets = await getAssetsByUnitName("USDC", envWithKv(kv));
		expect(kv.list).toHaveBeenCalledWith({ prefix: "unit-USDC-" });
		expect(assets).toEqual([usdc]);
	});

	it("should return null for an asset ID that is not stored", async () => {
		const kv = fakeKv({});
		expect(await getAssetsByAssetId(1, envWithKv(kv))).toBeNull();
	});

	it("should throw when the VERIFIED_ASSETS binding is missing", async () => {
		const env = {} as Env;
		await expect(getAssetsByName("USDC", env)).rejects.toThrow("Asset name is required");
		await expect(getAssetsByAssetId(31566704, env)).rejects.toThrow("Asset ID is required");
		await expect(getAssetsByCreatorAddress("ADDR123", env)).rejects.toThrow(
			"Creator address is required",
		);
		await expect(getAssetsByUnitName("USDC", env)).rejects.toThrow("Unit name is required");
	});
});
