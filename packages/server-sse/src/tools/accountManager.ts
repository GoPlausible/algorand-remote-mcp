/**
 * Account Manager for Algorand Remote MCP
 * Handles account-related operations on the Algorand blockchain
 */

import algosdk from 'algosdk';
import { z } from 'zod';
import { ResponseProcessor } from '../utils';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Env, Props } from '../types';

/**
 * Register account management tools to the MCP server
 */
export function registerAccountTools(server: McpServer,env: Env, props: Props): void {
  // Create account tool
  server.tool(
    'create_account',
    'Create a new Algorand account',
    {},
    async () => {
      const account = algosdk.generateAccount();
      const mnemonic = algosdk.secretKeyToMnemonic(account.sk);
      
      return ResponseProcessor.processResponse({
        address: account.addr,
        mnemonic
      });
    }
  );
  
  // View address from mnemonic (without storing the private key)
  server.tool(
    'mnemonic_to_address',
    'View the address associated with a mnemonic (without storing the private key)',
    { mnemonic: z.string().describe('Mnemonic phrase to view address for') },
    async ({ mnemonic }) => {
      try {
        // This only derives the address from the mnemonic without storing the private key
        const sk = algosdk.mnemonicToSecretKey(mnemonic);
        
        return ResponseProcessor.processResponse({
          address: sk.addr,
          message: 'This only shows the address associated with the mnemonic. For security reasons, the private key is not stored in the vault. Use create_account to generate a new secure keypair in the vault.'
        });
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Error deriving address from mnemonic: ${error.message || 'Unknown error'}`
          }]
        };
      }
    }
  );
  
  // Check account balance
  server.tool(
    'check_balance',
    'Check the balance of an Algorand account',
    { address: z.string() },
    async ({ address }) => { 
      if (!env.ALGORAND_ALGOD) {
        return {
          content: [{
            type: 'text',
            text: 'Algorand node URL not configured'
          }]
        };
      }
      
      try {
        // Create algod client
        const algodClient = new algosdk.Algodv2(env.ALGORAND_TOKEN || '', env.ALGORAND_ALGOD, '');
        
        // Get account information
        const accountInfo = await algodClient.accountInformation(address).do();
        
        // Convert from microAlgos to Algos
        const balance = accountInfo.amount / 1000000;
        
        return ResponseProcessor.processResponse({
          address,
          balance,
          microAlgos: accountInfo.amount,
          minBalance: accountInfo['min-balance']
        });
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Error checking balance: ${error.message || 'Unknown error'}`
          }]
        };
      }
    }
  );
}
