import * as algosdk from "algosdk";
import { describe, expect, it } from "vitest";

describe("Account Manager - algosdk v3 operations", () => {
	describe("generateAccount", () => {
		it("should generate a valid account", () => {
			const account = algosdk.generateAccount();
			expect(account.addr).toBeDefined();
			expect(account.sk).toBeDefined();
			expect(account.sk).toBeInstanceOf(Uint8Array);
			expect(account.sk.length).toBe(64);
		});

		it("should produce a valid address string via .toString()", () => {
			const account = algosdk.generateAccount();
			const addrStr = account.addr.toString();
			expect(typeof addrStr).toBe("string");
			expect(addrStr.length).toBe(58);
			expect(algosdk.isValidAddress(addrStr)).toBe(true);
		});
	});

	describe("mnemonicToSecretKey", () => {
		it("should derive account from a mnemonic", () => {
			const account = algosdk.generateAccount();
			const mnemonic = algosdk.secretKeyToMnemonic(account.sk);
			const derived = algosdk.mnemonicToSecretKey(mnemonic);

			expect(derived.addr.toString()).toBe(account.addr.toString());
			expect(Buffer.from(derived.sk).toString("hex")).toBe(
				Buffer.from(account.sk).toString("hex"),
			);
		});

		it("should throw on invalid mnemonic", () => {
			expect(() => {
				algosdk.mnemonicToSecretKey("invalid mnemonic words");
			}).toThrow();
		});
	});

	describe("secretKeyToMnemonic", () => {
		it("should produce a 25-word mnemonic", () => {
			const account = algosdk.generateAccount();
			const mnemonic = algosdk.secretKeyToMnemonic(account.sk);
			const words = mnemonic.split(" ");
			expect(words.length).toBe(25);
		});
	});

	describe("decodeAddress", () => {
		it("should decode a valid address to publicKey", () => {
			const account = algosdk.generateAccount();
			const decoded = algosdk.decodeAddress(account.addr.toString());
			expect(decoded.publicKey).toBeInstanceOf(Uint8Array);
			expect(decoded.publicKey.length).toBe(32);
		});

		it("should throw on invalid address", () => {
			expect(() => {
				algosdk.decodeAddress("INVALIDADDRESS");
			}).toThrow();
		});
	});

	describe("encodeAddress", () => {
		it("should roundtrip encode/decode", () => {
			const account = algosdk.generateAccount();
			const addrStr = account.addr.toString();
			const decoded = algosdk.decodeAddress(addrStr);
			const reEncoded = algosdk.encodeAddress(decoded.publicKey);
			expect(reEncoded).toBe(addrStr);
		});
	});

	describe("isValidAddress", () => {
		it("should validate a correct address", () => {
			const account = algosdk.generateAccount();
			expect(algosdk.isValidAddress(account.addr.toString())).toBe(true);
		});

		it("should reject an invalid address", () => {
			expect(algosdk.isValidAddress("notanaddress")).toBe(false);
		});

		it("should reject an empty string", () => {
			expect(algosdk.isValidAddress("")).toBe(false);
		});
	});
});
