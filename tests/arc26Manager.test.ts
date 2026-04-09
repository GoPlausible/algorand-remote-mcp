import { describe, expect, it } from "vitest";

/**
 * Tests for ARC-26 URI generation logic (generateAlgorandUri)
 * Extracted from arc26Manager.ts pure function
 */

// Re-implement the pure function for testing (it's not exported)
function generateAlgorandUri(
	address: string,
	label?: string,
	amount?: number,
	assetId?: number,
	note?: string,
): string {
	if (!/^[A-Z2-7]{58}$/.test(address)) {
		throw new Error("Invalid Algorand address format");
	}

	let uri = `algorand://${address}`;
	const queryParams: string[] = [];

	if (label) {
		queryParams.push(`label=${encodeURIComponent(label)}`);
	}
	if (amount !== undefined) {
		queryParams.push(`amount=${amount}`);
	}
	if (assetId !== undefined) {
		queryParams.push(`asset=${assetId}`);
	}
	if (note) {
		queryParams.push(`note=${encodeURIComponent(note)}`);
	}

	if (queryParams.length > 0) {
		uri += `?${queryParams.join("&")}`;
	}

	return uri;
}

// Re-implement URI type determination logic
function determineUriType(amount?: number, assetId?: number): string {
	if (amount !== undefined && assetId !== undefined) {
		return "Asset Transfer URI";
	}
	if (amount !== undefined) {
		return "Payment URI";
	}
	return "Account URI";
}

// Re-implement QR type determination for generate_algorand_qrcode tool
function determineQrUriType(amount?: number, assetId?: number): string {
	if (amount !== undefined && amount !== 0 && assetId !== undefined) {
		return "Asset Transfer Request";
	}
	if (amount !== undefined) {
		return "Payment Request";
	}
	return "Account Contact";
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

	describe("Address validation regex", () => {
		it("should accept valid base32 address", () => {
			expect(/^[A-Z2-7]{58}$/.test(validAddress)).toBe(true);
		});

		it("should reject lowercase", () => {
			expect(/^[A-Z2-7]{58}$/.test(validAddress.toLowerCase())).toBe(false);
		});

		it("should reject wrong length", () => {
			expect(/^[A-Z2-7]{58}$/.test("AAAA")).toBe(false);
		});

		it("should reject invalid chars (0, 1, 8, 9)", () => {
			expect(/^[A-Z2-7]{58}$/.test(`0${validAddress.slice(1)}`)).toBe(false);
			expect(/^[A-Z2-7]{58}$/.test(`1${validAddress.slice(1)}`)).toBe(false);
			expect(/^[A-Z2-7]{58}$/.test(`8${validAddress.slice(1)}`)).toBe(false);
			expect(/^[A-Z2-7]{58}$/.test(`9${validAddress.slice(1)}`)).toBe(false);
		});
	});
});
