/**
 * Wallet Resources for Algorand Remote MCP
 * Provides URI-based access to wallet and account information
 */

import algosdk from 'algosdk';
import { Env, Props, VaultResponse } from '../../types';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  getUserAddress,
  getPublicKey,
  ensureUserAccount
} from '../../utils/vaultManager';

/**
 * Create and validate an Algorand client
 */
function createAlgoClient(algodUrl: string, token: string): algosdk.Algodv2 | null {
  if (!algodUrl) {
    console.error('Algorand node URL not configured');
    return null;
  }

  return new algosdk.Algodv2(token, algodUrl, '');
}

/**
 * Get account from mnemonic
 */
function getAccountFromMnemonic(mnemonic: string | undefined): algosdk.Account | null {
  if (!mnemonic) {
    console.error('No active agent wallet configured');
    return null;
  }

  try {
    return algosdk.mnemonicToSecretKey(mnemonic);
  } catch (error) {
    console.error('Invalid mnemonic:', error);
    return null;
  }
}

/**
 * Register wallet resources to the MCP server
 */
export async function registerWalletResources(server: McpServer, env: Env, props: Props): Promise<void> {
  // Ensure user has a vault-based account 
  try {
    const accType = await ensureUserAccount(env, props.email, props.provider || 'google');
    console.log(`User has a ${accType}-based account`);
  } catch (error: any) {
    throw new Error(`Failed to ensure user account: ${error.message || 'Unknown error'}`);
  }
  // === Wallet Public Key ===
  server.resource("Wallet Account Public Key", "algorand://wallet/publickey", async (uri) => {
    try {

      const publicKeyResult = await getPublicKey(env, props.email);

      if (!publicKeyResult.success || publicKeyResult.error) {
        return {
          contents: [{
            uri: uri.href,
            text: JSON.stringify({
              error: "No active agent wallet configured"
            }, null, 2)
          }]
        };
      }

      if (!publicKeyResult.success || !publicKeyResult.publicKey) {
        throw new Error(publicKeyResult.error || 'Failed to get public key from vault');
      }
      // Get address using the unified approach
      const entityId = await env.VAULT_ENTITIES.get(props.email);
      console.log(`Entity ID for ${props.email} from KV store:`, entityId);
      let roleId = null;
      if (entityId) {
        roleId = await env.VAULT_ENTITIES.get(entityId);
        console.log(`Role ID for ${entityId} from KV store:`, roleId);
      }

      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify({
            publicKey: publicKeyResult.publicKey,
            format: 'base64',
            role_id: roleId
          }, null, 2)
        }]
      };

    } catch (error: any) {
      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify({
            error: `Failed to get public key: ${error.message || 'Unknown error'}`
          }, null, 2)
        }]
      };
    }
  });

  // === Wallet Address ===
  server.resource("Wallet Account Address", "algorand://wallet/address", async (uri) => {
    try {
      // Get address using the unified approach
      const address = await getUserAddress(env, props.email);
      if (!address) {
        return {
          contents: [{
            uri: uri.href,
            text: JSON.stringify({
              error: "No active agent wallet configured"
            }, null, 2)
          }]
        };
      }

      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify({
            address,
          }, null, 2)
        }]
      };
    } catch (error: any) {
      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify({
            error: `Failed to get address: ${error.message || 'Unknown error'}`
          }, null, 2)
        }]
      };
    }
  });

  // === Wallet Account ===
  server.resource("Wallet Account Information", "algorand://wallet/account", async (uri) => {
    if (!env.ALGORAND_ALGOD) {
      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify({
            error: "Algorand node URL not configured"
          }, null, 2)
        }]
      };
    }

    try {
      // Get address using the unified approach
      const address = await getUserAddress(env, props.email);

      if (!address) {
        return {
          contents: [{
            uri: uri.href,
            text: JSON.stringify({
              error: "No active agent wallet configured"
            }, null, 2)
          }]
        };
      }

      // Create algod client
      const algodClient = createAlgoClient(env.ALGORAND_ALGOD, env.ALGORAND_TOKEN || '');
      if (!algodClient) {
        throw new Error('Failed to create Algorand client');
      }

      // Get account information
      const accountInfo = await algodClient.accountInformation(address).do();

      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify({
            accounts: [{
              address,
              amount: accountInfo.amount,
              assets: accountInfo.assets || []
            }]
          }, null, 2)
        }]
      };
    } catch (error: any) {
      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify({
            error: `Failed to get account info: ${error.message || 'Unknown error'}`
          }, null, 2)
        }]
      };
    }
  });

  // === Wallet Assets ===
  server.resource("Wallet Account Assets", "algorand://wallet/assets", async (uri) => {
    if (!env.ALGORAND_ALGOD) {
      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify({
            error: "Algorand node URL not configured"
          }, null, 2)
        }]
      };
    }

    try {
      // Get address using the unified approach
      const address = await getUserAddress(env, props.email);

      if (!address) {
        return {
          contents: [{
            uri: uri.href,
            text: JSON.stringify({
              error: "No active agent wallet configured"
            }, null, 2)
          }]
        };
      }

      // Create algod client
      const algodClient = createAlgoClient(env.ALGORAND_ALGOD, env.ALGORAND_TOKEN || '');
      if (!algodClient) {
        throw new Error('Failed to create Algorand client');
      }

      // Get account information
      const accountInfo = await algodClient.accountInformation(address).do();

      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify({
            assets: accountInfo.assets || []
          }, null, 2)
        }]
      };
    } catch (error: any) {
      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify({
            error: `Failed to get asset info: ${error.message || 'Unknown error'}`
          }, null, 2)
        }]
      };
    }
  });
}
