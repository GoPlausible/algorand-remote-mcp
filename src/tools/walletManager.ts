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
  getUserAddress,
  /* ensureUserAccount, */
  deleteKeypair,
  deleteEntity,
  createNewEntity
} from '../utils/vaultManager';
import { log } from 'console';
import { email } from 'zod/v4';

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
  if (!props.email || !props.provider) {
    throw new Error('Email and provider must be provided in props');
  }
  
  // Ensure user has a vault-based account 
  // try {
  //   const accType = await ensureUserAccount(env, props.email, props.provider || 'google');
  //   console.log(`User has a ${accType}-based account`);
  // } catch (error: any) {
  //   throw new Error(`Failed to ensure user account: ${error.message || 'Unknown error'}`);
  // }
  //Reset wallet account
  server.tool(
    'wallet_reset_account',
    'Reset the wallet account for the configured user',
    {},
    async () => {
      try {
        const publicKeyResult = await getPublicKey(env, props.email, props.provider);
        const providerEmail = `${props.provider}--${props.email}`
        let entityId: string | null = await env.VAULT_ENTITIES.get(providerEmail);
        let providerEntity : string | null =  `${props.provider}--${entityId}`;
        console.log(`Entity ID for ${providerEmail} from KV store:`, providerEntity);
        let roleId = null;
        if (!!entityId) {
          console.log(`Fetching role ID from KV for entity ${entityId}`);
          providerEntity = `${props.provider}--${entityId}`
          roleId = await env.VAULT_ENTITIES.get(providerEntity);
          console.log(`Role ID for ${entityId} from KV store:`, roleId);
        }
        if (!roleId || !entityId) {
          console.log(`provider: ${props.provider}, email: ${props.email}, clientId: ${props.clientId}, userId: ${props.id}`);
          throw new Error('Role or entity ID not found in KV store');
        }

        if (publicKeyResult.success && !publicKeyResult.error) {
          // For vault-based accounts, create a new keypair in the vault
          console.log('Creating new vault-based keypair for user:', props.email);

          // Delete existing keypair if it exists
          // Note: This would require a delete endpoint in the vault worker

          // Create new keypair
          await deleteKeypair(env, props.email, props.provider);

          await deleteEntity(env, props.email, entityId, roleId, props.provider);
          console.log(`Deleted entity and role for ${props.email} with ID ${entityId}`);

          let providerEmail = `${props.provider}--${props.email}`
          let providerEntity = `${props.provider}--${entityId}`
          await env.VAULT_ENTITIES.delete(providerEmail);
          console.log(`Deleted entity ID for ${providerEmail} from KV store`);
          await env.VAULT_ENTITIES.delete(providerEntity);
          console.log(`Deleted entity ID ${providerEntity} from KV store`);
          console.log(`Cleared public key cache for user: ${props.email}`);
          const entityResult = await createNewEntity(env, props.email, props.provider);
          console.log(`New entity created: ${entityResult}`);
            await new Promise(resolve => setTimeout(resolve, 500));
          const keypairResult = await createKeypair(env, props.email, props.provider);

          if (!keypairResult.success) {
            throw new Error(keypairResult.error || 'Failed to create keypair in vault');
          }
          console.log(`New keypair created: ${keypairResult}`);
          // Get the address from the public key
          console.log(`Getting public key for ${props.email} with provider ${props.provider}`);
        
          const publicKeyResult = await getPublicKey(env, props.email, props.provider);

          if (!publicKeyResult.success || !publicKeyResult.publicKey) {
            throw new Error(publicKeyResult.error || 'Failed to get public key from vault');
          }
          console.log(`Public key for ${props.email}: ${publicKeyResult.publicKey}`);

          // Convert the public key to an Algorand address
          const publicKeyBuffer = Buffer.from(publicKeyResult.publicKey, 'base64');
          const address = algosdk.encodeAddress(publicKeyBuffer);
          providerEmail = `${props.provider}--${props.email}`
          entityId = await env.VAULT_ENTITIES?.get(providerEmail);
          providerEntity = `${props.provider}--${entityId}`
          console.log(`Entity ID for ${providerEmail} from KV store:`, entityId);
          // let roleId = null;
          if (!!entityId) {
            console.log(`Fetching role ID from KV for entity ${providerEntity}`);
            roleId = await env.VAULT_ENTITIES?.get(providerEntity);
            console.log(`Role ID for ${providerEntity} from KV store:`, roleId);
            if (roleId) {
              return ResponseProcessor.processResponse({
                address,
                role: roleId,
                user: props.email,
                provider: props.provider,
              });
            } else {
              throw new Error(`No Role ID found for entity: ${providerEntity}`);
            }
          } else {
            throw new Error(`No entity ID found for ${providerEmail}`);
          }
        } else {
          throw new Error('No active agent wallet configured');
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
    'wallet_get_publickey',
    'Get the public key for the configured wallet',
    {},
    async () => {
      try {
        
        // Check account type
        const publicKeyResult = await getPublicKey(env, props.email, props.provider);
        if (!publicKeyResult.success || publicKeyResult.error) {
          return {
            content: [{
              type: 'text',
              text: 'No active agent wallet configured'
            }]
          };
        }
        let providerEmail = `${props.provider}--${props.email}`

        const entityId = await env.VAULT_ENTITIES?.get(providerEmail);
        let providerEntity = `${props.provider}--${entityId}`
      
        console.log(`Entity ID for ${props.email} from KV store:`, entityId);
        let roleId = null;
        if (!!entityId) {
          console.log(`Fetching role ID from KV for entity ${providerEntity}`);
          roleId = await env.VAULT_ENTITIES?.get(providerEntity);
          console.log(`Role ID for ${providerEntity} from KV store:`, roleId);
        }
        return ResponseProcessor.processResponse({
          publicKey: publicKeyResult.publicKey,
          format: 'base64',
          role: roleId,
          user: props.email,
          provider: props.provider,
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
    'wallet_get_address',
    'Get the address for the configured wallet',
    {},
    async () => {
      try {
        // Get address using the unified approach
        const address = await getUserAddress(env, props.email, props.provider);

        if (!address) {
          return {
            content: [{
              type: 'text',
              text: 'No active agent wallet configured'
            }]
          };
        }
        let providerEmail = `${props.provider}--${props.email}`
        const entityId = await env.VAULT_ENTITIES?.get(providerEmail);
        let providerEntity = `${props.provider}--${entityId}`
        console.log(`Entity ID for ${providerEmail} from KV store:`, providerEntity);

        let roleId = null;
        if (!!entityId) {
          console.log(`Fetching role ID from KV for entity ${providerEntity}`);
          roleId = await env.VAULT_ENTITIES?.get(providerEntity);
          console.log(`Role ID for ${providerEntity} from KV store:`, roleId);
        }


        return ResponseProcessor.processResponse({
          address,
          role: roleId,
          user: props.email,
          provider: props.provider,
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

  // // Get wallet role UUID
  // server.tool(
  //   'wallet_get_role',
  //   'Get the role UUID for the configured wallet to be used to login into Hashicorp Vault with OIDC',
  //   {},
  //   async () => {
  //     try {
  //       let providerEmail = `${props.provider}--${props.email}`
  //       const entityId = await env.VAULT_ENTITIES?.get(providerEmail);
  //       let providerEntity = `${props.provider}--${entityId}`
  //       console.log(`Entity ID for ${providerEmail} from KV store:`, providerEntity);
  //       let roleId = null;
  //       if (!!entityId) {
  //         console.log(`Fetching role ID from KV for entity ${providerEntity}`);
  //         roleId = await env.VAULT_ENTITIES?.get(providerEntity);
  //         console.log(`Role ID for ${providerEntity} from KV store:`, roleId);
  //       }
  //       if (!entityId) {
  //         return {
  //           content: [{
  //             type: 'text',
  //             text: 'No active agent wallet configured'
  //           }]
  //         };
  //       }

  //       return ResponseProcessor.processResponse({
  //         role: roleId,
  //         user: props.email,
  //         provider: props.provider,

  //       });
  //     } catch (error: any) {
  //       return {
  //         content: [{
  //           type: 'text',
  //           text: `Failed to get address: ${error.message || 'Unknown error'}`
  //         }]
  //       };
  //     }
  //   }
  // );

  // Get wallet account information
  server.tool(
    'wallet_get_info',
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
      let providerEmail = `${props.provider}--${props.email}`
      const entityId = await env.VAULT_ENTITIES?.get(providerEmail);
      let providerEntity = `${props.provider}--${entityId}`
      console.log(`Entity ID for ${providerEmail} from KV store:`, providerEntity);
      let roleId = null;
      if (!!entityId) {
        console.log(`Fetching role ID from KV for entity ${providerEntity}`);
        roleId = await env.VAULT_ENTITIES?.get(providerEntity);
        console.log(`Role ID for ${providerEntity} from KV store:`, roleId);
      }

      try {
        // Get address using the unified approach
        const address = await getUserAddress(env, props.email, props.provider);

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
            user: props.email,
            provider: props.provider,
            role: roleId
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
    'wallet_get_assets',
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
        const address = await getUserAddress(env, props.email, props.provider);

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
          user: props.email,
          provider: props.provider,

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

  // Logout from OAuth provider
  server.tool(
    'wallet_logout',
    'Logout from the OAuth provider and clear authentication cookies',
    {},
    async () => {
      try {
        // Build the logout URL with the base URL from the environment or a default
        const baseUrl = new URL('https://algorandmcp.goplausible.xyz');
        const logoutUrl = new URL('/logout', baseUrl.origin);
        console.log(`Calling Logout URL: ${logoutUrl.toString()}`);

        // Add query parameters - always revoke token if available
        if (props?.accessToken && props?.provider) {
          logoutUrl.searchParams.set('token', props.accessToken);
          logoutUrl.searchParams.set('email', props.email || '');
          logoutUrl.searchParams.set('clientId', props.clientId || '');
          logoutUrl.searchParams.set('userId', props.id || '');
          logoutUrl.searchParams.set('provider', props.provider);
          console.log(`Including token and provider in logout request: provider=${props.provider}, token length=${props.accessToken.length}`);
        } else {
          console.log('No token or provider available for logout request');
        }

        console.log(`Calling logout endpoint: ${logoutUrl.toString()}`);

        // Call the logout endpoint
        const response = await fetch(logoutUrl.toString(), {
          method: 'GET'
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`Logout failed with status: ${response.status}, response: ${errorText}`);
          throw new Error(`Logout failed with status: ${response.status}`);
        }

        // Parse the response to get any additional information
        const responseData = await response.json();
        console.log('Logout response:', responseData);


        // Return response with clear instructions for the client
        return ResponseProcessor.processResponse({
          success: true,
          message: 'Successfully logged out. You will need to re-authenticate on your next request.',
          user: props.email,
          provider: props.provider,
          forceReauthentication: true
        });
      } catch (error: any) {
        console.error('Error during logout:', error);
        return {
          content: [{
            type: 'text',
            text: `Error during logout: ${error.message || 'Unknown error'}`
          }]
        };
      }
    }
  );
}
