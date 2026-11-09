import * as algosdk from "algosdk";
import { describe, expect, it, vi } from "vitest";
import {
	CartMandateSchema,
	IntentMandateSchema,
	PaymentMandateSchema,
	convertMerchantPublicKey,
	generateVerifiableCredential,
	parseMandateData,
} from "../src/tools/ap2Manager";
import type { Env, Props } from "../src/types";

/**
 * Tests for AP2 Manager logic
 * Tests mandate parsing, schema validation, and VC structure
 */

const props = { provider: "google", email: "shopper@example.com" } as Props;
const shopper = algosdk.generateAccount();
const merchant = algosdk.generateAccount();
const shopperPublicKey = Buffer.from(shopper.addr.publicKey).toString("base64");
const merchantPublicKey = Buffer.from(merchant.addr.publicKey).toString("base64");

// Env whose vault worker binding answers transit/sign requests with a fixed fake signature
function vaultEnv(status = 200) {
	const fetch = vi.fn(
		async (_url: string, _init?: RequestInit) =>
			new Response(
				status === 200
					? JSON.stringify({ signature: "test-vault-signature" })
					: "vault down",
				{ status },
			),
	);
	const env = { HCV_WORKER_URL: "https://vault.test", HCV_WORKER: { fetch } } as unknown as Env;
	return { env, fetch };
}

function generateVc(mandateType: string, mandate: Record<string, unknown> = { id: "m-001" }) {
	return generateVerifiableCredential(
		vaultEnv().env,
		props,
		mandateType,
		mandate,
		shopperPublicKey,
		merchantPublicKey,
	);
}

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
			expect(result.items[0].amount.currency).toBe("USDC");
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
		it("should generate correct DID from public key", async () => {
			const vc = await generateVc("cart_mandate");
			expect(vc.holder).toMatch(/^did:algo:[A-Z2-7]{58}$/);
			expect(vc.holder).toBe(`did:algo:${shopper.addr.toString()}`);
			expect(vc.issuer.id).toBe(`did:algo:${merchant.addr.toString()}`);
		});
	});

	describe("VerifiableCredential structure", () => {
		it("should have correct context and type for intent mandate", async () => {
			const vc = await generateVc("intent_mandate");
			expect(vc["@context"]).toHaveLength(2);
			expect(vc["@context"]).toEqual([
				"https://www.w3.org/ns/credentials/v2",
				"https://w3id.org/security/suites/ed25519-2020/v1",
			]);
			expect(vc.type).toContain("VerifiableCredential");
			expect(vc.type).toContain("IntentMandateCredential");
		});

		it("should map mandate type to correct VC type", async () => {
			expect((await generateVc("intent_mandate")).type).toEqual([
				"VerifiableCredential",
				"IntentMandateCredential",
			]);
			expect((await generateVc("cart_mandate")).type).toEqual([
				"VerifiableCredential",
				"CartMandateCredential",
			]);
			expect((await generateVc("payment_mandate")).type).toEqual([
				"VerifiableCredential",
				"PaymentMandateCredential",
			]);
		});

		it("should map mandate type to correct schema", async () => {
			const intent = await generateVc("intent_mandate");
			const cart = await generateVc("cart_mandate");
			const payment = await generateVc("payment_mandate");
			expect(intent.credentialSchema.id).toContain("intent-mandate");
			expect(cart.credentialSchema.id).toContain("cart-mandate");
			expect(payment.credentialSchema.id).toContain("payment-mandate");
			expect(intent.credentialSchema).toEqual({
				id: "https://goplausible.xyz/api/schemas/intent-mandate.json",
				type: "JsonSchema",
			});
			expect(cart.credentialSchema.id).toBe(
				"https://goplausible.xyz/api/schemas/cart-mandate.json",
			);
			expect(payment.credentialSchema.id).toBe(
				"https://goplausible.xyz/api/schemas/payment-mandate.json",
			);
		});

		it("should embed the typed mandate as the credential subject", async () => {
			const vc = await generateVc("payment_mandate", { id: "pay-001" });
			expect(vc.credentialSubject.mandate).toEqual({ type: "PaymentMandate", id: "pay-001" });
		});

		it("should sign intent and payment mandates through the vault", async () => {
			for (const mandateType of ["intent_mandate", "payment_mandate"]) {
				const { env, fetch } = vaultEnv();
				const vc = await generateVerifiableCredential(
					env,
					props,
					mandateType,
					{ id: "m-001" },
					shopperPublicKey,
					merchantPublicKey,
				);
				expect(fetch).toHaveBeenCalledTimes(1);
				expect(fetch.mock.calls[0][0]).toBe(
					"https://vault.test/google/transit/sign/shopper@example.com",
				);
				expect(vc.proof.proofValue).toBe("test-vault-signature");
				expect(vc.proof.verificationMethod).toBe(
					`did:algo:${shopper.addr.toString()}#auth`,
				);
			}
		});

		it("should not sign cart mandates", async () => {
			const { env, fetch } = vaultEnv();
			const vc = await generateVerifiableCredential(
				env,
				props,
				"cart_mandate",
				{ id: "cart-001" },
				shopperPublicKey,
				merchantPublicKey,
			);
			expect(fetch).not.toHaveBeenCalled();
			expect(vc.proof.proofValue).toBe("");
			expect(vc.proof.verificationMethod).toBe(`did:algo:${merchant.addr.toString()}#auth`);
		});

		it("should throw when the vault does not return a signature", async () => {
			await expect(
				generateVerifiableCredential(
					vaultEnv(500).env,
					props,
					"intent_mandate",
					{ id: "m-001" },
					shopperPublicKey,
					merchantPublicKey,
				),
			).rejects.toThrow("Failed to get signature from vault");
		});

		it("should reject an unsupported mandate type when generating a VC", async () => {
			await expect(generateVc("unknown_type")).rejects.toThrow(
				"Unsupported mandate type: unknown_type",
			);
		});
	});

	describe("Merchant public key conversion", () => {
		it("should convert 58-char Algorand address to base64 public key", () => {
			const account = algosdk.generateAccount();
			const address = account.addr.toString();
			expect(address).toHaveLength(58);

			const mandate = { merchant_public_key: address };
			convertMerchantPublicKey(mandate);
			const base64Key = mandate.merchant_public_key;
			expect(base64Key).toBeDefined();
			expect(base64Key.length).toBeGreaterThan(0);
			expect(base64Key).toBe(Buffer.from(account.addr.publicKey).toString("base64"));

			// Verify round-trip
			const recoveredAddress = algosdk.encodeAddress(Buffer.from(base64Key, "base64"));
			expect(recoveredAddress).toBe(address);
		});

		it("should leave a key that is not 58 characters unchanged", () => {
			const mandate = { merchant_public_key: merchantPublicKey };
			convertMerchantPublicKey(mandate);
			expect(mandate.merchant_public_key).toBe(merchantPublicKey);
		});
	});
});
