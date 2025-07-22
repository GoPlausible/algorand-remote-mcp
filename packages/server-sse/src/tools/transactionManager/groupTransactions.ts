/**
 * Group Transaction Manager for Algorand Remote MCP
 * Handles transaction groups and atomic operations
 */

import algosdk from 'algosdk';
import { z } from 'zod';
import { ResponseProcessor } from '../../utils';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Env, Props } from '../../types';
import { getUserAccountType, signWithVault, signWithSecret, getPublicKey } from '../../utils/vaultManager';
/**
 * Register group transaction tools to the MCP server
 */
export function registerGroupTransactionTools(server: McpServer, env: Env, props: Props): void {
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

        // Sign each transaction with corresponding key
        let signatures: (string | null)[] = [];
        const accountType = await getUserAccountType(env, props.email || '');
        
        if (accountType === 'kv') {
          // For KV-based accounts, use signWithSecret
          const signaturePromises = groupedEncodedTxns.map((txn, i) =>
            signWithSecret(env, keyNames[i], txn)
          );
          signatures = await Promise.all(signaturePromises);
        } else if (accountType === 'vault') {
          // For vault-based accounts, use signWithVault and process the response
          const signaturePromises = groupedEncodedTxns.map(async (txn, i) => {
            const signatureResult = await signWithVault(env, txn, keyNames[i]);
            if (!signatureResult.success || !signatureResult.signature) {
              return null;
            }
            
            // Get the public key from the vault
            const publicKeyResult = await getPublicKey(env, keyNames[i]);
            if (!publicKeyResult.success || !publicKeyResult.publicKey) {
              return null;
            }
            
            // Decode the transaction
            const txnObj = algosdk.decodeUnsignedTransaction(Buffer.from(txn, 'base64'));
            
            // Convert the base64 signature to Uint8Array
            const signature = Buffer.from(signatureResult.signature, 'base64');
            
            // Convert the base64 public key to Uint8Array
            const publicKeyBuffer = Buffer.from(publicKeyResult.publicKey, 'base64');
            
            // Get the address from the public key
            const signerAddr = algosdk.encodeAddress(publicKeyBuffer);
            
            // Create a Map for the signed transaction
            const sTxn = new Map<string, unknown>([
              ['sig', signature],
              ['txn', txnObj.get_obj_for_encoding()],
            ]);
            
            // Add AuthAddr if signing with a different key than From indicates
            if (txnObj.from.publicKey.toString() !== publicKeyBuffer.toString()) {
              sTxn.set('sgnr', algosdk.decodeAddress(signerAddr));
            }
            
            // Encode the signed transaction using MessagePack
            const encodedSignedTxn = algosdk.encodeObj(sTxn);
            
            // Return the base64 encoded signed transaction
            return Buffer.from(encodedSignedTxn).toString('base64');
          });
          
          signatures = await Promise.all(signaturePromises);
        } else {
          throw new Error('No valid account type found for signing');
        }



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
