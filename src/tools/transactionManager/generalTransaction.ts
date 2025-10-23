/**
 * General Transaction Manager for Algorand Remote MCP
 * Handles payment transaction operations on the Algorand blockchain
 */

import algosdk from 'algosdk';


import { z } from 'zod';
import { ResponseProcessor } from '../../utils';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  Env, Props, VaultResponse,
} from '../../types';
import {
  getUserAddress,
  ensureUserAccount,
  getPublicKey,
  signWithTransit
} from '../../utils/vaultManager';
import * as msgpack from "algo-msgpack-with-bigint"

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
 function uint8ToBase64(  uint8Array: Uint8Array): string {
    let binary = '';
    const len = uint8Array.length;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    const base64 = btoa(binary);
    // convert to Base64URL (no padding)
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }
/**
 * Register general transaction management tools to the MCP server
 */
export async function registerGeneralTransactionTools(server: McpServer, env: Env, props: Props): Promise<void> {
  // Ensure user has a vault-based account
  if (!props.email || !props.provider) {
    throw new Error('Email and provider must be provided in props');
  }
  // console.log(`Ensuring user account for ${props.email} with provider ${props.provider}`);
  // try {
  //   const accType = await ensureUserAccount(env, props.email, props.provider);
  //   console.log(`User has a ${accType}-based account`);
  // } catch (error: any) {
  //   throw new Error(`Failed to ensure user account: ${error.message || 'Unknown error'}`);
  // }

  // Create payment transaction tool
  server.tool(
    'sdk_txn_payment_transaction',
    'Create a payment transaction on Algorand',
    {
      sender: z.string().describe('Sender address'),
      receiver: z.string().describe('Receiver address'),
      amount: z.number().describe('Amount in microAlgos'),
      fee: z.number().optional().describe('Transaction fee (in microAlgos)'),
      note: z.string().optional().describe('Optional transaction note'),
      closeRemainderTo: z.string().optional().describe('Optional close remainder to address'),
      rekeyTo: z.string().optional().describe('Optional rekey to address')
    },
    async ({ sender, receiver, amount, note, closeRemainderTo, rekeyTo, fee }) => {

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
          from: sender,
          to: receiver,
          amount,
          note: noteBytes,
          closeRemainderTo,
          rekeyTo,
          suggestedParams: params.fee ? {...params, fee: params.fee, flatFee: true} : params
        });

        // Return the encoded transaction
        return ResponseProcessor.processResponse({
          txID: txn.txID(),
          encodedTxn: Buffer.from(algosdk.encodeUnsignedTransaction(txn)).toString('base64'),
          txnInfo: {
             from: sender,
          to: receiver,
            amount,
            fee: fee ? fee : txn.fee,
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
    'wallet_sign_transaction',
    'Sign an Algorand transaction with your agent account',
    {
      encodedTxn: z.string().describe('Base64 encoded transaction')
    },
    async ({ encodedTxn }) => {
      try {
        if (!props.email || !props.provider) {
          throw new Error('Email and provider must be provided in props');
        }
        // console.log(`Ensuring account for ${props.email} with provider ${props.provider}`);

        // // Ensure user has an account
        // await ensureUserAccount(env, props.email || '', props.provider);

        // For vault-based accounts, we need to manually construct the signed transaction

        // Get the public key from the vault
        const publicKeyResult = await getPublicKey(env, props.email, props.provider);

        if (!publicKeyResult.success || !publicKeyResult.publicKey) {
          throw new Error('Failed to get public key from vault');
        }
        console.log('Public key from vault:', publicKeyResult.publicKey);
        console.log(`Signing transaction for ${props.email} with provider ${props.provider}`);
        // Get the raw signature from the vault
        const TAG: Buffer = Buffer.from("TX");
        console.log('TAG:', Buffer.from("TX"));
        console.log('Encoded transaction buffer signing:', new Uint8Array(Buffer.from(encodedTxn, 'base64')));
        const finalEncodedTxn = new Uint8Array(Buffer.from(encodedTxn, 'base64'));
        const finalEncodedTxnTagged = ConcatArrays(TAG, finalEncodedTxn);
        console.log('Final encoded transaction:', finalEncodedTxnTagged);
        const finalEncodedTxnBase64 = Buffer.from(finalEncodedTxnTagged).toString('base64');
        const signatureResult = await signWithTransit(env, finalEncodedTxnBase64, props.email, props.provider);


        if (!signatureResult.success || !signatureResult.signature) {
          throw new Error('Failed to get signature from vault');
        }


        // Decode the transaction
        const txn = algosdk.decodeUnsignedTransaction(Buffer.from(encodedTxn, 'base64'));
        console.log('Decoded transaction:', txn);

        // Convert the base64 signature to Uint8Array
        const signature = Buffer.from(signatureResult.signature, 'base64');
        console.log('Signature:', signature);


        // Convert the base64 public key to Uint8Array
        const publicKeyBuffer = Buffer.from(publicKeyResult.publicKey, 'base64');
        console.log('Public key buffer:', publicKeyBuffer);

        // Get the address from the public key
        const signerAddr = algosdk.encodeAddress(publicKeyBuffer);
        console.log('Signer address:', signerAddr);
        const txnObj = txn.get_obj_for_encoding();
        console.log('Transaction object for encoding:', txnObj);

        // Create a Map for the signed transaction
        const signedTxn: object = {
          txn: txnObj,
          sig: signature,
        };
        console.log('Signed transaction map:', signedTxn);

        // Add AuthAddr if signing with a different key than From indicates
        // Compare the actual bytes of the public keys, not their string representations
        const fromPubKey = txn.from.publicKey;
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
          signedTxn.sgnr = algosdk.decodeAddress(signerAddr);
        }

        // Encode the signed transaction using MessagePack
        const encodedSignedTxn: Uint8Array = new Uint8Array(msgpack.encode(signedTxn, { sortKeys: true, ignoreUndefined: true }))
        console.log('Encoded signed transaction:', encodedSignedTxn);
        console.log('TXN ID:', txn.txID());
        // Return the base64 encoded signed transaction
        return ResponseProcessor.processResponse({
          txID: txn.txID(),
          signedTxn: Buffer.from(encodedSignedTxn).toString('base64')
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
  // Sign transaction with user's mnemonic (for non-vault accounts)
  server.tool(
    'sdk_sign_transaction',
    'Sign an Algorand transaction with your agent account',
    {
      encodedTxn: z.string().describe('Base64 encoded transaction'),
      mnemonic: z.string().describe('25-word mnemonic for the signing account')
    },
    async ({ encodedTxn, mnemonic }) => {
      try {
        if (!props.email || !props.provider) {
          throw new Error('Email and provider must be provided in props');
        }
        // console.log(`Ensuring account for ${props.email} with provider ${props.provider}`);

        // // Ensure user has an account
        // await ensureUserAccount(env, props.email || '', props.provider);

        // For vault-based accounts, we need to manually construct the signed transaction

        // Get the public key from the vault
        const publicKeyResult = await getPublicKey(env, props.email, props.provider);

        if (!publicKeyResult.success || !publicKeyResult.publicKey) {
          throw new Error('Failed to get public key from vault');
        }
        console.log('Public key from vault:', publicKeyResult.publicKey);
        console.log(`Signing transaction for ${props.email} with provider ${props.provider}`);
        // Get the raw signature from the vault
          // Decode the transaction
        const txn = algosdk.decodeUnsignedTransaction(Buffer.from(encodedTxn, 'base64'));
        console.log('Decoded transaction:', txn);
        const goplausibleAccount = algosdk.mnemonicToSecretKey(mnemonic);
                const signatureResult = algosdk.signTransaction(txn, goplausibleAccount.sk);
    


        if (!signatureResult.blob) {
          throw new Error('Failed to get signature from vault');
        }


      

        // Convert the base64 signature to Uint8Array
        const signature = Buffer.from(signatureResult.blob, 'base64');
        console.log('Signature:', signature);
        const txID = signatureResult.txID;
        console.log('TXID:', txID);


        // Convert the base64 public key to Uint8Array
        const publicKeyBuffer = Buffer.from(publicKeyResult.publicKey, 'base64');
        console.log('Public key buffer:', publicKeyBuffer);

        // Get the address from the public key
        const signerAddr = algosdk.encodeAddress(publicKeyBuffer);
        console.log('Signer address:', signerAddr);
        const txnObj = txn.get_obj_for_encoding();
        console.log('Transaction object for encoding:', txnObj);

        // Create a Map for the signed transaction
        const signedTxn: object = {
          txn: txnObj,
          sig: signature,
        };
        console.log('Signed transaction map:', signedTxn);

        // Add AuthAddr if signing with a different key than From indicates
        // Compare the actual bytes of the public keys, not their string representations
        const fromPubKey = txn.from.publicKey;
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
          signedTxn.sgnr = algosdk.decodeAddress(signerAddr);
        }

        // Encode the signed transaction using MessagePack
        const encodedSignedTxn: Uint8Array = new Uint8Array(msgpack.encode(signedTxn, { sortKeys: true, ignoreUndefined: true }))
        console.log('Encoded signed transaction:', encodedSignedTxn);
        console.log('TXN ID:', txn.txID());
        // Return the base64 encoded signed transaction
        return ResponseProcessor.processResponse({
          txID: txID,
          signedTxn: Buffer.from(encodedSignedTxn).toString('base64')
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
    'sdk_submit_transaction',
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
        console.log('Signed TXN:', signedTxn);
        // Decode and submit transaction
        const decodedTxn = Buffer.from(signedTxn, 'base64');
        console.log('Decoded signed transaction:', decodedTxn);
        const response = await algodClient.sendRawTransaction(new Uint8Array(decodedTxn)).do();
        const txId = response.txId || response.txid;
        console.log('Transaction ID:', txId);
        // Wait for confirmation
        const confirmedTxn = await algosdk.waitForConfirmation(algodClient, txId, 5);
        console.log('Confirmed transaction:', confirmedTxn);


        return ResponseProcessor.processResponse({
          confirmed: true,
          txID: txId,
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
    'sdk_txn_key_registration_transaction',
    'Create a key registration transaction on Algorand',
    {
      sender: z.string().describe('Sender address'),
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
    async ({ sender, voteKey, selectionKey, stateProofKey, voteFirst, voteLast,
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
            from: sender,
            suggestedParams: params,
            nonParticipation: true,
            note: noteBytes,
            rekeyTo
          });
        } else {
          // Normal key registration
          txn = algosdk.makeKeyRegistrationTxnWithSuggestedParamsFromObject({
            from: sender,
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
            from: sender,
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
