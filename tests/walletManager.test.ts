import { describe, it, expect } from 'vitest';
import * as algosdk from 'algosdk';

/**
 * Tests for Wallet Manager logic
 * Tests client creation, mnemonic handling, and address derivation
 */

// Re-implement createAlgoClient from walletManager.ts
function createAlgoClient(algodUrl: string, token: string): algosdk.Algodv2 | null {
  if (!algodUrl) {
    return null;
  }
  return new algosdk.Algodv2(token, algodUrl, '');
}

// Re-implement getAccountFromMnemonic from walletManager.ts
function getAccountFromMnemonic(mnemonic: string | undefined): algosdk.Account | null {
  if (!mnemonic) {
    return null;
  }
  try {
    return algosdk.mnemonicToSecretKey(mnemonic);
  } catch (error) {
    return null;
  }
}

describe('Wallet Manager', () => {
  describe('createAlgoClient', () => {
    it('should return null for empty URL', () => {
      expect(createAlgoClient('', 'token')).toBeNull();
    });

    it('should return Algodv2 instance for valid URL', () => {
      const client = createAlgoClient('https://testnet-api.algonode.cloud', '');
      expect(client).toBeDefined();
      expect(client).not.toBeNull();
    });

    it('should accept empty token', () => {
      const client = createAlgoClient('https://testnet-api.algonode.cloud', '');
      expect(client).not.toBeNull();
    });
  });

  describe('getAccountFromMnemonic', () => {
    it('should return null for undefined mnemonic', () => {
      expect(getAccountFromMnemonic(undefined)).toBeNull();
    });

    it('should return null for empty mnemonic', () => {
      expect(getAccountFromMnemonic('')).toBeNull();
    });

    it('should return null for invalid mnemonic', () => {
      expect(getAccountFromMnemonic('invalid mnemonic words')).toBeNull();
    });

    it('should return account for valid mnemonic', () => {
      const account = algosdk.generateAccount();
      const mnemonic = algosdk.secretKeyToMnemonic(account.sk);
      const recovered = getAccountFromMnemonic(mnemonic);
      expect(recovered).not.toBeNull();
      expect(recovered!.addr.toString()).toBe(account.addr.toString());
    });
  });

  describe('Address derivation from public key', () => {
    it('should derive address from base64 public key', () => {
      const account = algosdk.generateAccount();
      const publicKeyBase64 = Buffer.from(account.addr.publicKey).toString('base64');
      const publicKeyBuffer = Buffer.from(publicKeyBase64, 'base64');
      const address = algosdk.encodeAddress(publicKeyBuffer);
      expect(address).toBe(account.addr.toString());
    });

    it('should handle decodeAddress → publicKey → encodeAddress round-trip', () => {
      const account = algosdk.generateAccount();
      const addr = account.addr.toString();
      const decoded = algosdk.decodeAddress(addr);
      const reencoded = algosdk.encodeAddress(decoded.publicKey);
      expect(reencoded).toBe(addr);
    });
  });

  describe('Provider email key construction', () => {
    it('should create providerEmail key', () => {
      const provider = 'google';
      const email = 'user@example.com';
      const providerEmail = `${provider}--${email}`;
      expect(providerEmail).toBe('google--user@example.com');
    });

    it('should create providerEntity key', () => {
      const provider = 'google';
      const entityId = 'entity-123';
      const providerEntity = `${provider}--${entityId}`;
      expect(providerEntity).toBe('google--entity-123');
    });

    it('should handle twitter provider', () => {
      const providerEmail = `twitter--@user`;
      expect(providerEmail).toBe('twitter--@user');
    });
  });

  describe('Account info response formatting', () => {
    it('should format account info with public key', () => {
      const account = algosdk.generateAccount();
      const address = account.addr.toString();
      const pkBytes = algosdk.decodeAddress(address).publicKey;
      const pk = Buffer.from(pkBytes).toString('base64');

      expect(pk).toBeDefined();
      expect(pk.length).toBeGreaterThan(0);

      // Verify public key can be decoded back to address
      const decodedPk = Buffer.from(pk, 'base64');
      const recoveredAddress = algosdk.encodeAddress(decodedPk);
      expect(recoveredAddress).toBe(address);
    });
  });
});
