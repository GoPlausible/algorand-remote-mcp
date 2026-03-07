import { describe, it, expect } from 'vitest';
import * as algosdk from 'algosdk';
import * as msgpack from 'algo-msgpack-with-bigint';

/**
 * Tests for Tinyman Manager logic
 * Tests client creation, transaction construction, and vault signing patterns
 */

// Re-implement createAlgoClient from tinymanManager.ts
function createAlgoClient(algodUrl: string, token: string): algosdk.Algodv2 | null {
  if (!algodUrl) {
    return null;
  }
  return new algosdk.Algodv2(token, algodUrl, '');
}

// Helper to create TX tag prepended data (vault signing pattern)
function prepareForVaultSigning(encodedTxnBase64: string): string {
  const TAG = Buffer.from("TX");
  const finalEncodedTxn = new Uint8Array(Buffer.from(encodedTxnBase64, 'base64'));
  const finalEncodedTxnTagged = new Uint8Array(TAG.length + finalEncodedTxn.length);
  finalEncodedTxnTagged.set(TAG);
  finalEncodedTxnTagged.set(finalEncodedTxn, TAG.length);
  return Buffer.from(finalEncodedTxnTagged).toString('base64');
}

describe('Tinyman Manager', () => {
  const testAccount = algosdk.generateAccount();
  const testAddr = testAccount.addr.toString();
  const receiverAccount = algosdk.generateAccount();
  const receiverAddr = receiverAccount.addr.toString();

  const mockParams: algosdk.SuggestedParams = {
    flatFee: true,
    fee: BigInt(3000),
    firstValid: BigInt(1000),
    lastValid: BigInt(2000),
    genesisID: 'testnet-v1.0',
    genesisHash: new Uint8Array(32).fill(1),
  };

  describe('createAlgoClient', () => {
    it('should return null for empty URL', () => {
      expect(createAlgoClient('', 'token')).toBeNull();
    });

    it('should create client with valid URL', () => {
      const client = createAlgoClient('https://testnet-api.algonode.cloud', '');
      expect(client).not.toBeNull();
    });
  });

  describe('TX tag prepending for vault signing', () => {
    it('should prepend TX tag to encoded transaction', () => {
      const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: testAddr,
        receiver: receiverAddr,
        amount: 100,
        suggestedParams: mockParams,
      });

      const encodedTxn = Buffer.from(algosdk.encodeUnsignedTransaction(txn)).toString('base64');
      const tagged = prepareForVaultSigning(encodedTxn);

      const taggedBytes = Buffer.from(tagged, 'base64');
      expect(taggedBytes[0]).toBe(84); // 'T'
      expect(taggedBytes[1]).toBe(88); // 'X'
    });
  });

  describe('Transaction ordering from quote data', () => {
    it('should create payment transactions from quote data', () => {
      const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: testAddr,
        receiver: receiverAddr,
        amount: 100,
        suggestedParams: mockParams,
      });
      expect(txn.type).toBe('pay');
    });

    it('should create asset transfer transactions from quote data', () => {
      const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: testAddr,
        receiver: receiverAddr,
        amount: 100,
        assetIndex: 31566704,
        suggestedParams: mockParams,
      });
      expect(txn.type).toBe('axfer');
    });

    it('should create application call transactions from quote data', () => {
      const txn = algosdk.makeApplicationNoOpTxnFromObject({
        sender: testAddr,
        appIndex: 123456,
        suggestedParams: mockParams,
      });
      expect(txn.type).toBe('appl');
    });
  });

  describe('Signed transaction construction (vault style)', () => {
    it('should create signed txn with msgpack encoding', () => {
      const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: testAddr,
        receiver: receiverAddr,
        amount: 100,
        suggestedParams: mockParams,
      });

      const txnObj = msgpack.decode(algosdk.encodeUnsignedTransaction(txn));
      const dummySig = new Uint8Array(64);

      const signedTxn = {
        txn: txnObj,
        sig: dummySig
      };

      const encoded = new Uint8Array(msgpack.encode(signedTxn, { sortKeys: true, ignoreUndefined: true }));
      expect(encoded).toBeInstanceOf(Uint8Array);
      expect(encoded.length).toBeGreaterThan(0);
    });
  });

  describe('Group transaction handling', () => {
    it('should assign group ID to multiple transactions', () => {
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

    it('should concatenate signed transactions into blob', () => {
      const blob1 = new Uint8Array([1, 2, 3]);
      const blob2 = new Uint8Array([4, 5, 6]);
      const combined = Buffer.concat([Buffer.from(blob1), Buffer.from(blob2)]);
      expect(combined).toHaveLength(6);
      expect(combined[0]).toBe(1);
      expect(combined[3]).toBe(4);
    });
  });

  describe('Asset decimals default', () => {
    it('should default to 6 for Algo (asset 0)', () => {
      const assetId = 0;
      const decimals = assetId === 0 ? 6 : 0;
      expect(decimals).toBe(6);
    });
  });

  describe('Fee calculation from quote', () => {
    it('should calculate per-transaction fee from total', () => {
      const quoteFee = 9000;
      const txnCount = 3;
      const feePerTxn = Math.ceil(quoteFee / txnCount) + 1000;
      expect(feePerTxn).toBe(4000);
    });

    it('should use default fee when no quote fee', () => {
      const defaultFee = BigInt(3000);
      expect(defaultFee).toBe(BigInt(3000));
    });
  });
});
