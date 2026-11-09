import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as msgpack from "algo-msgpack-with-bigint";
import * as algosdk from "algosdk";
import { describe, expect, it } from "vitest";
import {
	applyQuoteFee,
	concatSignedTxns,
	encodeVaultSignedTxn,
	getAssetDecimals,
	prepareForVaultSigning,
	registerTinymanTools,
} from "../src/tools/tinymanManager";
import type { Env, Props } from "../src/types";

/**
 * Tests for Tinyman Manager logic
 * Tests client creation, transaction construction, and vault signing patterns
 */

// Copy of createAlgoClient from src/tools/tinymanManager.ts: exporting it would clash with walletManager's exported createAlgoClient through `export *` in src/tools/index.ts (TS2308), so the real one is exercised through the swap handlers below.
function createAlgoClient(algodUrl: string, token: string): algosdk.Algodv2 | null {
	if (!algodUrl) {
		return null;
	}
	return new algosdk.Algodv2(token, algodUrl, "");
}

// Register the Tinyman tools on a minimal stand-in server and return their handlers
async function getSwapHandlers(env: Env): Promise<Map<string, (args: any) => Promise<unknown>>> {
	const handlers = new Map<string, (args: any) => Promise<unknown>>();
	const server = {
		tool: (name: string, _description: string, _schema: unknown, handler: any) => {
			handlers.set(name, handler);
		},
	};
	await registerTinymanTools(server as unknown as McpServer, env, {} as Props);
	return handlers;
}

describe("Tinyman Manager", () => {
	const testAccount = algosdk.generateAccount();
	const testAddr = testAccount.addr.toString();
	const receiverAccount = algosdk.generateAccount();
	const receiverAddr = receiverAccount.addr.toString();

	const mockParams: algosdk.SuggestedParams = {
		flatFee: true,
		fee: BigInt(3000),
		firstValid: BigInt(1000),
		lastValid: BigInt(2000),
		genesisID: "testnet-v1.0",
		genesisHash: new Uint8Array(32).fill(1),
	};

	describe("createAlgoClient", () => {
		it("should return null for empty URL", () => {
			expect(createAlgoClient("", "token")).toBeNull();
		});

		it("should create client with valid URL", () => {
			const client = createAlgoClient("https://testnet-api.algonode.cloud", "");
			expect(client).not.toBeNull();
		});

		it("should make both swap tools fail with 'Failed to create Algorand client' when the node URL is empty", async () => {
			const handlers = await getSwapHandlers({ ALGORAND_ALGOD: "" } as unknown as Env);
			const args = {
				address: testAddr,
				assetIn: 0,
				assetOut: 31566704,
				amount: 1000,
				slippage: 0.05,
				network: "testnet",
			};

			for (const name of ["tinyman_fixed_input_swap", "tinyman_fixed_output_swap"]) {
				const handler = handlers.get(name);
				expect(handler).toBeDefined();
				await expect(handler!(args)).rejects.toThrow("Failed to create Algorand client");
			}
		});
	});

	describe("TX tag prepending for vault signing", () => {
		it("should prepend TX tag to encoded transaction", () => {
			const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
				sender: testAddr,
				receiver: receiverAddr,
				amount: 100,
				suggestedParams: mockParams,
			});

			const encodedTxn = Buffer.from(algosdk.encodeUnsignedTransaction(txn)).toString(
				"base64",
			);
			const tagged = prepareForVaultSigning(encodedTxn);

			const taggedBytes = Buffer.from(tagged, "base64");
			expect(taggedBytes[0]).toBe(84); // 'T'
			expect(taggedBytes[1]).toBe(88); // 'X'
		});
	});

	describe("Transaction ordering from quote data", () => {
		it("should create payment transactions from quote data", () => {
			const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
				sender: testAddr,
				receiver: receiverAddr,
				amount: 100,
				suggestedParams: mockParams,
			});
			expect(txn.type).toBe("pay");
		});

		it("should create asset transfer transactions from quote data", () => {
			const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
				sender: testAddr,
				receiver: receiverAddr,
				amount: 100,
				assetIndex: 31566704,
				suggestedParams: mockParams,
			});
			expect(txn.type).toBe("axfer");
		});

		it("should create application call transactions from quote data", () => {
			const txn = algosdk.makeApplicationNoOpTxnFromObject({
				sender: testAddr,
				appIndex: 123456,
				suggestedParams: mockParams,
			});
			expect(txn.type).toBe("appl");
		});
	});

	describe("Signed transaction construction (vault style)", () => {
		it("should create signed txn with msgpack encoding", () => {
			const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
				sender: testAddr,
				receiver: receiverAddr,
				amount: 100,
				suggestedParams: mockParams,
			});

			const txnObj = msgpack.decode(algosdk.encodeUnsignedTransaction(txn));
			const dummySig = new Uint8Array(64);

			const encoded = encodeVaultSignedTxn(txn, dummySig);
			expect(encoded).toBeInstanceOf(Uint8Array);
			expect(encoded.length).toBeGreaterThan(0);

			const decoded = msgpack.decode(encoded) as any;
			expect(decoded.txn).toEqual(txnObj);
			expect(decoded.sig).toEqual(dummySig);
		});
	});

	describe("Group transaction handling", () => {
		it("should assign group ID to multiple transactions", () => {
			const txn1 = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
				sender: testAddr,
				receiver: receiverAddr,
				amount: 100,
				suggestedParams: mockParams,
			});
			const txn2 = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
				sender: testAddr,
				receiver: receiverAddr,
				amount: 50,
				assetIndex: 31566704,
				suggestedParams: mockParams,
			});

			const grouped = algosdk.assignGroupID([txn1, txn2]);
			expect(grouped).toHaveLength(2);
			expect(grouped[0].group).toBeDefined();
			expect(grouped[1].group).toBeDefined();
		});

		it("should concatenate signed transactions into blob", () => {
			const blob1 = new Uint8Array([1, 2, 3]);
			const blob2 = new Uint8Array([4, 5, 6]);
			const combined = concatSignedTxns([blob1, blob2]);
			expect(combined).toHaveLength(6);
			expect(combined[0]).toBe(1);
			expect(combined[3]).toBe(4);
		});
	});

	describe("Asset decimals default", () => {
		it("should default to 6 for Algo (asset 0)", async () => {
			const env = {
				ALGORAND_ALGOD: "https://testnet-api.algonode.cloud",
				ALGORAND_TOKEN: "",
			} as unknown as Env;
			const decimals = await getAssetDecimals(0, env);
			expect(decimals).toBe(6);
		});

		it("should fall back to 6 when the asset lookup fails", async () => {
			const env = { ALGORAND_ALGOD: "", ALGORAND_TOKEN: "" } as unknown as Env;
			const decimals = await getAssetDecimals(31566704, env);
			expect(decimals).toBe(6);
		});
	});

	describe("Fee calculation from quote", () => {
		it("should calculate per-transaction fee from total", () => {
			const params = { ...mockParams, flatFee: false };
			applyQuoteFee(params, { transaction_fee: 9000, transactions: [{}, {}, {}] });
			expect(params.fee).toBe(BigInt(4000));
			expect(params.flatFee).toBe(true);
		});

		it("should use default fee when no quote fee", () => {
			const params = { ...mockParams, fee: BigInt(1000), flatFee: false };
			applyQuoteFee(params, { transactions: [{}, {}, {}] });
			expect(params.fee).toBe(BigInt(3000));
			expect(params.flatFee).toBe(true);
		});
	});
});
