import { describe, expect, it, vi } from "vitest";
import {
	determineQrUriType,
	determineUriType,
	generateAlgorandUri,
	registerArc26Tools,
} from "../src/tools/arc26Manager";
import type { Env, Props } from "../src/types";

// @cf-wasm/photon's default (workers) entry loads its wasm through an ESM import Node cannot
// resolve; point it at the library's own Node build so arc26Manager can be imported.
vi.mock("@cf-wasm/photon", () => import("@cf-wasm/photon/node"));

/**
 * Tests for ARC-26 URI generation logic (generateAlgorandUri) and the URI type
 * reported by the generate_algorand_uri and generate_algorand_qrcode tools
 */

type ToolResult = { content: { type: string; text: string }[] };
type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

function arc26Tools(env: Partial<Env>): Record<string, ToolHandler> {
	const tools: Record<string, ToolHandler> = {};
	const server = {
		tool: (name: string, _description: string, _schema: unknown, handler: ToolHandler) => {
			tools[name] = handler;
		},
	};
	const props = { provider: "google", email: "agent-owner@example.com" } as Props;
	registerArc26Tools(server as any, env as Env, props);
	return tools;
}

describe("ARC-26 URI Generation", () => {
	// Valid Algorand address for testing (58 chars, base32)
	const validAddress = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";

	describe("generateAlgorandUri", () => {
		it("should generate a basic account URI", () => {
			const uri = generateAlgorandUri(validAddress);
			expect(uri).toBe(`algorand://${validAddress}`);
		});

		it("should include label parameter", () => {
			const uri = generateAlgorandUri(validAddress, "My Wallet");
			expect(uri).toContain("label=My%20Wallet");
		});

		it("should include amount parameter", () => {
			const uri = generateAlgorandUri(validAddress, undefined, 1000000);
			expect(uri).toContain("amount=1000000");
		});

		it("should include asset parameter", () => {
			const uri = generateAlgorandUri(validAddress, undefined, undefined, 31566704);
			expect(uri).toContain("asset=31566704");
		});

		it("should include note parameter", () => {
			const uri = generateAlgorandUri(
				validAddress,
				undefined,
				undefined,
				undefined,
				"test note",
			);
			expect(uri).toContain("note=test%20note");
		});

		it("should combine multiple parameters", () => {
			const uri = generateAlgorandUri(
				validAddress,
				"Payment",
				1000000,
				undefined,
				"for coffee",
			);
			expect(uri).toContain("label=Payment");
			expect(uri).toContain("amount=1000000");
			expect(uri).toContain("note=for%20coffee");
		});

		it("should throw for invalid address (too short)", () => {
			expect(() => generateAlgorandUri("ABC123")).toThrow("Invalid Algorand address format");
		});

		it("should throw for invalid address (wrong characters)", () => {
			expect(() =>
				generateAlgorandUri("0000000000000000000000000000000000000000000000000000000000"),
			).toThrow("Invalid Algorand address format");
		});

		it("should handle amount of 0", () => {
			const uri = generateAlgorandUri(validAddress, undefined, 0);
			expect(uri).toContain("amount=0");
		});

		it("should handle asset ID of 0 (Algo)", () => {
			const uri = generateAlgorandUri(validAddress, undefined, 1000000, 0);
			expect(uri).toContain("asset=0");
		});

		it("should encode special characters in label", () => {
			const uri = generateAlgorandUri(validAddress, "Hello & World");
			expect(uri).toContain("label=Hello%20%26%20World");
		});
	});

	describe("URI type determination", () => {
		it("should identify Account URI", () => {
			expect(determineUriType()).toBe("Account URI");
		});

		it("should identify Payment URI", () => {
			expect(determineUriType(1000000)).toBe("Payment URI");
		});

		it("should identify Asset Transfer URI", () => {
			expect(determineUriType(100, 31566704)).toBe("Asset Transfer URI");
		});
	});

	describe("QR URI type determination", () => {
		it("should identify Account Contact", () => {
			expect(determineQrUriType()).toBe("Account Contact");
		});

		it("should identify Payment Request", () => {
			expect(determineQrUriType(1000000)).toBe("Payment Request");
		});

		it("should identify Asset Transfer Request", () => {
			expect(determineQrUriType(100, 31566704)).toBe("Asset Transfer Request");
		});

		it("should treat amount=0 with assetId as Payment Request (amount is defined)", () => {
			// amount=0 is still defined, so it's a Payment Request per the source logic
			expect(determineQrUriType(0, 31566704)).toBe("Payment Request");
		});
	});

	describe("ARC-26 tools", () => {
		it("generate_algorand_uri should report the URI and its type", async () => {
			const result = await arc26Tools({}).generate_algorand_uri({
				address: validAddress,
				amount: 100,
				assetId: 31566704,
			});
			expect(JSON.parse(result.content[0].text).data).toEqual({
				uri: `algorand://${validAddress}?amount=100&asset=31566704`,
				uriType: "Asset Transfer URI",
			});
		});

		it("generate_algorand_qrcode should store a page labelled with the QR URI type", async () => {
			const store = new Map<string, string>();
			const kv = {
				put: vi.fn(async (key: string, value: string) => {
					store.set(key, value);
				}),
			};
			const result = await arc26Tools({ ARC26_KV: kv as any }).generate_algorand_qrcode({
				address: validAddress,
				amount: 0,
				assetId: 31566704,
			});
			const link: string = JSON.parse(result.content[0].text).data.qrcode_link;
			const uuid = link.split("/").pop();
			expect(link).toMatch(/^https:\/\/goplausible\.xyz\/api\/arc26\/[a-f0-9]{32}$/);
			expect(store.get(`id--${uuid}`)).toContain("<h3>Your Payment Request</h3>");
			expect(store.get(`image--${uuid}`)).toMatch(/^[A-Za-z0-9+/]+=*$/);
		});
	});

	describe("Address validation regex", () => {
		it("should accept valid base32 address", () => {
			expect(() => generateAlgorandUri(validAddress)).not.toThrow();
		});

		it("should reject lowercase", () => {
			expect(() => generateAlgorandUri(validAddress.toLowerCase())).toThrow(
				"Invalid Algorand address format",
			);
		});

		it("should reject wrong length", () => {
			expect(() => generateAlgorandUri("AAAA")).toThrow("Invalid Algorand address format");
		});

		it("should reject invalid chars (0, 1, 8, 9)", () => {
			for (const ch of ["0", "1", "8", "9"]) {
				expect(() => generateAlgorandUri(`${ch}${validAddress.slice(1)}`)).toThrow(
					"Invalid Algorand address format",
				);
			}
		});
	});
});
