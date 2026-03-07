import { describe, it, expect } from 'vitest';
import * as algosdk from 'algosdk';
import * as msgpack from 'algo-msgpack-with-bigint';

describe('MessagePack Integration (v3 pattern)', () => {
  const testAccount = algosdk.generateAccount();
  const testAddr = testAccount.addr.toString();
  const receiverAccount = algosdk.generateAccount();
  const receiverAddr = receiverAccount.addr.toString();

  const mockParams: algosdk.SuggestedParams = {
    flatFee: true,
    fee: BigInt(1000),
    firstValid: BigInt(1000),
    lastValid: BigInt(2000),
    genesisID: 'testnet-v1.0',
    genesisHash: new Uint8Array(32).fill(1),
  };

  describe('msgpack.decode(encodeUnsignedTransaction) pattern', () => {
    it('should decode an encoded transaction to a plain object', () => {
      const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: testAddr,
        receiver: receiverAddr,
        amount: 1000000,
        suggestedParams: mockParams,
      });

      const encoded = algosdk.encodeUnsignedTransaction(txn);
      const decoded = msgpack.decode(encoded);

      expect(decoded).toBeDefined();
      expect(typeof decoded).toBe('object');
      // The decoded object should have wire-format fields
      expect(decoded).toHaveProperty('snd'); // sender
      expect(decoded).toHaveProperty('type'); // transaction type
      expect((decoded as any).type).toBe('pay');
    });
  });

  describe('msgpack.encode for signed transactions', () => {
    it('should encode a signed transaction object', () => {
      const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: testAddr,
        receiver: receiverAddr,
        amount: 100,
        suggestedParams: mockParams,
      });

      const encodedUnsigned = algosdk.encodeUnsignedTransaction(txn);
      const txnObj = msgpack.decode(encodedUnsigned);

      const signedTxn = {
        txn: txnObj,
        sig: new Uint8Array(64).fill(0),
      };

      const encoded = msgpack.encode(signedTxn, { sortKeys: true, ignoreUndefined: true });
      expect(encoded).toBeDefined();
      expect(encoded.byteLength).toBeGreaterThan(0);

      // Should be decodable
      const roundtrip = msgpack.decode(new Uint8Array(encoded));
      expect(roundtrip).toHaveProperty('txn');
      expect(roundtrip).toHaveProperty('sig');
    });
  });

  describe('msgpack.encode replaces algosdk.encodeObj (v2 removed)', () => {
    it('should encode arbitrary objects', () => {
      const obj = { key: 'value', number: 42, nested: { a: 1 } };
      const encoded = msgpack.encode(obj);
      expect(encoded).toBeDefined();

      const decoded = msgpack.decode(new Uint8Array(encoded));
      expect((decoded as any).key).toBe('value');
      expect((decoded as any).number).toBe(42);
    });
  });

  describe('BigInt handling in v3', () => {
    it('should handle BigInt fee in suggested params', () => {
      const params: algosdk.SuggestedParams = {
        flatFee: true,
        fee: BigInt(2000),
        firstValid: BigInt(5000),
        lastValid: BigInt(6000),
        genesisID: 'testnet-v1.0',
        genesisHash: new Uint8Array(32).fill(1),
      };

      const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: testAddr,
        receiver: receiverAddr,
        amount: 100,
        suggestedParams: params,
      });

      // Fee should be accessible and convertible to Number
      expect(Number(txn.fee)).toBe(2000);
      expect(Number(txn.firstValid)).toBe(5000);
      expect(Number(txn.lastValid)).toBe(6000);
    });
  });
});
