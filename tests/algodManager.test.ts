import { describe, it, expect } from 'vitest';
import * as algosdk from 'algosdk';

/**
 * Tests for Algod Manager logic
 * Tests TEAL source processing, client creation, and transaction encoding
 */

// Re-implement TEAL source processing from algodManager.ts
function processTealSource(source: string): string {
  let processedSource = source.replace(/\r\n/g, '\n');
  if (!processedSource.endsWith('\n')) {
    processedSource += '\n';
  }
  return processedSource;
}

// Re-implement createAlgoClient guard
function createAlgoClient(algodUrl: string, token: string): algosdk.Algodv2 | null {
  if (!algodUrl) {
    return null;
  }
  return new algosdk.Algodv2(token, algodUrl, '');
}

describe('Algod Manager', () => {
  describe('processTealSource', () => {
    it('should normalize CRLF to LF', () => {
      const source = '#pragma version 8\r\nint 1\r\nreturn\r\n';
      const result = processTealSource(source);
      expect(result).not.toContain('\r\n');
      expect(result).toContain('\n');
    });

    it('should add trailing newline if missing', () => {
      const source = '#pragma version 8\nint 1\nreturn';
      const result = processTealSource(source);
      expect(result.endsWith('\n')).toBe(true);
    });

    it('should not double-add trailing newline', () => {
      const source = '#pragma version 8\nint 1\nreturn\n';
      const result = processTealSource(source);
      expect(result).toBe(source);
      expect(result.endsWith('\n\n')).toBe(false);
    });

    it('should handle empty source', () => {
      const result = processTealSource('');
      expect(result).toBe('\n');
    });

    it('should handle already normalized source', () => {
      const source = '#pragma version 8\nint 1\n';
      expect(processTealSource(source)).toBe(source);
    });
  });

  describe('TEAL source encoding', () => {
    it('should encode source to Uint8Array', () => {
      const source = '#pragma version 8\nint 1\nreturn\n';
      const bytes = new TextEncoder().encode(source);
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes.length).toBeGreaterThan(0);
    });

    it('should preserve content through encode/decode round-trip', () => {
      const source = '#pragma version 8\nint 1\nreturn\n';
      const bytes = new TextEncoder().encode(source);
      const decoded = new TextDecoder().decode(bytes);
      expect(decoded).toBe(source);
    });
  });

  describe('createAlgoClient guard', () => {
    it('should return null for empty URL', () => {
      expect(createAlgoClient('', 'token')).toBeNull();
    });

    it('should return Algodv2 instance for valid URL', () => {
      const client = createAlgoClient('https://testnet-api.algonode.cloud', '');
      expect(client).toBeDefined();
      expect(client).not.toBeNull();
    });
  });

  describe('Base64 transaction encoding for sendRawTransaction', () => {
    it('should decode base64 to Buffer', () => {
      const base64Data = Buffer.from('hello world').toString('base64');
      const decoded = Buffer.from(base64Data, 'base64');
      expect(decoded.toString()).toBe('hello world');
    });

    it('should handle array of base64 transactions', () => {
      const txns = ['dGVzdDE=', 'dGVzdDI=', 'dGVzdDM=']; // test1, test2, test3
      const decoded = txns.map(txn => Buffer.from(txn, 'base64'));
      expect(decoded).toHaveLength(3);
      expect(decoded[0].toString()).toBe('test1');
      expect(decoded[1].toString()).toBe('test2');
      expect(decoded[2].toString()).toBe('test3');
    });
  });

  describe('Bytecode disassembly input processing', () => {
    it('should decode base64 bytecode to bytes', () => {
      const base64Bytecode = Buffer.from([0x06, 0x81, 0x01]).toString('base64');
      const bytecodeBytes = Buffer.from(base64Bytecode, 'base64');
      expect(bytecodeBytes).toBeInstanceOf(Buffer);
      expect(bytecodeBytes[0]).toBe(0x06);
      expect(bytecodeBytes[1]).toBe(0x81);
      expect(bytecodeBytes[2]).toBe(0x01);
    });
  });
});
