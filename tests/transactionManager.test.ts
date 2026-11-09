import * as msgpack from "algo-msgpack-with-bigint";
import * as algosdk from "algosdk";
import { describe, expect, it } from "vitest";
import { ConcatArrays, encodeSignedTxn } from "../src/tools/transactionManager/generalTransaction";

describe("Transaction Manager - algosdk v3 operations", () => {
	// Use a deterministic account for tests
	const testAccount = algosdk.generateAccount();
	const testAddr = testAccount.addr.toString();
	const receiverAccount = algosdk.generateAccount();
	const receiverAddr = receiverAccount.addr.toString();

	// Mock suggested params
	const mockParams: algosdk.SuggestedParams = {
		flatFee: true,
		fee: BigInt(1000),
		firstValid: BigInt(1000),
		lastValid: BigInt(2000),
		genesisID: "testnet-v1.0",
		genesisHash: new Uint8Array(32).fill(1),
	};

	describe("Payment Transaction (v3 API)", () => {
		it("should create a payment transaction with sender/receiver params", () => {
			const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
				sender: testAddr,
				receiver: receiverAddr,
				amount: 1000000,
				suggestedParams: mockParams,
			});

			expect(txn).toBeDefined();
			expect(txn.txID()).toBeDefined();
			expect(typeof txn.txID()).toBe("string");
		});

		it("should encode and decode unsigned transaction", () => {
			const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
				sender: testAddr,
				receiver: receiverAddr,
				amount: 500000,
				suggestedParams: mockParams,
			});

			const encoded = algosdk.encodeUnsignedTransaction(txn);
			expect(encoded).toBeInstanceOf(Uint8Array);

			const decoded = algosdk.decodeUnsignedTransaction(encoded);
			expect(decoded.txID()).toBe(txn.txID());
		});

		it("should use v3 sender property instead of v2 from", () => {
			const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
				sender: testAddr,
				receiver: receiverAddr,
				amount: 100,
				suggestedParams: mockParams,
			});

			// v3 uses sender property
			expect(txn.sender).toBeDefined();
			expect(txn.sender.publicKey).toBeInstanceOf(Uint8Array);
		});

		it("should use v3 firstValid/lastValid instead of v2 firstRound/lastRound", () => {
			const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
				sender: testAddr,
				receiver: receiverAddr,
				amount: 100,
				suggestedParams: mockParams,
			});

			// v3 uses firstValid/lastValid
			expect(txn.firstValid).toBeDefined();
			expect(txn.lastValid).toBeDefined();
		});

		it("should handle note field", () => {
			const noteBytes = new TextEncoder().encode("test payment note");
			const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
				sender: testAddr,
				receiver: receiverAddr,
				amount: 100,
				note: noteBytes,
				suggestedParams: mockParams,
			});

			expect(txn.note).toBeDefined();
		});
	});

	describe("Transaction Signing (v3 API)", () => {
		it("should sign a transaction and return blob with txid (lowercase)", () => {
			const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
				sender: testAddr,
				receiver: receiverAddr,
				amount: 100,
				suggestedParams: mockParams,
			});

			const signed = algosdk.signTransaction(txn, testAccount.sk);
			// signTransaction returns txID (uppercase) - algod POST response uses lowercase txid
			expect(signed.txID).toBeDefined();
			expect(typeof signed.txID).toBe("string");
			expect(signed.blob).toBeInstanceOf(Uint8Array);
		});
	});

	describe("Manual Signed Transaction Construction (vault-style)", () => {
		it("should construct a signed transaction using msgpack", () => {
			const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
				sender: testAddr,
				receiver: receiverAddr,
				amount: 100,
				suggestedParams: mockParams,
			});

			// The txn object the source helper decodes from the unsigned encoding
			const encodedUnsigned = algosdk.encodeUnsignedTransaction(txn);
			const txnObj = msgpack.decode(encodedUnsigned);
			expect(txnObj).toBeDefined();

			// Sign the transaction the normal way to get a valid signature
			const signed = algosdk.signTransaction(txn, testAccount.sk);
			const sig = algosdk.decodeSignedTransaction(signed.blob).sig!;

			// Construct the signed txn with the source helper (as the vault signing tool does)
			const encoded = encodeSignedTxn(txn, sig, testAccount.addr.publicKey, testAddr);
			expect(encoded).toBeInstanceOf(Uint8Array);
			expect(encoded.length).toBeGreaterThan(0);
			expect((msgpack.decode(encoded) as any).txn).toEqual(txnObj);
		});

		it("should produce the same bytes as algosdk.signTransaction when signer is the sender", () => {
			const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
				sender: testAddr,
				receiver: receiverAddr,
				amount: 100,
				suggestedParams: mockParams,
			});

			const signed = algosdk.signTransaction(txn, testAccount.sk);
			const sig = algosdk.decodeSignedTransaction(signed.blob).sig!;

			const encoded = encodeSignedTxn(txn, sig, testAccount.addr.publicKey, testAddr);
			expect(encoded).toEqual(signed.blob);
			expect(msgpack.decode(encoded)).not.toHaveProperty("sgnr");
		});

		it("should add sgnr field when signer differs from sender", () => {
			const signer = algosdk.generateAccount();
			const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
				sender: testAddr, // sender is different from signer
				receiver: receiverAddr,
				amount: 100,
				suggestedParams: mockParams,
			});

			const signerPubKey = algosdk.decodeAddress(signer.addr.toString()).publicKey;

			// dummy signature
			const encoded = encodeSignedTxn(
				txn,
				new Uint8Array(64),
				signerPubKey,
				signer.addr.toString(),
			);
			const signedTxn = msgpack.decode(encoded) as any;

			expect(signedTxn.sgnr).toBeDefined();
			expect(signedTxn.sgnr).toEqual(signerPubKey);
		});
	});

	describe("ConcatArrays helper", () => {
		it("should concatenate multiple arrays", () => {
			const a = new Uint8Array([1, 2, 3]);
			const b = new Uint8Array([4, 5]);
			const result = ConcatArrays(a, b);
			expect(result).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
		});

		it("should handle empty arrays", () => {
			const a = new Uint8Array([]);
			const b = new Uint8Array([1, 2]);
			const result = ConcatArrays(a, b);
			expect(result).toEqual(new Uint8Array([1, 2]));
		});

		it("should prepend TX tag correctly", () => {
			const TAG = Buffer.from("TX");
			const data = new Uint8Array([1, 2, 3]);
			const result = ConcatArrays(TAG, data);
			expect(result[0]).toBe(84); // 'T'
			expect(result[1]).toBe(88); // 'X'
			expect(result[2]).toBe(1);
			expect(result[3]).toBe(2);
			expect(result[4]).toBe(3);
		});
	});

	describe("Asset Transaction (v3 API)", () => {
		it("should create an asset creation transaction", () => {
			const txn = algosdk.makeAssetCreateTxnWithSuggestedParamsFromObject({
				sender: testAddr,
				total: 1000000,
				decimals: 6,
				defaultFrozen: false,
				assetName: "TestAsset",
				unitName: "TST",
				suggestedParams: mockParams,
			});

			expect(txn).toBeDefined();
			expect(txn.txID()).toBeDefined();
		});

		it("should create an asset transfer (opt-in) transaction", () => {
			const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
				sender: testAddr,
				receiver: testAddr, // opt-in: same sender and receiver
				amount: 0,
				assetIndex: 31566704, // USDC
				suggestedParams: mockParams,
			});

			expect(txn).toBeDefined();
			expect(txn.txID()).toBeDefined();
		});

		it("should create an asset transfer transaction with sender/receiver", () => {
			const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
				sender: testAddr,
				receiver: receiverAddr,
				amount: 100,
				assetIndex: 31566704,
				suggestedParams: mockParams,
			});

			expect(txn).toBeDefined();
		});
	});

	describe("Application Transaction (v3 API)", () => {
		it("should create an app NoOp call using makeApplicationNoOpTxnFromObject", () => {
			const txn = algosdk.makeApplicationNoOpTxnFromObject({
				sender: testAddr,
				appIndex: 123456,
				suggestedParams: mockParams,
			});

			expect(txn).toBeDefined();
			expect(txn.txID()).toBeDefined();
		});

		it("should create an app opt-in transaction", () => {
			const txn = algosdk.makeApplicationOptInTxnFromObject({
				sender: testAddr,
				appIndex: 123456,
				suggestedParams: mockParams,
			});

			expect(txn).toBeDefined();
		});

		it("should create an app delete transaction", () => {
			const txn = algosdk.makeApplicationDeleteTxnFromObject({
				sender: testAddr,
				appIndex: 123456,
				suggestedParams: mockParams,
			});

			expect(txn).toBeDefined();
		});

		it("should create an app clear state transaction", () => {
			const txn = algosdk.makeApplicationClearStateTxnFromObject({
				sender: testAddr,
				appIndex: 123456,
				suggestedParams: mockParams,
			});

			expect(txn).toBeDefined();
		});

		it("should create an app close-out transaction", () => {
			const txn = algosdk.makeApplicationCloseOutTxnFromObject({
				sender: testAddr,
				appIndex: 123456,
				suggestedParams: mockParams,
			});

			expect(txn).toBeDefined();
		});
	});

	describe("Key Registration Transaction (v3 API)", () => {
		it("should create a nonparticipation keyreg transaction", () => {
			const txn = algosdk.makeKeyRegistrationTxnWithSuggestedParamsFromObject({
				sender: testAddr,
				suggestedParams: mockParams,
				nonParticipation: true,
			});

			expect(txn).toBeDefined();
			expect(txn.txID()).toBeDefined();
		});
	});

	describe("Transaction Group (v3 API)", () => {
		it("should assign group ID to multiple transactions", () => {
			const txn1 = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
				sender: testAddr,
				receiver: receiverAddr,
				amount: 100,
				suggestedParams: mockParams,
			});

			const txn2 = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
				sender: testAddr,
				receiver: receiverAddr,
				amount: 200,
				suggestedParams: mockParams,
			});

			const grouped = algosdk.assignGroupID([txn1, txn2]);
			expect(grouped).toHaveLength(2);
			expect(grouped[0].group).toBeDefined();
			expect(grouped[1].group).toBeDefined();
			// All txns in group should have same group ID
			expect(Buffer.from(grouped[0].group!).toString("base64")).toBe(
				Buffer.from(grouped[1].group!).toString("base64"),
			);
		});

		it("should encode/decode grouped transactions", () => {
			const txn1 = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
				sender: testAddr,
				receiver: receiverAddr,
				amount: 100,
				suggestedParams: mockParams,
			});

			const txn2 = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
				sender: testAddr,
				receiver: receiverAddr,
				amount: 200,
				suggestedParams: mockParams,
			});

			const grouped = algosdk.assignGroupID([txn1, txn2]);

			// Encode and decode each transaction
			const encodedTxns = grouped.map((txn) =>
				Buffer.from(algosdk.encodeUnsignedTransaction(txn)).toString("base64"),
			);

			const decodedTxns = encodedTxns.map((encoded) =>
				algosdk.decodeUnsignedTransaction(Buffer.from(encoded, "base64")),
			);

			expect(decodedTxns).toHaveLength(2);
			expect(decodedTxns[0].group).toBeDefined();
			expect(decodedTxns[1].group).toBeDefined();
		});
	});

	describe("Asset Freeze Transaction (v3 API - frozen property)", () => {
		it("should create an asset freeze transaction with frozen property", () => {
			const txn = algosdk.makeAssetFreezeTxnWithSuggestedParamsFromObject({
				sender: testAddr,
				freezeTarget: receiverAddr,
				assetIndex: 31566704,
				frozen: true, // v3 uses 'frozen' not 'freezeState'
				suggestedParams: mockParams,
			});

			expect(txn).toBeDefined();
			expect(txn.txID()).toBeDefined();
		});
	});

	describe("Asset Config Transaction (v3 API - assetSender property)", () => {
		it("should create an asset transfer with assetSender (v3, not revocationTarget)", () => {
			const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
				sender: testAddr,
				receiver: receiverAddr,
				amount: 100,
				assetIndex: 31566704,
				assetSender: testAddr, // v3 uses 'assetSender' not 'revocationTarget'
				suggestedParams: mockParams,
			});

			expect(txn).toBeDefined();
		});
	});
});
