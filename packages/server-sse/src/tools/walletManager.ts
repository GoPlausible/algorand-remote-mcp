/**
 * Wallet Manager for Algorand Remote MCP
 * Provides tool-based access to wallet and account information
 */

import algosdk from 'algosdk';
import { z } from 'zod';
import { ResponseProcessor } from '../utils';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Env, Props, VaultResponse } from '../types';
import {
  createKeypair,
  getPublicKey,
  getUserAccountType,
  getUserAddress,
  ensureUserAccount,
  deleteKeypair
} from '../utils/vaultManager';

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
 * Register wallet management tools to the MCP server
 */
export async function registerWalletTools(server: McpServer, env: Env, props: Props): Promise<void> {
  console.log('Registering wallet tools for Algorand Remote MCP');

  // Ensure user has a vault-based account 
  try {
    const accountType = await ensureUserAccount(env, props.email);
    console.log(`User has a ${accountType}-based account`);
  } catch (error: any) {
    throw new Error(`Failed to ensure user account: ${error.message || 'Unknown error'}`);
  }
  //Reset wallet account
  server.tool(
    'reset_wallet_account',
    'Reset the wallet account for the configured user',
    {},
    async () => {
      try {
        // Check account type
        const accountType = await getUserAccountType(env, props.email);

        if (accountType === 'vault') {
          // For vault-based accounts, create a new keypair in the vault
          console.log('Creating new vault-based keypair for user:', props.email);

          // Delete existing keypair if it exists
          // Note: This would require a delete endpoint in the vault worker

          // Create new keypair
          await deleteKeypair(env, props.email);
          const keypairResult = await createKeypair(env, props.email);

          if (!keypairResult.success) {
            throw new Error(keypairResult.error || 'Failed to create keypair in vault');
          }

          // Get the address from the public key
          const publicKeyResult = await getPublicKey(env, props.email);

          if (!publicKeyResult.success || !publicKeyResult.publicKey) {
            throw new Error(publicKeyResult.error || 'Failed to get public key from vault');
          }

          // Convert the public key to an Algorand address
          const publicKeyBuffer = Buffer.from(publicKeyResult.publicKey, 'base64');
          const address = algosdk.encodeAddress(publicKeyBuffer);

          return ResponseProcessor.processResponse({
            address,
            accountType: 'vault'
          });
        } else {
          // No account found, create a new vault-based account
          console.log('No account found, creating new vault-based keypair for user:', props.email);
          const keypairResult = await createKeypair(env, props.email);

          if (!keypairResult.success) {
            throw new Error(keypairResult.error || 'Failed to create keypair in vault');
          }

          // Get the address from the public key
          const publicKeyResult = await getPublicKey(env, props.email);

          if (!publicKeyResult.success || !publicKeyResult.publicKey) {
            throw new Error(publicKeyResult.error || 'Failed to get public key from vault');
          }

          // Convert the public key to an Algorand address
          const publicKeyBuffer = Buffer.from(publicKeyResult.publicKey, 'base64');
          const address = algosdk.encodeAddress(publicKeyBuffer);

          return ResponseProcessor.processResponse({
            address,
            accountType: 'vault'
          });
        }
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Failed to reset wallet account: ${error.message || 'Unknown error'}`
          }]
        };
      }
    }
  );
  // Get wallet public key
  server.tool(
    'get_wallet_publickey',
    'Get the public key for the configured wallet',
    {},
    async () => {
      try {
        // Check account type
        const accountType = await getUserAccountType(env, props.email);

        if (accountType === null) {
          return {
            content: [{
              type: 'text',
              text: 'No active agent wallet configured'
            }]
          };
        }

        // Get public key from vault
          const publicKeyResult = await getPublicKey(env, props.email);

          if (!publicKeyResult.success || !publicKeyResult.publicKey) {
            throw new Error(publicKeyResult.error || 'Failed to get public key from vault');
          }

          return ResponseProcessor.processResponse({
            publicKey: publicKeyResult.publicKey,
            format: 'base64',
            accountType: 'vault'
          }); 
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Failed to get public key: ${error.message || 'Unknown error'}`
          }]
        };
      }
    }
  );

  // Get wallet address
  server.tool(
    'get_wallet_address',
    'Get the address for the configured wallet',
    {},
    async () => {
      try {
        // Get address using the unified approach
        const address = await getUserAddress(env, props.email);

        if (!address) {
          return {
            content: [{
              type: 'text',
              text: 'No active agent wallet configured'
            }]
          };
        }

        const entityId = await env.VAULT_ENTITIES.get(props.email);
        console.log(`Entity ID for ${props.email} from KV store:`, entityId);
        const roleId = await env.VAULT_ENTITIES.get(entityId);
        console.log(`Role ID for ${entityId} from KV store:`, roleId);

        return ResponseProcessor.processResponse({
          address,
          role_id: roleId
        });
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Failed to get address: ${error.message || 'Unknown error'}`
          }]
        };
      }
    }
  );

  // Get wallet role UUID
  server.tool(
    'get_wallet_role',
    'Get the role UUID for the configured wallet to be used to login into Hashicorp Vault with OIDC',
    {},
    async () => {
      try {
        // Get address using the unified approach
        const entityId = await env.VAULT_ENTITIES.get(props.email);
        console.log(`Entity ID for ${props.email} from KV store:`, entityId);
        const roleId = await env.VAULT_ENTITIES.get(entityId);
        console.log(`Role ID for ${entityId} from KV store:`, roleId);

        if (!entityId) {
          return {
            content: [{
              type: 'text',
              text: 'No active agent wallet configured'
            }]
          };
        }

        return ResponseProcessor.processResponse({
          role_id: roleId,
       
        });
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Failed to get address: ${error.message || 'Unknown error'}`
          }]
        };
      }
    }
  );

  // Get wallet account information
  server.tool(
    'get_wallet_info',
    'Get the account information for the configured wallet',
    {},
    async () => {
      if (!env.ALGORAND_ALGOD) {
        return {
          content: [{
            type: 'text',
            text: 'Algorand node URL not configured'
          }]
        };
      }

      try {
        // Get address using the unified approach
        const address = await getUserAddress(env, props.email);

        if (!address) {
          return {
            content: [{
              type: 'text',
              text: 'No active agent wallet configured'
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

        return ResponseProcessor.processResponse({
          accounts: [{
            address,
            amount: accountInfo.amount,
            assets: accountInfo.assets || [],
          }]
        });
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Failed to get account info: ${error.message || 'Unknown error'}`
          }]
        };
      }
    }
  );

  // Get wallet assets
  server.tool(
    'get_wallet_assets',
    'Get the assets for the configured wallet',
    {},
    async () => {
      if (!env.ALGORAND_ALGOD) {
        return {
          content: [{
            type: 'text',
            text: 'Algorand node URL not configured'
          }]
        };
      }

      try {
        // Get address using the unified approach
        const address = await getUserAddress(env, props.email);

        if (!address) {
          return {
            content: [{
              type: 'text',
              text: 'No active agent wallet configured'
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

        return ResponseProcessor.processResponse({
          assets: accountInfo.assets || [],
    
        });
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Failed to get asset info: ${error.message || 'Unknown error'}`
          }]
        };
      }
    }
  );
}
