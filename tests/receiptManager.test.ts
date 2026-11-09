import * as algosdk from "algosdk";
import { describe, expect, it, vi } from "vitest";
import {
	RECEIPT_CATEGORIES,
	buildHTMLPage,
	formatAmount,
	receiptIdFromTxId,
	registerReceiptTools,
	shorten,
	validateReceiptAddresses,
} from "../src/tools/receiptManager";
import type { Env, Props } from "../src/types";

// @cf-wasm/photon's default (workers) entry loads its wasm through an ESM import Node cannot
// resolve; point it at the library's own Node build so receiptManager can be imported.
vi.mock("@cf-wasm/photon", () => import("@cf-wasm/photon/node"));

/**
 * Tests for Receipt Manager logic
 * Tests address validation patterns, receipt type determination and
 * Universal Receipt category/badge behavior
 */

const validAddress = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";
const validAddress2 = algosdk.generateAccount().addr.toString();

type ReceiptCategory = (typeof RECEIPT_CATEGORIES)[number];
type ReceiptPageInput = Parameters<typeof buildHTMLPage>[0];

function renderReceipt(overrides: Partial<ReceiptPageInput> = {}): string {
	return buildHTMLPage({
		provider: "google",
		url: "https://goplausible.xyz/api/receipt/abc123def456",
		uuid: "abc123def456",
		qrPng: "https://goplausible.xyz/api/receipt/image/abc123def456.jpeg",
		qrDataUri: "data:image/png;base64,AAAA",
		from: "agent-owner@example.com",
		sender: validAddress,
		txId: "3A7DSUQXWMBP3EOGFIRIVQXGXQXTUWTA",
		receiver: validAddress2,
		category: "TXN",
		...overrides,
	});
}

function receiptTitle(html: string): string {
	return html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
}

// Protocol badge states as rendered by buildHTMLPage
function badgeStates(html: string): Record<string, string> {
	const states: Record<string, string> = {};
	for (const match of html.matchAll(
		/<span class="badge(?: (active|secondary))?">([^<]+)<\/span>/g,
	)) {
		states[match[2]] = match[1] ?? "inactive";
	}
	return states;
}

function badgeState(badge: ReceiptCategory, category: ReceiptCategory): string {
	return badgeStates(renderReceipt({ category }))[badge];
}

// First two detail-row labels (the parties) as rendered by buildHTMLPage
function partyLabels(category: ReceiptCategory): [string, string] {
	const labels = Array.from(
		renderReceipt({ category }).matchAll(
			/<div class="row"><span class="label">([^<]+)<\/span>/g,
		),
		(match) => match[1],
	);
	return [labels[0], labels[1]];
}

type ToolResult = { content: { type: string; text: string }[] };
type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

function fakeKv() {
	const store = new Map<string, string>();
	return {
		store,
		get: vi.fn(async (key: string) => store.get(key) ?? null),
		put: vi.fn(async (key: string, value: string) => {
			store.set(key, value);
		}),
	};
}

function receiptTool(kv: ReturnType<typeof fakeKv>): ToolHandler {
	let handler: ToolHandler | undefined;
	const server = {
		tool: (_name: string, _description: string, _schema: unknown, cb: ToolHandler) => {
			handler = cb;
		},
	};
	const props = { provider: "google", email: "agent-owner@example.com" } as Props;
	registerReceiptTools(server as any, { ARC90_KV: kv } as unknown as Env, props);
	if (!handler) throw new Error("generate_algorand_receipt was not registered");
	return handler;
}

describe("Receipt Manager", () => {
	describe("validateReceiptAddresses", () => {
		it("should accept valid addresses", () => {
			expect(() =>
				validateReceiptAddresses({ sender: validAddress, receiver: validAddress2 }),
			).not.toThrow();
		});

		it("should reject invalid sender", () => {
			expect(() =>
				validateReceiptAddresses({ sender: "invalid", receiver: validAddress }),
			).toThrow("sender");
		});

		it("should reject invalid receiver", () => {
			expect(() =>
				validateReceiptAddresses({ sender: validAddress, receiver: "invalid" }),
			).toThrow("receiver");
		});

		it("should reject empty sender", () => {
			expect(() => validateReceiptAddresses({ sender: "", receiver: validAddress })).toThrow(
				"sender",
			);
		});

		it("should reject empty receiver", () => {
			expect(() => validateReceiptAddresses({ sender: validAddress, receiver: "" })).toThrow(
				"receiver",
			);
		});

		it("should report the exact error messages", () => {
			expect(() => validateReceiptAddresses({ receiver: validAddress })).toThrow(
				"Invalid Algorand sender address format",
			);
			expect(() => validateReceiptAddresses({ sender: validAddress })).toThrow(
				"Invalid Algorand receiver address format",
			);
		});
	});

	describe("receipt type (buildHTMLPage title)", () => {
		it("should return Payment Receipt when no asset", () => {
			expect(receiptTitle(renderReceipt())).toContain("| TXN Payment Receipt |");
			expect(receiptTitle(renderReceipt({ asset: undefined }))).toContain(
				"| TXN Payment Receipt |",
			);
		});

		it("should return Asset Transfer Receipt when asset provided", () => {
			expect(receiptTitle(renderReceipt({ asset: 31566704 }))).toContain(
				"| TXN Asset Transfer Receipt |",
			);
		});

		it("should return Asset Transfer Receipt for asset 0 (Algo)", () => {
			expect(receiptTitle(renderReceipt({ asset: 0 }))).toContain(
				"| TXN Asset Transfer Receipt |",
			);
		});
	});

	describe("formatAmount", () => {
		it("should format whole Algo amount (microAlgos to Algo)", () => {
			expect(formatAmount(1000000 / 1e6)).toBe("1");
		});

		it("should trim trailing zeros", () => {
			expect(formatAmount(1250000 / 1e6)).toBe("1.25");
			expect(formatAmount(100000 / 1e6)).toBe("0.1");
		});

		it("should format zero", () => {
			expect(formatAmount(0)).toBe("0");
		});
	});

	describe("shorten", () => {
		it("should truncate long addresses", () => {
			const result = shorten(validAddress);
			expect(result).toBe(`${validAddress.slice(0, 6)}…${validAddress.slice(-6)}`);
		});

		it("should not truncate short strings", () => {
			expect(shorten("short")).toBe("short");
		});

		it("should not truncate 12-char strings", () => {
			expect(shorten("123456789012")).toBe("123456789012");
		});

		it("should truncate 13-char strings", () => {
			const s = "1234567890123";
			expect(shorten(s)).toBe(`${s.slice(0, 6)}…${s.slice(-6)}`);
		});
	});

	describe("receipt categories", () => {
		it("should render one badge per category, in order", () => {
			expect(Object.keys(badgeStates(renderReceipt()))).toEqual([...RECEIPT_CATEGORIES]);
		});

		it("should mark the selected category as active", () => {
			for (const category of RECEIPT_CATEGORIES) {
				expect(badgeState(category, category)).toBe("active");
			}
		});

		it("should mark AP2 as secondary when UCP is selected (UCP implies AP2)", () => {
			expect(badgeState("UCP", "UCP")).toBe("active");
			expect(badgeState("AP2", "UCP")).toBe("secondary");
			expect(badgeState("TXN", "UCP")).toBe("inactive");
		});

		it("should not mark UCP when AP2 is selected", () => {
			expect(badgeState("AP2", "AP2")).toBe("active");
			expect(badgeState("UCP", "AP2")).toBe("inactive");
		});

		it("should leave other badges inactive", () => {
			expect(badgeState("x402", "TXN")).toBe("inactive");
			expect(badgeState("MPP", "x402")).toBe("inactive");
		});

		it("should use payer agent/provider labels only for MPP", () => {
			expect(partyLabels("MPP")).toEqual(["PAYER AGENT", "PROVIDER"]);
			expect(partyLabels("TXN")).toEqual(["FROM", "TO"]);
			expect(partyLabels("x402")).toEqual(["FROM", "TO"]);
			expect(partyLabels("UCP")).toEqual(["FROM", "TO"]);
		});
	});

	describe("receiptIdFromTxId", () => {
		it("should be deterministic for the same txId", async () => {
			const a = await receiptIdFromTxId("3A7DSUQXWMBP3EOGFIRIVQXGXQXTUWTA");
			const b = await receiptIdFromTxId("3A7DSUQXWMBP3EOGFIRIVQXGXQXTUWTA");
			expect(a).toBe(b);
		});

		it("should produce 32 lowercase hex chars (URL- and KV-safe)", async () => {
			const id = await receiptIdFromTxId("3A7DSUQXWMBP3EOGFIRIVQXGXQXTUWTA");
			expect(id).toMatch(/^[a-f0-9]{32}$/);
		});

		it("should differ for different txIds", async () => {
			const a = await receiptIdFromTxId("TXID-ONE");
			const b = await receiptIdFromTxId("TXID-TWO");
			expect(a).not.toBe(b);
		});
	});

	describe("Receipt URL generation", () => {
		const txId = "3A7DSUQXWMBP3EOGFIRIVQXGXQXTUWTA";

		it("should generate correct receipt URL format", async () => {
			expect(renderReceipt({ uuid: "abc123def456" })).toContain(
				'<meta property="og:url" content="https://goplausible.xyz/api/receipt/abc123def456" />',
			);

			const kv = fakeKv();
			const result = await receiptTool(kv)({
				sender: validAddress,
				receiver: validAddress2,
				amount: 1250000,
				txId,
				category: "TXN",
			});
			const uuid = await receiptIdFromTxId(txId);
			expect(JSON.parse(result.content[0].text).data.qrcode_link).toBe(
				`https://goplausible.xyz/api/receipt/${uuid}`,
			);
			expect(kv.store.get(`rid--${uuid}`)).toContain(
				`href="https://goplausible.xyz/api/receipt/${uuid}"`,
			);
		});

		it("should generate correct image URL format", async () => {
			const kv = fakeKv();
			await receiptTool(kv)({
				sender: validAddress,
				receiver: validAddress2,
				amount: 1250000,
				txId,
				category: "x402",
			});
			const uuid = await receiptIdFromTxId(txId);
			expect(kv.store.get(`rid--${uuid}`)).toContain(
				`<meta property="og:image" content="https://goplausible.xyz/api/receipt/image/${uuid}.jpeg" />`,
			);
			expect(kv.store.get(`image--${uuid}`)).toMatch(/^[A-Za-z0-9+/]+=*$/);
		});

		it("should return the existing receipt for a txId without regenerating it", async () => {
			const kv = fakeKv();
			const uuid = await receiptIdFromTxId(txId);
			kv.store.set(`rid--${uuid}`, "<html>existing</html>");
			const result = await receiptTool(kv)({
				sender: validAddress,
				receiver: validAddress2,
				txId,
				category: "TXN",
			});
			expect(JSON.parse(result.content[0].text).data.qrcode_link).toBe(
				`https://goplausible.xyz/api/receipt/${uuid}`,
			);
			expect(kv.put).not.toHaveBeenCalled();
		});

		it("should report invalid addresses through the tool", async () => {
			const kv = fakeKv();
			const result = await receiptTool(kv)({
				sender: "invalid",
				receiver: validAddress2,
				txId: "TXID-INVALID-SENDER",
				category: "TXN",
			});
			expect(result.content[0].text).toBe(
				"Error generating Algorand Receipt: Invalid Algorand sender address format",
			);
			expect(kv.put).not.toHaveBeenCalled();
		});
	});
});
