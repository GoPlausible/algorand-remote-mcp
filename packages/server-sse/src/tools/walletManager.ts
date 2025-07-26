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
  retrieveSecret, 
  storeSecret, 
  deleteSecret, 
  createKeypair, 
  getPublicKey, 
  getUserAccountType, 
  getUserAddress, 
  signWithSecret, 
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
 * Get account from mnemonic (for backward compatibility with KV-based accounts)
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
  
  // Ensure user has an account (either vault-based or KV-based)
  try {
    const accountType = await ensureUserAccount(env, props.email);
    console.log(`User has a ${accountType}-based account`);
  } catch (error: any) {
    throw new Error(`Failed to ensure user account: ${error.message || 'Unknown error'}`);
  }
  
  // For backward compatibility, check if there's a KV-based account
  const ALGORAND_AGENT_WALLET = await retrieveSecret(env, props.email);
  //Reset wallet account
  server.tool(
    'reset_wallet_account',
    'Reset the wallet account for the configured user',
    {},
    async () => {
      try {
        // Check account type
        const accountType = await getUserAccountType(env, props.email);
        
        if (accountType === 'kv') {
          // For KV-based accounts, delete the old KV-based account and create a new vault-based account
          console.log('Replacing KV-based account with vault-based account for user:', props.email);
          
          // Delete the old KV-based account
          await deleteSecret(env, props.email);
          
          // Create a new vault-based account
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
            accountType: 'vault',
            message: 'Your account has been upgraded to use the secure vault-based storage.'
          });
        } else if (accountType === 'vault') {
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
        
        if (accountType === 'vault') {
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
        } else {
          // Get public key from KV-based account
          if (!ALGORAND_AGENT_WALLET) {
            throw new Error('Failed to retrieve mnemonic from KV store');
          }
          
          const account = getAccountFromMnemonic(ALGORAND_AGENT_WALLET);
          if (!account) {
            throw new Error('Failed to load account from mnemonic');
          }
          
          // Add migration suggestion
          return ResponseProcessor.processResponse({
            publicKey: Buffer.from(account.sk.slice(32)).toString('hex'),
            format: 'hex',
            accountType: 'kv',
            migrationAvailable: true,
            migrationMessage: 'Your account is using legacy storage. Consider using migrate_to_vault tool for enhanced security.'
          });
        }
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
        
        // Check account type for migration suggestion
        const accountType = await getUserAccountType(env, props.email);
        
        return ResponseProcessor.processResponse({
          address,
          ...(accountType === 'kv' && {
            accountType: 'kv',
            migrationAvailable: true,
            migrationMessage: 'Your account is using legacy storage. Consider using migrate_to_vault tool for enhanced security.'
          })
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
    'get_wallet_account',
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
        
        // Check account type for migration suggestion
        const accountType = await getUserAccountType(env, props.email);
        
        return ResponseProcessor.processResponse({
          accounts: [{
            address,
            amount: accountInfo.amount,
            assets: accountInfo.assets || []
          }],
          ...(accountType === 'kv' && {
            accountType: 'kv',
            migrationAvailable: true,
            migrationMessage: 'Your account is using legacy storage. Consider using migrate_to_vault tool for enhanced security.'
          })
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
        
        // Check account type for migration suggestion
        const accountType = await getUserAccountType(env, props.email);
        
        return ResponseProcessor.processResponse({
          assets: accountInfo.assets || [],
          ...(accountType === 'kv' && {
            accountType: 'kv',
            migrationAvailable: true,
            migrationMessage: 'Your account is using legacy storage. Consider using migrate_to_vault tool for enhanced security.'
          })
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
