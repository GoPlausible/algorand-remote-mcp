import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import worker, { AlgorandRemoteMCP } from "../src/index";
import { registerKnowledgeResources, registerSkillResource } from "../src/resources";
import { categoryDisplayNames, categoryNames } from "../src/resources/knowledge";
import type { Env, Props } from "../src/types";
import { skill } from "../src/utils/Skill.js";

/**
 * Tests for Resources modules
 * Tests knowledge resource categories, taxonomy paths, and skill resource
 */

// src/index.ts pulls in modules Node cannot load: agents/mcp and src/oauth-provider import
// cloudflare:workers, and the receipt/ARC-90 tools import the @cf-wasm/photon wasm build.
vi.mock("agents/mcp", () => ({
	McpAgent: class {
		static mount(path: string, options: unknown) {
			return { path, options };
		}
	},
}));
vi.mock("../src/oauth-provider", () => ({
	default: class {
		options: unknown;
		constructor(options: unknown) {
			this.options = options;
		}
	},
}));
vi.mock("@cf-wasm/photon", () => ({}));

type ResourceResult = { contents: Array<{ uri: string; text: string }> };
type ResourceHandler = (uri: URL) => ResourceResult | Promise<ResourceResult>;
type RegisteredResource = { name: string; uri: string; handler: ResourceHandler };
type RegisterFn = (server: McpServer, env: Env, props: Props) => void;

// In-memory stand-in for the PLAUSIBLE_AI R2 bucket
function createBucket(store: Record<string, string> = {}) {
	return {
		get: vi.fn(async (key: string) => (key in store ? { text: async () => store[key] } : null)),
	};
}

// Registers the real resources on a stub server and returns them in registration order
function registerResources(
	register: RegisterFn,
	bucket?: ReturnType<typeof createBucket>,
): RegisteredResource[] {
	const resources: RegisteredResource[] = [];
	const server = {
		resource: (name: string, uri: string, handler: ResourceHandler) => {
			resources.push({ name, uri, handler });
		},
	};
	const env = (bucket ? { PLAUSIBLE_AI: bucket } : {}) as unknown as Env;
	register(server as unknown as McpServer, env, {} as Props);
	return resources;
}

async function readResource(resources: RegisteredResource[], uri: string): Promise<ResourceResult> {
	const resource = resources.find((r) => r.uri === uri);
	if (!resource) throw new Error(`Resource not registered: ${uri}`);
	return resource.handler(new URL(uri));
}

function createAgent(): AlgorandRemoteMCP {
	// McpAgent is mocked above; its real constructor is protected and needs a Durable Object
	return Reflect.construct(AlgorandRemoteMCP, []);
}

const oauthOptions = (worker as unknown as { options: Record<string, unknown> }).options;

describe("Knowledge Resources", () => {
	describe("Category names", () => {
		it("should have 12 categories", () => {
			expect(categoryNames).toHaveLength(12);
		});

		it("should include all expected categories", () => {
			expect(categoryNames).toContain("arcs");
			expect(categoryNames).toContain("sdks");
			expect(categoryNames).toContain("algokit");
			expect(categoryNames).toContain("developers");
			expect(categoryNames).toContain("python");
		});

		it("should not have duplicates", () => {
			const uniqueNames = [...new Set(categoryNames)];
			expect(uniqueNames).toHaveLength(categoryNames.length);
		});
	});

	describe("Category display names", () => {
		it("should have a display name for every category", () => {
			for (const cat of categoryNames) {
				expect(categoryDisplayNames[cat]).toBeDefined();
				expect(categoryDisplayNames[cat].length).toBeGreaterThan(0);
			}
		});

		it("should map arcs correctly", () => {
			expect(categoryDisplayNames.arcs).toBe("Algorand Request for Comments");
		});

		it("should map algokit-utils correctly", () => {
			expect(categoryDisplayNames["algokit-utils"]).toBe("AlgoKit Utils");
		});

		it("should register each category resource under its display name", () => {
			const resources = registerResources(registerKnowledgeResources);
			for (const cat of categoryNames) {
				const resource = resources.find(
					(r) => r.uri === `algorand://knowledge/taxonomy/${cat}`,
				);
				expect(resource?.name).toBe(categoryDisplayNames[cat]);
			}
		});
	});

	describe("R2 taxonomy path construction", () => {
		it("should build correct path for category", async () => {
			const bucket = createBucket();
			await readResource(
				registerResources(registerKnowledgeResources, bucket),
				"algorand://knowledge/taxonomy/arcs",
			);
			expect(bucket.get).toHaveBeenCalledWith("taxonomy-categories/arcs.json");
		});

		it("should handle hyphenated category names", async () => {
			const bucket = createBucket();
			await readResource(
				registerResources(registerKnowledgeResources, bucket),
				"algorand://knowledge/taxonomy/algokit-utils",
			);
			expect(bucket.get).toHaveBeenCalledWith("taxonomy-categories/algokit-utils.json");
		});

		it("should build paths for all categories", async () => {
			const bucket = createBucket();
			const resources = registerResources(registerKnowledgeResources, bucket);
			for (const cat of categoryNames) {
				await readResource(resources, `algorand://knowledge/taxonomy/${cat}`);
			}
			const paths = bucket.get.mock.calls.map(([path]) => path);
			expect(paths).toEqual(categoryNames.map((cat) => `taxonomy-categories/${cat}.json`));
			for (const path of paths) {
				expect(path).toMatch(/^taxonomy-categories\/.*\.json$/);
			}
		});

		it("should return the category JSON stored in R2", async () => {
			const arcs = { name: "arcs", documents: ["arcs:specs:arc-0020.md"] };
			const bucket = createBucket({ "taxonomy-categories/arcs.json": JSON.stringify(arcs) });
			const result = await readResource(
				registerResources(registerKnowledgeResources, bucket),
				"algorand://knowledge/taxonomy/arcs",
			);
			expect(result.contents[0].uri).toBe("algorand://knowledge/taxonomy/arcs");
			expect(JSON.parse(result.contents[0].text)).toEqual(arcs);
		});

		it("should report a missing category", async () => {
			const result = await readResource(
				registerResources(registerKnowledgeResources, createBucket()),
				"algorand://knowledge/taxonomy/puya",
			);
			expect(JSON.parse(result.contents[0].text)).toEqual({
				error: "Category data not found: puya",
			});
		});

		it("should load every category into the full taxonomy", async () => {
			const bucket = createBucket({
				"taxonomy-categories/sdks.json": JSON.stringify({ name: "sdks" }),
			});
			const result = await readResource(
				registerResources(registerKnowledgeResources, bucket),
				"algorand://knowledge/taxonomy",
			);
			expect(bucket.get).toHaveBeenCalledTimes(categoryNames.length);
			expect(JSON.parse(result.contents[0].text)).toEqual({
				categories: [{ name: "sdks" }],
			});
		});
	});

	describe("Resource URI patterns", () => {
		it("should use algorand:// scheme for taxonomy", () => {
			const uris = registerResources(registerKnowledgeResources).map((r) => r.uri);
			expect(uris).toContain("algorand://knowledge/taxonomy");
			for (const uri of uris) {
				expect(uri).toMatch(/^algorand:\/\//);
			}
		});

		it("should use algorand:// scheme for category resources", () => {
			const uris = registerResources(registerKnowledgeResources)
				.map((r) => r.uri)
				.filter((uri) => uri !== "algorand://knowledge/taxonomy");
			expect(uris).toEqual(
				categoryNames.map((cat) => `algorand://knowledge/taxonomy/${cat}`),
			);
			for (const uri of uris) {
				expect(uri).toMatch(/^algorand:\/\/knowledge\/taxonomy\/.+$/);
			}
		});

		it("should use algorand:// scheme for skill", () => {
			const [resource] = registerResources(registerSkillResource);
			expect(resource.uri).toMatch(/^algorand:\/\//);
		});
	});
});

describe("Skill Resource", () => {
	it("should have a fixed URI", () => {
		const resources = registerResources(registerSkillResource);
		expect(resources).toHaveLength(1);
		expect(resources[0].uri).toBe("algorand://remote-mcp-skill");
	});

	it("should have a name", () => {
		const [resource] = registerResources(registerSkillResource);
		expect(resource.name).toBe("Algorand MCP Skill");
	});

	it("should serve the skill text", async () => {
		const result = await readResource(
			registerResources(registerSkillResource),
			"algorand://remote-mcp-skill",
		);
		expect(result).toEqual({
			contents: [{ uri: "algorand://remote-mcp-skill", text: skill }],
		});
	});
});

describe("Index Module", () => {
	describe("MCP Server configuration", () => {
		async function getServerInfo() {
			const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
			const client = new Client({ name: "test-client", version: "0.0.0" });
			await Promise.all([
				createAgent().server.connect(serverTransport),
				client.connect(clientTransport),
			]);
			const info = client.getServerVersion();
			await client.close();
			return info;
		}

		it("should have correct server name", async () => {
			const info = await getServerInfo();
			expect(info?.name).toBe("Algorand Remote MCP");
		});

		it("should have correct version format", async () => {
			const info = await getServerInfo();
			expect(info?.version).toMatch(/^\d+\.\d+\.\d+$/);
		});
	});

	describe("Default state", () => {
		it("should have default items_per_page of 10", () => {
			const initialState = createAgent().initialState;
			expect(initialState.items_per_page).toBe(10);
		});
	});

	describe("OAuth provider paths", () => {
		it("should configure correct API route", () => {
			expect(oauthOptions.apiRoute).toBe("/sse");
		});

		it("should configure correct authorize endpoint", () => {
			expect(oauthOptions.authorizeEndpoint).toBe("/authorize");
		});

		it("should configure correct token endpoint", () => {
			expect(oauthOptions.tokenEndpoint).toBe("/token");
		});

		it("should configure correct client registration endpoint", () => {
			expect(oauthOptions.clientRegistrationEndpoint).toBe("/register");
		});

		it("should mount the MCP agent on the API route", () => {
			expect(oauthOptions.apiHandler).toEqual({
				path: "/sse",
				options: { binding: "AlgorandRemoteMCP" },
			});
		});
	});
});
