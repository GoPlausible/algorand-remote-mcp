import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import {
	docKeyToR2Key,
	r2KeyToDocKey,
	registerKnowledgeTools,
} from "../src/tools/knowledgeManager";
import type { Env, Props } from "../src/types";

/**
 * Tests for Knowledge Manager logic
 * Tests R2 key formatting, document key conversion, and category listing
 */

type ToolResult = { content: Array<{ type: string; text: string }> };
type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

type R2Listing = {
	objects: Array<{ key: string; size: number; uploaded: Date }>;
	delimitedPrefixes: string[];
};

// In-memory stand-in for the PLAUSIBLE_AI R2 bucket
function createBucket(
	store: Record<string, string> = {},
	listing: R2Listing = { objects: [], delimitedPrefixes: [] },
) {
	return {
		get: vi.fn(async (key: string) => (key in store ? { text: async () => store[key] } : null)),
		list: vi.fn(async (_options: { prefix: string; delimiter: string }) => listing),
	};
}

// Registers the real knowledge tools on a stub server and returns their handlers by name
function registerTools(bucket?: ReturnType<typeof createBucket>): Map<string, ToolHandler> {
	const handlers = new Map<string, ToolHandler>();
	const server = {
		tool: (name: string, _description: string, _schema: unknown, handler: ToolHandler) => {
			handlers.set(name, handler);
		},
	};
	const env = (bucket ? { PLAUSIBLE_AI: bucket } : {}) as unknown as Env;
	registerKnowledgeTools(server as unknown as McpServer, env, {} as Props);
	return handlers;
}

async function callTool(
	handlers: Map<string, ToolHandler>,
	name: string,
	args: Record<string, unknown>,
): Promise<ToolResult> {
	const handler = handlers.get(name);
	if (!handler) throw new Error(`Tool not registered: ${name}`);
	return handler(args);
}

async function getDefaultCategories(
	toolName: string,
	args: Record<string, unknown>,
): Promise<Record<string, string>> {
	const result = await callTool(registerTools(), toolName, args);
	return JSON.parse(result.content[0].text);
}

describe("Knowledge Manager", () => {
	describe("docKeyToR2Key", () => {
		it("should convert colons to forward slashes", () => {
			// The source also lower-cases the key for case-insensitive lookups
			expect(docKeyToR2Key("ARCs:specs:arc-0020.md")).toBe("arcs/specs/arc-0020.md");
		});

		it("should handle single segment (no colons)", () => {
			expect(docKeyToR2Key("readme.md")).toBe("readme.md");
		});

		it("should handle deeply nested keys", () => {
			expect(docKeyToR2Key("a:b:c:d:e.md")).toBe("a/b/c/d/e.md");
		});

		it("should handle empty string", () => {
			expect(docKeyToR2Key("")).toBe("");
		});
	});

	describe("r2KeyToDocKey", () => {
		it("should convert forward slashes to colons", () => {
			expect(r2KeyToDocKey("ARCs/specs/arc-0020.md")).toBe("ARCs:specs:arc-0020.md");
		});

		it("should strip taxonomy/ prefix", () => {
			expect(r2KeyToDocKey("taxonomy/ARCs/specs/arc-0020.md")).toBe("ARCs:specs:arc-0020.md");
		});

		it("should handle key without taxonomy prefix", () => {
			expect(r2KeyToDocKey("sdks/python/readme.md")).toBe("sdks:python:readme.md");
		});
	});

	describe("R2 key round-trip", () => {
		it("should convert back to original doc key", () => {
			const docKey = "ARCs:specs:arc-0020.md";
			const r2Key = docKeyToR2Key(docKey);
			// docKeyToR2Key lower-cases, so a mixed-case key comes back lower-cased
			expect(r2KeyToDocKey(r2Key)).toBe("arcs:specs:arc-0020.md");
			expect(r2KeyToDocKey(docKeyToR2Key("arcs:specs:arc-0020.md"))).toBe(
				"arcs:specs:arc-0020.md",
			);
		});
	});

	describe("R2 prefix extraction", () => {
		it("should extract first segment for listing", async () => {
			const bucket = createBucket();
			await callTool(registerTools(bucket), "get_knowledge_doc", {
				documents: ["ARCs:specs:arc-0020.md"],
			});
			expect(bucket.get).toHaveBeenCalledWith("arcs/specs/arc-0020.md");
			expect(bucket.list).toHaveBeenCalledWith({ prefix: "arcs", delimiter: "/" });
		});

		it("should handle single-segment keys", async () => {
			const bucket = createBucket();
			await callTool(registerTools(bucket), "get_knowledge_doc", {
				documents: ["readme.md"],
			});
			expect(bucket.list).toHaveBeenCalledWith({ prefix: "readme.md", delimiter: "/" });
		});
	});

	describe("Default categories", () => {
		it("should contain all expected categories", async () => {
			const defaultCategories = await getDefaultCategories("list_knowledge_docs", {
				prefix: "",
			});
			expect(Object.keys(defaultCategories)).toContain("arcs");
			expect(Object.keys(defaultCategories)).toContain("sdks");
			expect(Object.keys(defaultCategories)).toContain("algokit");
			expect(Object.keys(defaultCategories)).toContain("developers");
		});

		it("should have 12 categories", async () => {
			const defaultCategories = await getDefaultCategories("list_knowledge_docs", {
				prefix: "",
			});
			expect(Object.keys(defaultCategories)).toHaveLength(12);
		});

		it("should have non-empty descriptions", async () => {
			const defaultCategories = await getDefaultCategories("list_knowledge_docs", {
				prefix: "",
			});
			for (const desc of Object.values(defaultCategories)) {
				expect(desc.length).toBeGreaterThan(0);
			}
		});

		it("should return the same categories from search with an empty query", async () => {
			expect(await getDefaultCategories("search", { query: "" })).toEqual(
				await getDefaultCategories("list_knowledge_docs", { prefix: "" }),
			);
		});
	});

	describe("Document key format validation", () => {
		it("should accept valid document key format", () => {
			const validKeys = [
				"ARCs:specs:arc-0020.md",
				"sdks:python:readme.md",
				"algokit:overview.md",
			];
			for (const key of validKeys) {
				// Valid keys convert cleanly to R2 paths
				const r2Key = docKeyToR2Key(key);
				expect(r2Key).not.toContain(":");
				expect(r2Key).toContain("/");
			}
		});
	});

	describe("Tool handlers", () => {
		it("get_knowledge_doc should read the converted R2 key", async () => {
			const bucket = createBucket({ "arcs/specs/arc-0020.md": "# ARC-20 test content" });
			const result = await callTool(registerTools(bucket), "get_knowledge_doc", {
				documents: ["ARCs:specs:arc-0020.md"],
			});
			expect(bucket.get).toHaveBeenCalledWith("arcs/specs/arc-0020.md");
			expect(bucket.list).not.toHaveBeenCalled();
			expect(result.content[0].text).toContain("# ARC-20 test content");
		});

		it("list_knowledge_docs should convert listed R2 keys to document keys", async () => {
			const bucket = createBucket(
				{},
				{
					objects: [
						{
							key: "taxonomy/arcs/specs/arc-0020.md",
							size: 42,
							uploaded: new Date("2024-01-01T00:00:00.000Z"),
						},
					],
					delimitedPrefixes: ["taxonomy/arcs/specs/"],
				},
			);
			const result = await callTool(registerTools(bucket), "list_knowledge_docs", {
				prefix: "ARCs:specs:",
			});
			expect(bucket.list).toHaveBeenCalledWith({ prefix: "arcs/specs/", delimiter: "/" });
			expect(JSON.parse(result.content[0].text)).toEqual({
				files: [
					{
						key: "arcs:specs:arc-0020.md",
						size: 42,
						uploaded: "2024-01-01T00:00:00.000Z",
					},
				],
				commonPrefixes: ["arcs:specs:"],
			});
		});
	});
});
