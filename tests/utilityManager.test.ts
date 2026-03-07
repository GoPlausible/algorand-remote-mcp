import { describe, it, expect } from 'vitest';
import * as algosdk from 'algosdk';

describe('Utility Manager - algosdk v3 operations', () => {
  describe('getApplicationAddress', () => {
    it('should return a string address for an app ID', () => {
      const address = algosdk.getApplicationAddress(123456).toString();
      expect(typeof address).toBe('string');
      expect(address.length).toBe(58);
      expect(algosdk.isValidAddress(address)).toBe(true);
    });

    it('should be deterministic', () => {
      const addr1 = algosdk.getApplicationAddress(123456).toString();
      const addr2 = algosdk.getApplicationAddress(123456).toString();
      expect(addr1).toBe(addr2);
    });

    it('should return different addresses for different app IDs', () => {
      const addr1 = algosdk.getApplicationAddress(1).toString();
      const addr2 = algosdk.getApplicationAddress(2).toString();
      expect(addr1).not.toBe(addr2);
    });
  });

  describe('signBytes / verifyBytes', () => {
    it('should sign and verify bytes correctly', () => {
      const account = algosdk.generateAccount();
      const message = new TextEncoder().encode('test message');
      const signature = algosdk.signBytes(message, account.sk);

      expect(signature).toBeInstanceOf(Uint8Array);
      expect(signature.length).toBe(64);

      const isValid = algosdk.verifyBytes(message, signature, account.addr);
      expect(isValid).toBe(true);
    });

    it('should fail verification with wrong address', () => {
      const account1 = algosdk.generateAccount();
      const account2 = algosdk.generateAccount();
      const message = new TextEncoder().encode('test message');
      const signature = algosdk.signBytes(message, account1.sk);

      const isValid = algosdk.verifyBytes(message, signature, account2.addr);
      expect(isValid).toBe(false);
    });

    it('should fail verification with tampered message', () => {
      const account = algosdk.generateAccount();
      const message = new TextEncoder().encode('original');
      const signature = algosdk.signBytes(message, account.sk);

      const tampered = new TextEncoder().encode('tampered');
      const isValid = algosdk.verifyBytes(tampered, signature, account.addr);
      expect(isValid).toBe(false);
    });
  });

  describe('encodeUint64', () => {
    it('should encode a uint64 value', () => {
      const encoded = algosdk.encodeUint64(12345);
      expect(encoded).toBeInstanceOf(Uint8Array);
      expect(encoded.length).toBe(8);
    });

    it('should encode zero', () => {
      const encoded = algosdk.encodeUint64(0);
      expect(encoded).toBeInstanceOf(Uint8Array);
      const allZeros = Array.from(encoded).every(b => b === 0);
      expect(allZeros).toBe(true);
    });
  });
});
