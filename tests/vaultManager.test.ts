import * as algosdk from "algosdk";
import { describe, expect, it, vi } from "vitest";
import type { Env } from "../src/types";

// We test the guard clauses and pure logic of vaultManager functions
// Network calls are not tested (they require actual Vault worker bindings)

// Import after types are available
import {
	createKeypair,
	getPublicKey,
	getUserAddress,
	signWithTransit,
	verifySignatureWithTransit,
} from "../src/utils/vaultManager";

// Minimal mock env with no vault bindings
const emptyEnv: Env = {
	AlgorandRemoteMCP: {} as any,
	ALGORAND_NETWORK: "testnet",
	ALGORAND_ALGOD: "https://testnet-api.algonode.cloud",
	ALGORAND_ALGOD_API: "https://testnet-api.algonode.cloud/v2",
	VAULT_OIDC_ACCESSOR: "test-accessor",
};

describe("VaultManager - Guard Clauses", () => {
	describe("createKeypair", () => {
		it("should fail when HCV_WORKER is not configured", async () => {
			const result = await createKeypair(emptyEnv, "test@example.com", "google");
			expect(result.success).toBe(false);
			expect(result.error).toContain("not configured");
		});

		it("should fail when keyName is not provided", async () => {
			const result = await createKeypair(emptyEnv, undefined, "google");
			expect(result.success).toBe(false);
		});
	});

	describe("getPublicKey", () => {
		it("should fail when HCV_WORKER is not configured", async () => {
			const result = await getPublicKey(emptyEnv, "test@example.com", "google");
			expect(result.success).toBe(false);
			expect(result.error).toContain("not configured");
		});

		it("should fail when keyName is empty", async () => {
			const result = await getPublicKey(emptyEnv, "", "google");
			expect(result.success).toBe(false);
		});
	});

	describe("signWithTransit", () => {
		it("should fail when HCV_WORKER is not configured", async () => {
			const result = await signWithTransit(emptyEnv, "data", "test@example.com", "google");
			expect(result.success).toBe(false);
			expect(result.error).toContain("not configured");
		});

		it("should fail when keyName is empty", async () => {
			const result = await signWithTransit(emptyEnv, "data", "", "google");
			expect(result.success).toBe(false);
		});
	});

	describe("verifySignatureWithTransit", () => {
		it("should fail when HCV_WORKER is not configured", async () => {
			const result = await verifySignatureWithTransit(
				emptyEnv,
				"data",
				"sig",
				"test@example.com",
				"google",
			);
			expect(result.success).toBe(false);
			expect(result.error).toContain("not configured");
		});
	});

	describe("getUserAddress", () => {
		it("should return null when email is not provided", async () => {
			const result = await getUserAddress(emptyEnv, undefined, "google");
			expect(result).toBeNull();
		});

		it("should return null when vault is not configured", async () => {
			const result = await getUserAddress(emptyEnv, "test@example.com", "google");
			// No HCV_WORKER, so getPublicKey will fail and return null
			expect(result).toBeNull();
		});
	});
});

describe("VaultManager - Address Derivation", () => {
	it("should derive correct address from a known public key", () => {
		const account = algosdk.generateAccount();
		const publicKeyBase64 = Buffer.from(
			algosdk.decodeAddress(account.addr.toString()).publicKey,
		).toString("base64");
		const publicKeyBuffer = Buffer.from(publicKeyBase64, "base64");
		const derivedAddress = algosdk.encodeAddress(publicKeyBuffer);
		expect(derivedAddress).toBe(account.addr.toString());
	});
});
