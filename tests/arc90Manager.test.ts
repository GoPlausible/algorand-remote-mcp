import { describe, expect, it, vi } from "vitest";
import {
	determineQrUriType,
	determineUriType,
	encodeArc90QueryValue,
	generateAlgorandUri,
	registerArc90Tools,
} from "../src/tools/arc90Manager";
import type { Env, Props } from "../src/types";

// @cf-wasm/photon's default (workers) entry loads its wasm through an ESM import Node cannot
// resolve; point it at the library's own Node build so arc90Manager can be imported.
vi.mock("@cf-wasm/photon", () => import("@cf-wasm/photon/node"));

/**
 * Tests for ARC-90 payment URI generation (generateAlgorandUri, encodeArc90QueryValue) and the
 * URI type reported by the generate_algorand_uri and generate_algorand_qrcode tools
 */

type ToolResult = { content: { type: string; text: string }[] };
type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

function arc90Tools(env: Partial<Env>): Record<string, ToolHandler> {
	const tools: Record<string, ToolHandler> = {};
	const server = {
		tool: (name: string, _description: string, _schema: unknown, handler: ToolHandler) => {
			tools[name] = handler;
		},
	};
	const props = { provider: "google", email: "agent-owner@example.com" } as Props;
	registerArc90Tools(server as any, env as Env, props);
	return tools;
}

function memoryKv() {
	const store = new Map<string, string>();
	const kv = {
		put: vi.fn(async (key: string, value: string) => {
			store.set(key, value);
		}),
	};
	return { store, kv };
}

describe("ARC-90 URI Generation", () => {
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

		it("should include xnote parameter", () => {
			const uri = generateAlgorandUri(
				validAddress,
				undefined,
				undefined,
				undefined,
				undefined,
				"invoice 42",
			);
			expect(uri).toBe(`algorand://${validAddress}?xnote=invoice%2042`);
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

		it("should omit the asset parameter for asset ID 0 (Algo)", () => {
			// ARC-90: "asset: The asset id this request refers to (if Algos, simply omit this parameter)"
			const uri = generateAlgorandUri(validAddress, undefined, 1000000, 0);
			expect(uri).toBe(`algorand://${validAddress}?amount=1000000`);
		});

		it("should encode special characters in label", () => {
			const uri = generateAlgorandUri(validAddress, "Hello & World");
			expect(uri).toContain("label=Hello%20%26%20World");
		});

		it("should reject a fractional amount (ARC-90 amounts are integers in base units)", () => {
			expect(() => generateAlgorandUri(validAddress, undefined, 1.5)).toThrow(
				"Amount must be a non-negative integer",
			);
		});

		it("should reject a negative amount", () => {
			expect(() => generateAlgorandUri(validAddress, undefined, -1)).toThrow(
				"Amount must be a non-negative integer",
			);
		});

		it("should reject a fractional or negative asset ID", () => {
			expect(() => generateAlgorandUri(validAddress, undefined, 1, 1.5)).toThrow(
				"Asset ID must be a non-negative integer",
			);
			expect(() => generateAlgorandUri(validAddress, undefined, 1, -3)).toThrow(
				"Asset ID must be a non-negative integer",
			);
		});
	});

	describe("ARC-90 payment examples", () => {
		// The payment URI examples given in ARC-90 itself
		const specAddress = "TMTAD6N22HCS2LKH7677L2KFLT3PAQWY6M4JFQFXQS32ECBFC23F57RYX4";

		it("should match the address example", () => {
			expect(generateAlgorandUri(specAddress)).toBe(`algorand://${specAddress}`);
		});

		it("should match the address-with-label example", () => {
			expect(generateAlgorandUri(specAddress, "Silvio")).toBe(
				`algorand://${specAddress}?label=Silvio`,
			);
		});

		it("should match the 150.5 Algos request example", () => {
			expect(generateAlgorandUri(specAddress, undefined, 150500000)).toBe(
				`algorand://${specAddress}?amount=150500000`,
			);
		});

		it("should match the 150 units of asset 45 example", () => {
			expect(generateAlgorandUri(specAddress, undefined, 150, 45)).toBe(
				`algorand://${specAddress}?amount=150&asset=45`,
			);
		});
	});

	describe("encodeArc90QueryValue", () => {
		it("should percent-encode the = and & separators (ARC-90 example)", () => {
			expect(encodeArc90QueryValue("foo=bar&baz")).toBe("foo%3Dbar%26baz");
		});

		it("should encode spaces as %20 (ARC-90 example)", () => {
			expect(encodeArc90QueryValue("Donation for Event")).toBe("Donation%20for%20Event");
		});

		it("should encode the characters encodeURIComponent leaves as they are", () => {
			expect(encodeArc90QueryValue("Bob's (tip)!*")).toBe("Bob%27s%20%28tip%29%21%2A");
		});

		it("should UTF-8 encode non-ASCII characters before percent-encoding", () => {
			expect(encodeArc90QueryValue("café")).toBe("caf%C3%A9");
		});

		it("should leave the RFC 3986 unreserved characters unencoded", () => {
			expect(encodeArc90QueryValue("AZaz09-._~")).toBe("AZaz09-._~");
		});

		it("should encode % and HTML characters", () => {
			expect(encodeArc90QueryValue('100% <b>"x"</b>')).toBe(
				"100%25%20%3Cb%3E%22x%22%3C%2Fb%3E",
			);
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

		it("should treat asset ID 0 as an Algo payment", () => {
			expect(determineUriType(1000000, 0)).toBe("Payment URI");
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

		it("should treat asset ID 0 as an Algo Payment Request", () => {
			expect(determineQrUriType(1000000, 0)).toBe("Payment Request");
		});
	});

	describe("ARC-90 tools", () => {
		it("generate_algorand_uri should report the URI and its type", async () => {
			const result = await arc90Tools({}).generate_algorand_uri({
				address: validAddress,
				amount: 100,
				assetId: 31566704,
			});
			expect(JSON.parse(result.content[0].text).data).toEqual({
				uri: `algorand://${validAddress}?amount=100&asset=31566704`,
				uriType: "Asset Transfer URI",
			});
		});

		it("generate_algorand_uri should pass xnote through", async () => {
			const result = await arc90Tools({}).generate_algorand_uri({
				address: validAddress,
				amount: 5,
				xnote: "order #7",
			});
			expect(JSON.parse(result.content[0].text).data.uri).toBe(
				`algorand://${validAddress}?amount=5&xnote=order%20%237`,
			);
		});

		it("generate_algorand_qrcode should store a page labelled with the QR URI type", async () => {
			const { store, kv } = memoryKv();
			const result = await arc90Tools({ ARC90_KV: kv as any }).generate_algorand_qrcode({
				address: validAddress,
				amount: 0,
				assetId: 31566704,
			});
			const data = JSON.parse(result.content[0].text).data;
			const link: string = data.qrcode_link;
			const uuid = link.split("/").pop();
			expect(link).toMatch(/^https:\/\/goplausible\.xyz\/api\/arc90\/[a-f0-9]{32}$/);
			expect(data.label).toBe("Algorand ARC-90 QR Code link (valid for 1 day)");
			expect(store.get(`id--${uuid}`)).toContain(
				`<meta property="og:url" content="https://goplausible.xyz/api/arc90/${uuid}" />`,
			);
			expect(store.get(`id--${uuid}`)).toContain(
				`src="https://goplausible.xyz/api/arc90/image/${uuid}.jpeg"`,
			);
			expect(store.get(`id--${uuid}`)).toContain("<h3>Your Payment Request</h3>");
			expect(store.get(`id--${uuid}`)).toContain("via ARC-90 URI.");
			expect(store.get(`image--${uuid}`)).toMatch(/^[A-Za-z0-9+/]+=*$/);
		});

		it("generate_algorand_qrcode should percent-encode the note in the URI and the stored page", async () => {
			const { store, kv } = memoryKv();
			const result = await arc90Tools({ ARC90_KV: kv as any }).generate_algorand_qrcode({
				address: validAddress,
				amount: 1000000,
				note: "<script>alert(1)</script> & more",
				xnote: "ref=1",
			});
			const uuid = JSON.parse(result.content[0].text).data.qrcode_link.split("/").pop();
			const page = store.get(`id--${uuid}`) as string;
			// In HTML text & is written &amp;, or the '&not' of '&note=' would display as '¬e='
			expect(page).toContain(
				`<div class="uri">algorand://${validAddress}?amount=1000000&amp;note=%3Cscript%3Ealert%281%29%3C%2Fscript%3E%20%26%20more&amp;xnote=ref%3D1</div>`,
			);
			expect(page).not.toContain("<script>");
		});

		it("generate_algorand_qrcode should reject a fractional amount instead of rounding it", async () => {
			const { kv } = memoryKv();
			const result = await arc90Tools({ ARC90_KV: kv as any }).generate_algorand_qrcode({
				address: validAddress,
				amount: 1.9,
			});
			expect(result.content[0].text).toContain("Amount must be a non-negative integer");
			expect(kv.put).not.toHaveBeenCalled();
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
