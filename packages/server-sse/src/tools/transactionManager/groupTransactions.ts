/**
 * Group Transaction Manager for Algorand Remote MCP
 * Handles transaction groups and atomic operations
 */

import algosdk from 'algosdk';
import { z } from 'zod';
import { ResponseProcessor } from '../../utils';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Env, Props } from '../../types';
import { getUserAccountType, signUserData } from '../../utils/vaultManager';
/**
 * Register group transaction tools to the MCP server
 */
export function registerGroupTransactionTools(server: McpServer,env: Env, props: Props): void {
  // Assign group ID to transactions
  server.tool(
    'assign_group_id',
    'Assign a group ID to a set of transactions for atomic execution',
    { 
      encodedTxns: z.array(z.string()).describe('Array of base64-encoded unsigned transactions')
    },
    async ({ encodedTxns }) => {
      try {
        // Decode transactions
        const decodedTxns = encodedTxns.map(txn => {
          return algosdk.decodeUnsignedTransaction(
            Buffer.from(txn, 'base64')
          );
        });
        
        // Assign group ID
        const txnGroup = algosdk.assignGroupID(decodedTxns);
        
        // Re-encode transactions with group ID
        const groupedTxns = txnGroup.map(txn => 
          Buffer.from(algosdk.encodeUnsignedTransaction(txn)).toString('base64')
        );
        
        // Return the transactions with group IDs
        return ResponseProcessor.processResponse({
          groupId: Buffer.from(decodedTxns[0].group!).toString('base64'),
          groupedTxns
        });
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Error assigning group ID: ${error.message || 'Unknown error'}`
          }]
        };
      }
    }
  );
  
  // Create atomic transaction group
  server.tool(
    'create_atomic_group',
    'Create an atomic transaction group from multiple transactions',
    {
      transactions: z.array(z.object({
        type: z.enum(['payment', 'asset_transfer', 'asset_config', 'app_call']).describe('Transaction type'),
        params: z.any().describe('Transaction-specific parameters')
      })).describe('Array of transaction specifications')
    },
    async ({ transactions }) => {
      try {
        // This is a placeholder for creating multiple transactions
        // In a real implementation, we'd create all transactions of different types
        // and then assign them a group ID
        
        return ResponseProcessor.processResponse({
          message: "Atomic transaction group tool is not fully implemented yet.",
          txCount: transactions.length,
          tip: "Use individual transaction creation tools followed by assign_group_id for now."
        });
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Error creating atomic transaction group: ${error.message || 'Unknown error'}`
          }]
        };
      }
    }
  );
  
  // Atomic transaction sending helper
  server.tool(
    'send_atomic_group',
    'Sign and submit an atomic transaction group in one operation',
    {
      encodedTxns: z.array(z.string()).describe('Array of base64-encoded unsigned transactions'),
      keyNames: z.array(z.string()).describe('Array of key names in the vault for signing transactions')
    },
    async ({ encodedTxns, keyNames }) => {
      try {
        if (encodedTxns.length !== keyNames.length) {
          throw new Error('Number of transactions must match number of key names.');
        }
        
        // Decode transactions
        const decodedTxns = encodedTxns.map(txn => {
          return algosdk.decodeUnsignedTransaction(
            Buffer.from(txn, 'base64')
          );
        });
        
        // Assign group ID if not already assigned
        let groupedTxns;
        if (!decodedTxns[0].group) {
          groupedTxns = algosdk.assignGroupID(decodedTxns);
        } else {
          groupedTxns = decodedTxns;
        }
        
        // Re-encode transactions with group ID
        const groupedEncodedTxns = groupedTxns.map(txn =>
          Buffer.from(algosdk.encodeUnsignedTransaction(txn)).toString('base64')
        );
        
        // Sign each transaction with corresponding vault key
        const signaturePromises = groupedEncodedTxns.map((txn, i) =>
          signUserData(env, keyNames[i], txn)
        );
        
        const signatures = await Promise.all(signaturePromises);
        
        // Check if all signatures were successful
        const failedSignatures = signatures.filter(signature => !signature);
        if (failedSignatures.length > 0) {
          throw new Error(`Failed to sign ${failedSignatures.length} transaction(s) in the group`);
        }
        
        // Return the signed transactions
        return ResponseProcessor.processResponse({
          signedTxns: signatures,
          message: 'Transactions signed securely using vault keys'
        });
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Error processing atomic transaction group: ${error.message || 'Unknown error'}`
          }]
        };
      }
    }
  );
}
