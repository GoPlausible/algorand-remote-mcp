/**
 * General Transaction Manager for Algorand Remote MCP
 * Handles payment transaction operations on the Algorand blockchain
 */

import algosdk from 'algosdk';
import { z } from 'zod';
import { ResponseProcessor } from '../../utils';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Env, Props, VaultResponse } from '../../types';
import { 
  retrieveSecret, 
  storeSecret, 
  deleteSecret, 
  getUserAccountType, 
  getUserAddress, 
  signUserData, 
  ensureUserAccount,
  getPublicKey
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
 * Register general transaction management tools to the MCP server
 */
export async function registerGeneralTransactionTools(server: McpServer, env: Env, props: Props): Promise<void> {
  // Ensure user has an account (either vault-based or KV-based)
  try {
    const accountType = await ensureUserAccount(env, props.email);
    console.log(`User has a ${accountType}-based account`);
  } catch (error: any) {
    throw new Error(`Failed to ensure user account: ${error.message || 'Unknown error'}`);
  }
  
  // For backward compatibility, check if there's a KV-based account
  const ALGORAND_AGENT_WALLET = await retrieveSecret(env, props.email);
  // Create payment transaction tool
  server.tool(
    'create_payment_transaction',
    'Create a payment transaction on Algorand',
    {
      from: z.string().describe('Sender address'),
      to: z.string().describe('Receiver address'),
      amount: z.number().describe('Amount in microAlgos'),
      note: z.string().optional().describe('Optional transaction note'),
      closeRemainderTo: z.string().optional().describe('Optional close remainder to address'),
      rekeyTo: z.string().optional().describe('Optional rekey to address')
    },
    async ({ from, to, amount, note, closeRemainderTo, rekeyTo }) => {

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
        const algodClient = createAlgoClient(env.ALGORAND_ALGOD, env.ALGORAND_TOKEN || '');
        if (!algodClient) {
          throw new Error('Failed to create Algorand client');
        }

        // Get suggested transaction parameters
        const params = await algodClient.getTransactionParams().do();

        // Create payment transaction
        let noteBytes: Uint8Array | undefined;
        if (note) {
          const encoder = new TextEncoder();
          noteBytes = encoder.encode(note);
        }

        const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
          from,
          to,
          amount,
          note: noteBytes,
          closeRemainderTo,
          rekeyTo,
          suggestedParams: params
        });

        // Return the encoded transaction
        return ResponseProcessor.processResponse({
          txID: txn.txID(),
          encodedTxn: Buffer.from(algosdk.encodeUnsignedTransaction(txn)).toString('base64'),
          txnInfo: {
            from,
            to,
            amount,
            fee: params.fee,
            firstRound: params.firstRound,
            lastRound: params.lastRound
          }
        });
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Error creating transaction: ${error.message || 'Unknown error'}`
          }]
        };
      }
    }
  );

  // Sign transaction with user's credentials
  server.tool(
    'sign_transaction',
    'Sign an Algorand transaction with your agent account',
    {
      encodedTxn: z.string().describe('Base64 encoded transaction')
    },
    async ({ encodedTxn }) => {
      try {
        // Ensure user has an account
        await ensureUserAccount(env, props.email || '');
        
        // Sign the transaction using the unified approach
        const signature = await signUserData(env, props.email, encodedTxn);
        
        if (!signature) {
          return {
            content: [{
              type: 'text',
              text: 'No active agent wallet configured or signing failed'
            }]
          };
        }
        
        // Decode transaction to get the txID
        const txn = algosdk.decodeUnsignedTransaction(Buffer.from(encodedTxn, 'base64'));
        
        // Check account type for migration suggestion
        const accountType = await getUserAccountType(env, props.email || '');
        
        return ResponseProcessor.processResponse({
          txID: txn.txID(),
          signedTxn: signature,
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
            text: `Error signing transaction: ${error.message || 'Unknown error'}`
          }]
        };
      }
    }
  );

  // Submit signed transaction
  server.tool(
    'submit_transaction',
    'Submit a signed transaction to the Algorand network',
    { signedTxn: z.string().describe('Base64 encoded signed transaction') },
    async ({ signedTxn }) => {

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
        const algodClient = createAlgoClient(env.ALGORAND_ALGOD, env.ALGORAND_TOKEN || '');
        if (!algodClient) {
          throw new Error('Failed to create Algorand client');
        }

        // Decode and submit transaction
        const decodedTxn = Buffer.from(signedTxn, 'base64');
        const response = await algodClient.sendRawTransaction(decodedTxn).do();

        // Wait for confirmation
        const confirmedTxn = await algosdk.waitForConfirmation(algodClient, response.txId, 4);

        return ResponseProcessor.processResponse({
          confirmed: true,
          txID: response.txId,
          confirmedRound: confirmedTxn['confirmed-round'],
          txnResult: confirmedTxn
        });
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Error submitting transaction: ${error.message || 'Unknown error'}`
          }]
        };
      }
    }
  );

  // Create key registration transaction
  server.tool(
    'create_key_registration_transaction',
    'Create a key registration transaction on Algorand',
    {
      from: z.string().describe('Sender address'),
      voteKey: z.string().describe('The root participation public key (58 bytes base64 encoded)'),
      selectionKey: z.string().describe('VRF public key (32 bytes base64 encoded)'),
      stateProofKey: z.string().describe('State proof public key (64 bytes base64 encoded)'),
      voteFirst: z.number().describe('First round this participation key is valid'),
      voteLast: z.number().describe('Last round this participation key is valid'),
      voteKeyDilution: z.number().describe('Dilution for the 2-level participation key'),
      nonParticipation: z.boolean().optional().describe('Mark account as nonparticipating for rewards'),
      note: z.string().optional().describe('Transaction note field'),
      rekeyTo: z.string().optional().describe('Address to rekey the sender account to')
    },
    async ({ from, voteKey, selectionKey, stateProofKey, voteFirst, voteLast,
      voteKeyDilution, nonParticipation, note, rekeyTo }) => {

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
        const algodClient = createAlgoClient(env.ALGORAND_ALGOD, env.ALGORAND_TOKEN || '');
        if (!algodClient) {
          throw new Error('Failed to create Algorand client');
        }

        // Get suggested transaction parameters
        const params = await algodClient.getTransactionParams().do();

        // Process optional note
        let noteBytes: Uint8Array | undefined;
        if (note) {
          const encoder = new TextEncoder();
          noteBytes = encoder.encode(note);
        }

        // Create key registration transaction
        let txn;

        // There are two different overloads for makeKeyRegistrationTxnWithSuggestedParamsFromObject:
        // 1. Normal key registration (participation) - requires voting keys and parameters
        // 2. Going offline (nonParticipation = true) - doesn't use voting keys

        if (nonParticipation === true) {
          // Going offline
          txn = algosdk.makeKeyRegistrationTxnWithSuggestedParamsFromObject({
            from,
            suggestedParams: params,
            nonParticipation: true,
            note: noteBytes,
            rekeyTo
          });
        } else {
          // Normal key registration
          txn = algosdk.makeKeyRegistrationTxnWithSuggestedParamsFromObject({
            from,
            voteKey,
            selectionKey,
            stateProofKey,
            voteFirst,
            voteLast,
            voteKeyDilution,
            suggestedParams: params,
            // Only pass nonParticipation if it's explicitly false
            ...(nonParticipation === false ? { nonParticipation: false } : {}),
            note: noteBytes,
            rekeyTo
          });
        }

        // Return the encoded transaction
        return ResponseProcessor.processResponse({
          txID: txn.txID(),
          encodedTxn: Buffer.from(algosdk.encodeUnsignedTransaction(txn)).toString('base64'),
          txnInfo: {
            type: 'keyreg',
            from,
            voteFirst,
            voteLast,
            fee: params.fee,
            firstRound: params.firstRound,
            lastRound: params.lastRound
          }
        });
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Error creating key registration transaction: ${error.message || 'Unknown error'}`
          }]
        };
      }
    }
  );
}
