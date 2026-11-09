import * as algosdk from "algosdk";
import { describe, expect, it } from "vitest";
import {
	addressFromBase64PublicKey,
	base64PublicKeyFromAddress,
	createAlgoClient,
	getAccountFromMnemonic,
	providerKey,
} from "../src/tools/walletManager";

/**
 * Tests for Wallet Manager logic
 * Tests client creation, mnemonic handling, and address derivation
 */

describe("Wallet Manager", () => {
	describe("createAlgoClient", () => {
		it("should return null for empty URL", () => {
			expect(createAlgoClient("", "token")).toBeNull();
		});

		it("should return Algodv2 instance for valid URL", () => {
			const client = createAlgoClient("https://testnet-api.algonode.cloud", "");
			expect(client).toBeDefined();
			expect(client).not.toBeNull();
			expect(client).toBeInstanceOf(algosdk.Algodv2);
		});

		it("should accept empty token", () => {
			const client = createAlgoClient("https://testnet-api.algonode.cloud", "");
			expect(client).not.toBeNull();
		});
	});

	describe("getAccountFromMnemonic", () => {
		it("should return null for undefined mnemonic", () => {
			expect(getAccountFromMnemonic(undefined)).toBeNull();
		});

		it("should return null for empty mnemonic", () => {
			expect(getAccountFromMnemonic("")).toBeNull();
		});

		it("should return null for invalid mnemonic", () => {
			expect(getAccountFromMnemonic("invalid mnemonic words")).toBeNull();
		});

		it("should return account for valid mnemonic", () => {
			const account = algosdk.generateAccount();
			const mnemonic = algosdk.secretKeyToMnemonic(account.sk);
			const recovered = getAccountFromMnemonic(mnemonic);
			expect(recovered).not.toBeNull();
			expect(recovered!.addr.toString()).toBe(account.addr.toString());
		});
	});

	describe("Address derivation from public key", () => {
		it("should derive address from base64 public key", () => {
			const account = algosdk.generateAccount();
			const publicKeyBase64 = Buffer.from(account.addr.publicKey).toString("base64");
			const address = addressFromBase64PublicKey(publicKeyBase64);
			expect(address).toBe(account.addr.toString());
		});

		it("should throw for a base64 public key that is not 32 bytes", () => {
			const shortKeyBase64 = Buffer.from(new Uint8Array(16)).toString("base64");
			expect(() => addressFromBase64PublicKey(shortKeyBase64)).toThrow();
		});

		it("should handle decodeAddress → publicKey → encodeAddress round-trip", () => {
			const account = algosdk.generateAccount();
			const addr = account.addr.toString();
			const decoded = algosdk.decodeAddress(addr);
			const reencoded = algosdk.encodeAddress(decoded.publicKey);
			expect(reencoded).toBe(addr);
		});

		it("should round-trip address → base64 public key → address", () => {
			const account = algosdk.generateAccount();
			const addr = account.addr.toString();
			expect(addressFromBase64PublicKey(base64PublicKeyFromAddress(addr))).toBe(addr);
		});
	});

	describe("Provider email key construction", () => {
		it("should create providerEmail key", () => {
			const provider = "google";
			const email = "user@example.com";
			const providerEmail = providerKey(provider, email);
			expect(providerEmail).toBe("google--user@example.com");
		});

		it("should create providerEntity key", () => {
			const provider = "google";
			const entityId = "entity-123";
			const providerEntity = providerKey(provider, entityId);
			expect(providerEntity).toBe("google--entity-123");
		});

		it("should handle twitter provider", () => {
			const providerEmail = providerKey("twitter", "@user");
			expect(providerEmail).toBe("twitter--@user");
		});

		it("should stringify a missing entity ID as null", () => {
			expect(providerKey("google", null)).toBe("google--null");
		});
	});

	describe("Account info response formatting", () => {
		it("should format account info with public key", () => {
			const account = algosdk.generateAccount();
			const address = account.addr.toString();
			const pk = base64PublicKeyFromAddress(address);

			expect(pk).toBeDefined();
			expect(pk.length).toBeGreaterThan(0);
			expect(pk).toBe(Buffer.from(account.addr.publicKey).toString("base64"));

			// Verify public key can be decoded back to address
			const decodedPk = Buffer.from(pk, "base64");
			const recoveredAddress = algosdk.encodeAddress(decodedPk);
			expect(recoveredAddress).toBe(address);
		});

		it("should throw for an invalid address", () => {
			expect(() => base64PublicKeyFromAddress("INVALIDADDRESS")).toThrow();
		});
	});
});
