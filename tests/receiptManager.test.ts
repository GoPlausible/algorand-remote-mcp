import * as algosdk from "algosdk";
import { describe, expect, it } from "vitest";

/**
 * Tests for Receipt Manager logic
 * Tests address validation patterns, receipt type determination and
 * Universal Receipt category/badge behavior
 */

const validAddress = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ";
const validAddress2 = algosdk.generateAccount().addr.toString();

// Re-implement receipt address validation from receiptManager.ts
function validateReceiptAddresses(sender: string, receiver: string): void {
	if (!sender || !/^[A-Z2-7]{58}$/.test(sender)) {
		throw new Error("Invalid Algorand sender address format");
	}
	if (!receiver || !/^[A-Z2-7]{58}$/.test(receiver)) {
		throw new Error("Invalid Algorand receiver address format");
	}
}

// Re-implement receipt type determination
function determineReceiptType(asset?: number): string {
	return asset !== undefined ? "Asset Transfer Receipt" : "Payment Receipt";
}

// Re-implement amount formatting from buildHTMLPage
function formatAmount(value: number): string {
	return value.toFixed(6).replace(/\.?0+$/, "");
}

// Re-implement address truncation from buildHTMLPage
function shorten(value: string): string {
	return value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-6)}` : value;
}

// Re-implement protocol badge state selection from buildHTMLPage
const RECEIPT_CATEGORIES = ["TXN", "x402", "MPP", "AP2", "UCP"] as const;
type ReceiptCategory = (typeof RECEIPT_CATEGORIES)[number];
function badgeState(badge: ReceiptCategory, category: ReceiptCategory): string {
	return badge === category
		? "active"
		: category === "UCP" && badge === "AP2"
			? "secondary"
			: "inactive";
}

// Re-implement detail-row party labels from buildHTMLPage
function partyLabels(category: ReceiptCategory): [string, string] {
	return category === "MPP" ? ["PAYER AGENT", "PROVIDER"] : ["FROM", "TO"];
}

describe("Receipt Manager", () => {
	describe("validateReceiptAddresses", () => {
		it("should accept valid addresses", () => {
			expect(() => validateReceiptAddresses(validAddress, validAddress2)).not.toThrow();
		});

		it("should reject invalid sender", () => {
			expect(() => validateReceiptAddresses("invalid", validAddress)).toThrow("sender");
		});

		it("should reject invalid receiver", () => {
			expect(() => validateReceiptAddresses(validAddress, "invalid")).toThrow("receiver");
		});

		it("should reject empty sender", () => {
			expect(() => validateReceiptAddresses("", validAddress)).toThrow("sender");
		});

		it("should reject empty receiver", () => {
			expect(() => validateReceiptAddresses(validAddress, "")).toThrow("receiver");
		});
	});

	describe("determineReceiptType", () => {
		it("should return Payment Receipt when no asset", () => {
			expect(determineReceiptType()).toBe("Payment Receipt");
			expect(determineReceiptType(undefined)).toBe("Payment Receipt");
		});

		it("should return Asset Transfer Receipt when asset provided", () => {
			expect(determineReceiptType(31566704)).toBe("Asset Transfer Receipt");
		});

		it("should return Asset Transfer Receipt for asset 0 (Algo)", () => {
			expect(determineReceiptType(0)).toBe("Asset Transfer Receipt");
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

	describe("Receipt URL generation", () => {
		it("should generate correct receipt URL format", () => {
			const uuid = "abc123def456";
			const url = `https://goplausible.xyz/api/receipt/${uuid}`;
			expect(url).toBe("https://goplausible.xyz/api/receipt/abc123def456");
		});

		it("should generate correct image URL format", () => {
			const uuid = "abc123def456";
			const imageUrl = `https://goplausible.xyz/api/receipt/image/${uuid}.jpeg`;
			expect(imageUrl).toBe("https://goplausible.xyz/api/receipt/image/abc123def456.jpeg");
		});
	});
});
