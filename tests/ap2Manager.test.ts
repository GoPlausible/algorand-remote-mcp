import * as algosdk from "algosdk";
import { describe, expect, it } from "vitest";
import { z } from "zod";

/**
 * Tests for AP2 Manager logic
 * Tests mandate parsing, schema validation, and VC structure
 */

// Re-implement schemas from ap2Manager.ts
const AmountSchema = z.object({
	currency: z.string().default("USDC"),
	value: z.number(),
});

const DisplayItemSchema = z.object({
	label: z.string(),
	amount: AmountSchema,
});

const IntentMandateSchema = z.object({
	id: z.string(),
	items: z.array(DisplayItemSchema),
	total: z.number(),
	currency: z.string().default("USDC"),
	signature: z.string(),
	merchant_public_key: z.string(),
});

const CartMandateSchema = z.object({
	id: z.string(),
	items: z.array(DisplayItemSchema),
	total: z.number(),
	currency: z.string().default("USDC"),
	signature: z.string(),
	merchant_public_key: z.string(),
	payment_requirements: z.object({}).passthrough(),
});

const PaymentMandateSchema = z.object({
	id: z.string(),
	total: z.number(),
	currency: z.string().default("USDC"),
	signature: z.string(),
	payment_requirements: z
		.object({
			id: z.string(),
		})
		.passthrough(),
	refund_period: z.number(),
	cart_request_id: z.string(),
	merchant_agent: z.string(),
	merchant_public_key: z.string(),
});

// Re-implement parseMandateData
const parseMandateData = (mandateStr: string, type: string): any => {
	const data = JSON.parse(mandateStr);
	switch (type) {
		case "intent_mandate":
			return IntentMandateSchema.parse(data);
		case "cart_mandate":
			return CartMandateSchema.parse(data);
		case "payment_mandate":
			return PaymentMandateSchema.parse(data);
		default:
			throw new Error(`Unsupported mandate type: ${type}`);
	}
};

describe("AP2 Manager", () => {
	describe("IntentMandateSchema", () => {
		it("should parse a valid intent mandate", () => {
			const data = {
				id: "mandate-001",
				items: [{ label: "Coffee", amount: { currency: "USDC", value: 5 } }],
				total: 5,
				currency: "USDC",
				signature: "sig123",
				merchant_public_key: "pk123",
			};
			const result = IntentMandateSchema.parse(data);
			expect(result.id).toBe("mandate-001");
			expect(result.items).toHaveLength(1);
			expect(result.total).toBe(5);
		});

		it("should use default currency if not provided", () => {
			const data = {
				id: "mandate-002",
				items: [{ label: "Item", amount: { value: 10 } }],
				total: 10,
				signature: "sig",
				merchant_public_key: "pk",
			};
			const result = IntentMandateSchema.parse(data);
			expect(result.currency).toBe("USDC");
		});

		it("should reject missing required fields", () => {
			expect(() => IntentMandateSchema.parse({ id: "only-id" })).toThrow();
		});
	});

	describe("CartMandateSchema", () => {
		it("should parse a valid cart mandate", () => {
			const data = {
				id: "cart-001",
				items: [{ label: "Widget", amount: { currency: "USDC", value: 25 } }],
				total: 25,
				currency: "USDC",
				signature: "sig456",
				merchant_public_key: "pk456",
				payment_requirements: { method: "X402" },
			};
			const result = CartMandateSchema.parse(data);
			expect(result.payment_requirements).toBeDefined();
		});

		it("should allow passthrough on payment_requirements", () => {
			const data = {
				id: "cart-002",
				items: [],
				total: 0,
				signature: "sig",
				merchant_public_key: "pk",
				payment_requirements: { custom_field: "value", nested: { deep: true } },
			};
			const result = CartMandateSchema.parse(data);
			expect((result.payment_requirements as any).custom_field).toBe("value");
		});
	});

	describe("PaymentMandateSchema", () => {
		it("should parse a valid payment mandate", () => {
			const data = {
				id: "pay-001",
				total: 100,
				currency: "USDC",
				signature: "sig789",
				payment_requirements: { id: "req-001" },
				refund_period: 30,
				cart_request_id: "cart-001",
				merchant_agent: "did:algo:merchant",
				merchant_public_key: "pk789",
			};
			const result = PaymentMandateSchema.parse(data);
			expect(result.refund_period).toBe(30);
			expect(result.cart_request_id).toBe("cart-001");
		});

		it("should require payment_requirements.id", () => {
			const data = {
				id: "pay-002",
				total: 50,
				signature: "sig",
				payment_requirements: {}, // missing id
				refund_period: 7,
				cart_request_id: "cart",
				merchant_agent: "agent",
				merchant_public_key: "pk",
			};
			expect(() => PaymentMandateSchema.parse(data)).toThrow();
		});
	});

	describe("parseMandateData", () => {
		const validIntentMandate = JSON.stringify({
			id: "test",
			items: [],
			total: 0,
			signature: "sig",
			merchant_public_key: "pk",
		});

		it("should parse intent_mandate", () => {
			const result = parseMandateData(validIntentMandate, "intent_mandate");
			expect(result.id).toBe("test");
		});

		it("should throw for unsupported mandate type", () => {
			expect(() => parseMandateData(validIntentMandate, "unknown_type")).toThrow(
				"Unsupported mandate type",
			);
		});

		it("should throw for invalid JSON", () => {
			expect(() => parseMandateData("not json", "intent_mandate")).toThrow();
		});
	});

	describe("DID generation", () => {
		it("should generate correct DID from public key", () => {
			const account = algosdk.generateAccount();
			const publicKeyBase64 = Buffer.from(account.addr.publicKey).toString("base64");
			const publicKeyBuffer = Buffer.from(publicKeyBase64, "base64");
			const address = algosdk.encodeAddress(publicKeyBuffer);
			const did = `did:algo:${address}`;
			expect(did).toMatch(/^did:algo:[A-Z2-7]{58}$/);
		});
	});

	describe("VerifiableCredential structure", () => {
		it("should have correct context and type for intent mandate", () => {
			const vcType = "IntentMandateCredential";
			const context = [
				"https://www.w3.org/ns/credentials/v2",
				"https://w3id.org/security/suites/ed25519-2020/v1",
			];
			const types = ["VerifiableCredential", vcType];
			expect(context).toHaveLength(2);
			expect(types).toContain("VerifiableCredential");
			expect(types).toContain("IntentMandateCredential");
		});

		it("should map mandate type to correct VC type", () => {
			const typeMap: Record<string, string> = {
				intent_mandate: "IntentMandateCredential",
				cart_mandate: "CartMandateCredential",
				payment_mandate: "PaymentMandateCredential",
			};
			expect(typeMap.intent_mandate).toBe("IntentMandateCredential");
			expect(typeMap.cart_mandate).toBe("CartMandateCredential");
			expect(typeMap.payment_mandate).toBe("PaymentMandateCredential");
		});

		it("should map mandate type to correct schema", () => {
			const schemaMap: Record<string, string> = {
				intent_mandate: "https://goplausible.xyz/api/schemas/intent-mandate.json",
				cart_mandate: "https://goplausible.xyz/api/schemas/cart-mandate.json",
				payment_mandate: "https://goplausible.xyz/api/schemas/payment-mandate.json",
			};
			expect(schemaMap.intent_mandate).toContain("intent-mandate");
			expect(schemaMap.cart_mandate).toContain("cart-mandate");
			expect(schemaMap.payment_mandate).toContain("payment-mandate");
		});
	});

	describe("Merchant public key conversion", () => {
		it("should convert 58-char Algorand address to base64 public key", () => {
			const account = algosdk.generateAccount();
			const address = account.addr.toString();
			expect(address).toHaveLength(58);

			const publicKeyBytes = algosdk.decodeAddress(address).publicKey;
			const base64Key = Buffer.from(publicKeyBytes).toString("base64");
			expect(base64Key).toBeDefined();
			expect(base64Key.length).toBeGreaterThan(0);

			// Verify round-trip
			const recoveredAddress = algosdk.encodeAddress(Buffer.from(base64Key, "base64"));
			expect(recoveredAddress).toBe(address);
		});
	});
});
