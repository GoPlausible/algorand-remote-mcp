/**
 * Group Transaction Manager for Algorand Remote MCP
 * Handles transaction groups and atomic operations
 */

import algosdk from 'algosdk';
import { z } from 'zod';
import { ResponseProcessor } from '../../utils';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Env, Props } from '../../types';
import { signWithTransit, getPublicKey, ensureUserAccount } from '../../utils/vaultManager';
import * as msgpack from "algo-msgpack-with-bigint";

/**
 * Concatenate multiple arrays into a single Uint8Array
 */
function ConcatArrays(...arrs: ArrayLike<number>[]) {
  const size = arrs.reduce((sum, arr) => sum + arr.length, 0)
  const c = new Uint8Array(size)

  let offset = 0
  for (let i = 0; i < arrs.length; i++) {
    c.set(arrs[i], offset)
    offset += arrs[i].length
  }

  return c
}
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
 * Build a transaction based on type and parameters
 * @param type Transaction type
 * @param params Transaction parameters
 * @param suggestedParams Suggested transaction parameters from the network
 * @returns Transaction object
 */
async function buildTransaction(
  type: string,
  params: any,
  suggestedParams: algosdk.SuggestedParams
): Promise<algosdk.Transaction> {
  // Process optional note if provided
  let noteBytes: Uint8Array | undefined;
  if (params.note) {
    const encoder = new TextEncoder();
    noteBytes = encoder.encode(params.note);
  }

  // Create transaction based on type
  switch (type) {
    case 'pay': // Payment transaction
      return algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        from: params.from,
        to: params.to,
        amount: params.amount,
        note: noteBytes,
        closeRemainderTo: params.closeRemainderTo,
        rekeyTo: params.rekeyTo,
        suggestedParams
      });

    case 'axfer': // Asset transfer transaction
      return algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        from: params.from,
        to: params.to,
        assetIndex: params.assetIndex,
        amount: params.amount,
        note: noteBytes,
        closeRemainderTo: params.closeRemainderTo,
        rekeyTo: params.rekeyTo,
        revocationTarget: params.revocationTarget,
        suggestedParams
      });

    case 'acfg': // Asset configuration transaction
      if (params.assetIndex) {
        // Reconfiguring existing asset
        return algosdk.makeAssetConfigTxnWithSuggestedParamsFromObject({
          from: params.from,
          assetIndex: params.assetIndex,
          manager: params.manager,
          reserve: params.reserve,
          freeze: params.freeze,
          clawback: params.clawback,
          strictEmptyAddressChecking: params.strictEmptyAddressChecking,
          note: noteBytes,
          rekeyTo: params.rekeyTo,
          suggestedParams
        });
      } else {
        // Creating new asset
        return algosdk.makeAssetCreateTxnWithSuggestedParamsFromObject({
          from: params.from,
          total: params.total,
          decimals: params.decimals,
          defaultFrozen: params.defaultFrozen,
          manager: params.manager,
          reserve: params.reserve,
          freeze: params.freeze,
          clawback: params.clawback,
          unitName: params.unitName,
          assetName: params.assetName,
          assetURL: params.assetURL,
          assetMetadataHash: params.assetMetadataHash,
          note: noteBytes,
          rekeyTo: params.rekeyTo,
          suggestedParams
        });
      }

    case 'afrz': // Asset freeze transaction
      return algosdk.makeAssetFreezeTxnWithSuggestedParamsFromObject({
        from: params.from,
        freezeTarget: params.freezeTarget,
        assetIndex: params.assetIndex,
        freezeState: params.freezeState,
        note: noteBytes,
        rekeyTo: params.rekeyTo,
        suggestedParams
      });

    case 'appl': // Application call transaction
      return algosdk.makeApplicationCallTxnFromObject({
        from: params.from,
        appIndex: params.appIndex || 0, // 0 for app creation
        onComplete: params.onComplete || algosdk.OnApplicationComplete.NoOpOC,
        appArgs: params.appArgs ? params.appArgs.map((arg: string) => new Uint8Array(Buffer.from(arg, 'base64'))) : undefined,
        accounts: params.accounts,
        foreignApps: params.foreignApps,
        foreignAssets: params.foreignAssets,
        note: noteBytes,
        rekeyTo: params.rekeyTo,
        extraPages: params.extraPages,
        boxes: params.boxes,
        approvalProgram: params.approvalProgram ? new Uint8Array(Buffer.from(params.approvalProgram, 'base64')) : undefined,
        clearProgram: params.clearProgram ? new Uint8Array(Buffer.from(params.clearProgram, 'base64')) : undefined,
        numGlobalInts: params.numGlobalInts,
        numGlobalByteSlices: params.numGlobalByteSlices,
        numLocalInts: params.numLocalInts,
        numLocalByteSlices: params.numLocalByteSlices,
        suggestedParams
      });

    case 'keyreg': // Key registration transaction
      if (params.nonParticipation === true) {
        // Going offline
        return algosdk.makeKeyRegistrationTxnWithSuggestedParamsFromObject({
          from: params.from,
          suggestedParams,
          nonParticipation: true,
          note: noteBytes,
          rekeyTo: params.rekeyTo
        });
      } else {
        // Normal key registration
        return algosdk.makeKeyRegistrationTxnWithSuggestedParamsFromObject({
          from: params.from,
          voteKey: params.voteKey,
          selectionKey: params.selectionKey,
          stateProofKey: params.stateProofKey,
          voteFirst: params.voteFirst,
          voteLast: params.voteLast,
          voteKeyDilution: params.voteKeyDilution,
          suggestedParams,
          // Only pass nonParticipation if it's explicitly false
          ...(params.nonParticipation === false ? { nonParticipation: false } : {}),
          note: noteBytes,
          rekeyTo: params.rekeyTo
        });
      }

    case 'stpf': // State proof transaction
      throw new Error('State proof transactions are not yet supported');

    default:
      throw new Error(`Unsupported transaction type: ${type}`);
  }
}

/**
 * Register group transaction tools to the MCP server
 */
export function registerGroupTransactionTools(server: McpServer, env: Env, props: Props): void {
  // Assign group ID to transactions
  server.tool(
    'assign_group_id',
    'When manually creating transactions individually, assign a group ID to a set of transactions for atomic execution',
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
    'Create an atomic transaction group from multiple transactions of types pay, axfer, acfg, appl, afrz or keyreg',
    {
      transactions: z.array(z.object({
        type: z.enum(['pay', 'axfer', 'acfg', 'appl', 'afrz', 'keyreg']).describe('Transaction type'),
        params: z.any().describe('Transaction-specific parameters')
      })).describe('Array of transaction specifications')
    },
    async ({ transactions }) => {
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
        const suggestedParams = await algodClient.getTransactionParams().do();

        // Create transactions based on type and parameters
        const txnPromises = transactions.map(async ({ type, params }) => {
          return buildTransaction(type, params, suggestedParams);
        });

        const txns = await Promise.all(txnPromises);

        // Assign group ID
        const groupedTxns = algosdk.assignGroupID(txns);

        // Encode transactions
        const encodedTxns = groupedTxns.map(txn =>
          Buffer.from(algosdk.encodeUnsignedTransaction(txn)).toString('base64')
        );

        // Return the encoded transactions with group ID
        return ResponseProcessor.processResponse({
          groupId: Buffer.from(groupedTxns[0].group!).toString('base64'),
          encodedTxns,
          txnCount: encodedTxns.length,
          message: "Successfully created atomic transaction group"
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

  // Atomic transaction signing helper
  server.tool(
    'sign_atomic_group',
    'Sign an atomic transaction group',
    {
      encodedTxns: z.array(z.string()).describe('Array of base64-encoded unsigned transactions'),
      keyName: z.string().describe('Key name of the signer for all transactions in the group')
    },
    async ({ encodedTxns, keyName }) => {
      try {
        // Ensure user has an account
        try {
          await ensureUserAccount(env, props.email || '', props.provider || 'google');
          console.log(`Ensured user account for ${props.email || keyName}`);
        } catch (error: any) {
          throw new Error(`Failed to ensure user account: ${error.message || 'Unknown error'}`);
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

        // Sign each transaction with the same key
        let signatures: (string | null)[] = [];
        const publicKeyResult = await getPublicKey(env, props.email);

        if (publicKeyResult.success && !publicKeyResult.error) {
          // For vault-based accounts, use signWithTransit and process the response
          const signaturePromises = groupedEncodedTxns.map(async txn => {
            // Get the public key from the vault
            const publicKeyResult = await getPublicKey(env, props.email || keyName);
            if (!publicKeyResult.success || !publicKeyResult.publicKey) {
              return null;
            }
            console.log('Public key from vault:', publicKeyResult.publicKey);

            // Get the raw signature from the vault
            const TAG: Buffer = Buffer.from("TX");
            console.log('TAG:', Buffer.from("TX"));
            console.log('Encoded transaction buffer signing:', new Uint8Array(Buffer.from(txn, 'base64')));
            const finalEncodedTxn = new Uint8Array(Buffer.from(txn, 'base64'));
            const finalEncodedTxnTagged = ConcatArrays(TAG, finalEncodedTxn);
            console.log('Final encoded transaction:', finalEncodedTxnTagged);
            const finalEncodedTxnBase64 = Buffer.from(finalEncodedTxnTagged).toString('base64');
            const signatureResult = await signWithTransit(env, finalEncodedTxnBase64, props.email || keyName);

            if (!signatureResult.success || !signatureResult.signature) {
              return null;
            }

            // Decode the transaction
            const decodedTxn = algosdk.decodeUnsignedTransaction(Buffer.from(txn, 'base64'));
            console.log('Decoded transaction:', decodedTxn);

            // Convert the base64 signature to Uint8Array
            const signature = Buffer.from(signatureResult.signature, 'base64');
            console.log('Signature:', signature);

            // Convert the base64 public key to Uint8Array
            const publicKeyBuffer = Buffer.from(publicKeyResult.publicKey, 'base64');
            console.log('Public key buffer:', publicKeyBuffer);

            // Get the address from the public key
            const signerAddr = algosdk.encodeAddress(publicKeyBuffer);
            console.log('Signer address:', signerAddr);
            const txnObj = decodedTxn.get_obj_for_encoding();
            console.log('Transaction object for encoding:', txnObj);

            // Create a signed transaction object
            const signedTxn: any = {
              txn: txnObj,
              sig: signature,
            };
            console.log('Signed transaction object:', signedTxn);

            // Add AuthAddr if signing with a different key than From indicates
            // Compare the actual bytes of the public keys, not their string representations
            const fromPubKey = decodedTxn.from.publicKey;
            let keysMatch = fromPubKey.length === publicKeyBuffer.length;
            if (keysMatch) {
              for (let i = 0; i < fromPubKey.length; i++) {
                if (fromPubKey[i] !== publicKeyBuffer[i]) {
                  keysMatch = false;
                  break;
                }
              }
            }

            if (!keysMatch) {
              // Only add sgnr if the keys are actually different
              signedTxn["sgnr"] = algosdk.decodeAddress(signerAddr);
            }

            // Encode the signed transaction using MessagePack
            const encodedSignedTxn: Uint8Array = new Uint8Array(msgpack.encode(signedTxn, { sortKeys: true, ignoreUndefined: true }))
            console.log('Encoded signed transaction:', encodedSignedTxn);
            console.log('TXN ID:', decodedTxn.txID());

            // Return the base64 encoded signed transaction
            return Buffer.from(encodedSignedTxn).toString('base64');
          });

          signatures = await Promise.all(signaturePromises);
        } else {
          throw new Error('No valid account found for signing');
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

  // Submit atomic transaction group
  server.tool(
    'submit_atomic_group',
    'Submit a signed atomic transaction group to the Algorand network',
    {
      signedTxns: z.array(z.string()).describe('Array of base64-encoded signed transactions')
    },
    async ({ signedTxns }) => {
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

        // Decode and submit transactions
        const decodedTxns = signedTxns.map(txn => new Uint8Array(Buffer.from(txn, 'base64')));
        console.log('Submitting group of', decodedTxns.length, 'transactions');

        // Submit the transaction group
        const response = await algodClient.sendRawTransaction(decodedTxns).do();
        console.log('Transaction ID:', response.txId);

        // Wait for confirmation
        const confirmedTxn = await algosdk.waitForConfirmation(algodClient, response.txId, 4);
        console.log('Confirmed transaction:', confirmedTxn);

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
            text: `Error submitting transaction group: ${error.message || 'Unknown error'}`
          }]
        };
      }
    }
  );
}
