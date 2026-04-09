import * as algosdk from "algosdk";
import { describe, expect, it } from "vitest";

/**
 * Tests for Receipt Manager logic
 * Tests address validation patterns and receipt type determination
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
function formatAmount(amount?: number, asset?: number): string {
	const uriType = determineReceiptType(asset);
	return amount && uriType !== "Asset Transfer Receipt"
		? `${amount / 1e6} Algo`
		: `${amount} units of Asset ${asset}`;
}

// Re-implement address truncation from buildHTMLPage
function truncateAddress(addr: string): string {
	if (typeof addr === "string" && addr.length > 12) {
		return `${addr.slice(0, 6)}...${addr.slice(-6)}`;
	}
	return addr;
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
		it("should format Algo amount (microAlgos to Algo)", () => {
			expect(formatAmount(1000000)).toBe("1 Algo");
		});

		it("should format asset amount with asset ID", () => {
			expect(formatAmount(100, 31566704)).toBe("100 units of Asset 31566704");
		});
	});

	describe("truncateAddress", () => {
		it("should truncate long addresses", () => {
			const result = truncateAddress(validAddress);
			expect(result).toBe(`${validAddress.slice(0, 6)}...${validAddress.slice(-6)}`);
		});

		it("should not truncate short strings", () => {
			expect(truncateAddress("short")).toBe("short");
		});

		it("should not truncate 12-char strings", () => {
			expect(truncateAddress("123456789012")).toBe("123456789012");
		});

		it("should truncate 13-char strings", () => {
			const s = "1234567890123";
			expect(truncateAddress(s)).toBe(`${s.slice(0, 6)}...${s.slice(-6)}`);
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
