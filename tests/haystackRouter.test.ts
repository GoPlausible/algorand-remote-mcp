import { describe, it, expect } from 'vitest';
import { Env } from '../src/types';

// Test the router client factory logic
import { getRouterClient } from '../src/tools/apiManager/hayrouter/routerClient';

// Minimal env for testing
const testEnv: Env = {
  AlgorandRemoteMCP: {} as any,
  ALGORAND_NETWORK: 'mainnet',
  ALGORAND_ALGOD: 'https://mainnet-api.algonode.cloud',
  ALGORAND_ALGOD_API: 'https://mainnet-api.algonode.cloud/v2',
  VAULT_OIDC_ACCESSOR: 'test',
};

describe('Haystack Router Client', () => {
  it('should create a RouterClient instance', () => {
    const client = getRouterClient(testEnv);
    expect(client).toBeDefined();
  });

  it('should return the same instance for the same network (memoization)', () => {
    const client1 = getRouterClient(testEnv);
    const client2 = getRouterClient(testEnv);
    expect(client1).toBe(client2);
  });

  it('should use custom API key when provided', () => {
    const envWithKey: Env = {
      ...testEnv,
      HAYSTACK_API_KEY: 'custom-api-key-12345',
      ALGORAND_NETWORK: 'testnet-haystack', // different network to avoid memoization
    };
    const client = getRouterClient(envWithKey);
    expect(client).toBeDefined();
  });

  it('should use custom algod URI when provided', () => {
    const envWithAlgod: Env = {
      ...testEnv,
      ALGORAND_ALGOD: 'https://custom-algod.example.com',
      ALGORAND_NETWORK: 'custom-net', // different network to avoid memoization
    };
    const client = getRouterClient(envWithAlgod);
    expect(client).toBeDefined();
  });
});
