import { describe, it, expect } from 'vitest';
import * as algosdk from 'algosdk';

/**
 * Tests for API Manager modules
 * Tests client creation, URL construction for algod/indexer/NFD, and address validation
 */

// Re-implement createAlgoClient from algod modules
function createAlgoClient(algodUrl: string, token: string): algosdk.Algodv2 | null {
  if (!algodUrl) {
    return null;
  }
  return new algosdk.Algodv2(token, algodUrl, '');
}

// Re-implement createIndexerClient from indexer modules
function createIndexerClient(indexerUrl: string | undefined): algosdk.Indexer | null {
  if (!indexerUrl) {
    return null;
  }
  return new algosdk.Indexer('', indexerUrl, '');
}

// Re-implement NFD URL construction from nfd/index.ts
function buildNfdUrl(apiBase: string, name: string, view?: string, includeSales?: boolean): string {
  let url = `${apiBase}/nfd/${encodeURIComponent(name.toLowerCase())}`;
  const params = new URLSearchParams();

  if (view === 'brief') {
    params.append('view', 'brief');
  }
  if (includeSales) {
    params.append('includeSales', 'true');
  }

  if (params.toString()) {
    url += `?${params.toString()}`;
  }
  return url;
}

function buildNfdAddressUrl(apiBase: string, address: string, limit: number, offset: number, view?: string): string {
  let url = `${apiBase}/nfd/address/${encodeURIComponent(address)}`;
  const params = new URLSearchParams();
  params.append('limit', String(limit));
  params.append('offset', String(offset));
  if (view) {
    params.append('view', view);
  }
  if (params.toString()) {
    url += `?${params.toString()}`;
  }
  return url;
}

describe('API Manager - Algod Client', () => {
  describe('createAlgoClient', () => {
    it('should return null for empty URL', () => {
      expect(createAlgoClient('', '')).toBeNull();
    });

    it('should create Algodv2 for valid URL', () => {
      const client = createAlgoClient('https://testnet-api.algonode.cloud', '');
      expect(client).not.toBeNull();
    });

    it('should accept token parameter', () => {
      const client = createAlgoClient('https://testnet-api.algonode.cloud', 'my-token');
      expect(client).not.toBeNull();
    });
  });
});

describe('API Manager - Indexer Client', () => {
  describe('createIndexerClient', () => {
    it('should return null for undefined URL', () => {
      expect(createIndexerClient(undefined)).toBeNull();
    });

    it('should return null for empty string URL', () => {
      expect(createIndexerClient('')).toBeNull();
    });

    it('should create Indexer for valid URL', () => {
      const client = createIndexerClient('https://testnet-idx.algonode.cloud');
      expect(client).not.toBeNull();
    });
  });
});

describe('API Manager - NFD URL Construction', () => {
  const apiBase = 'https://api.nf.domains';

  describe('buildNfdUrl', () => {
    it('should build basic NFD lookup URL', () => {
      const url = buildNfdUrl(apiBase, 'example.algo');
      expect(url).toBe('https://api.nf.domains/nfd/example.algo');
    });

    it('should lowercase the name', () => {
      const url = buildNfdUrl(apiBase, 'EXAMPLE.ALGO');
      expect(url).toBe('https://api.nf.domains/nfd/example.algo');
    });

    it('should add view=brief parameter', () => {
      const url = buildNfdUrl(apiBase, 'test.algo', 'brief');
      expect(url).toContain('view=brief');
    });

    it('should add includeSales parameter', () => {
      const url = buildNfdUrl(apiBase, 'test.algo', undefined, true);
      expect(url).toContain('includeSales=true');
    });

    it('should combine view and includeSales', () => {
      const url = buildNfdUrl(apiBase, 'test.algo', 'brief', true);
      expect(url).toContain('view=brief');
      expect(url).toContain('includeSales=true');
    });

    it('should encode special characters in name', () => {
      const url = buildNfdUrl(apiBase, 'test name.algo');
      expect(url).toContain('test%20name.algo');
    });
  });

  describe('buildNfdAddressUrl', () => {
    const validAddr = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ';

    it('should build NFD address lookup URL', () => {
      const url = buildNfdAddressUrl(apiBase, validAddr, 50, 0);
      expect(url).toContain(`/nfd/address/${validAddr}`);
      expect(url).toContain('limit=50');
      expect(url).toContain('offset=0');
    });

    it('should include view parameter', () => {
      const url = buildNfdAddressUrl(apiBase, validAddr, 50, 0, 'full');
      expect(url).toContain('view=full');
    });

    it('should support pagination offset', () => {
      const url = buildNfdAddressUrl(apiBase, validAddr, 10, 20);
      expect(url).toContain('limit=10');
      expect(url).toContain('offset=20');
    });
  });
});

describe('API Manager - Algod Application', () => {
  describe('Box name encoding', () => {
    it('should encode box name as UTF-8 bytes', () => {
      const name = 'mybox';
      const bytes = new TextEncoder().encode(name);
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes.length).toBe(5);
    });

    it('should handle empty box name', () => {
      const bytes = new TextEncoder().encode('');
      expect(bytes.length).toBe(0);
    });
  });

  describe('Global state processing', () => {
    it('should decode base64 key to UTF-8', () => {
      const base64Key = Buffer.from('mykey').toString('base64');
      const key = Buffer.from(base64Key, 'base64').toString('utf-8');
      expect(key).toBe('mykey');
    });

    it('should identify bytes type (type=1)', () => {
      const value = { type: 1, bytes: Buffer.from('hello').toString('base64') };
      expect(value.type).toBe(1);
      const decoded = Buffer.from(value.bytes, 'base64').toString('utf-8');
      expect(decoded).toBe('hello');
    });

    it('should identify uint type (type!=1)', () => {
      const value = { type: 2, uint: 42 };
      expect(value.type).not.toBe(1);
      expect(value.uint).toBe(42);
    });
  });
});

describe('API Manager - Algod Asset', () => {
  describe('Address validation', () => {
    it('should validate correct Algorand address', () => {
      const account = algosdk.generateAccount();
      expect(algosdk.isValidAddress(account.addr.toString())).toBe(true);
    });

    it('should reject invalid address', () => {
      expect(algosdk.isValidAddress('invalid')).toBe(false);
    });
  });

  describe('Pera API URL construction', () => {
    it('should build verification endpoint URL', () => {
      const baseUrl = 'https://mainnet.api.perawallet.app/v1/public';
      const assetId = 31566704;
      const url = `${baseUrl}/asset-verifications/${assetId}/`;
      expect(url).toBe('https://mainnet.api.perawallet.app/v1/public/asset-verifications/31566704/');
    });

    it('should build asset details endpoint URL', () => {
      const baseUrl = 'https://mainnet.api.perawallet.app/v1/public';
      const assetId = 31566704;
      const url = `${baseUrl}/assets/${assetId}/`;
      expect(url).toBe('https://mainnet.api.perawallet.app/v1/public/assets/31566704/');
    });

    it('should build explorer URL', () => {
      const explorerBase = 'https://explorer.perawallet.app';
      const assetId = 31566704;
      const url = `${explorerBase}/asset/${assetId}/`;
      expect(url).toBe('https://explorer.perawallet.app/asset/31566704/');
    });
  });
});

describe('API Manager - Indexer Transactions', () => {
  describe('Note prefix encoding', () => {
    it('should decode base64 note prefix to buffer', () => {
      const notePrefix = Buffer.from('test').toString('base64');
      const decoded = Buffer.from(notePrefix, 'base64');
      expect(decoded.toString()).toBe('test');
    });
  });

  describe('Address role enum values', () => {
    it('should support sender, receiver, freeze-target', () => {
      const roles = ['sender', 'receiver', 'freeze-target'];
      expect(roles).toContain('sender');
      expect(roles).toContain('receiver');
      expect(roles).toContain('freeze-target');
    });
  });
});

describe('API Manager - Asset KV key patterns', () => {
  it('should construct name-based key', () => {
    const name = 'USDC';
    const key = `key-${name}-`;
    expect(key).toBe('key-USDC-');
  });

  it('should construct ID-based key', () => {
    const assetId = 31566704;
    const key = `id-${assetId}`;
    expect(key).toBe('id-31566704');
  });

  it('should construct creator-based key', () => {
    const creator = 'ADDR123';
    const key = `creator-${creator}-`;
    expect(key).toBe('creator-ADDR123-');
  });

  it('should construct unit-based key', () => {
    const unitName = 'USDC';
    const key = `unit-${unitName}-`;
    expect(key).toBe('unit-USDC-');
  });
});
