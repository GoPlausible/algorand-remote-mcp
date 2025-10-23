/**
 * Asset Transaction Manager for Algorand Remote MCP
 * Handles asset-related transaction operations on the Algorand blockchain
 */

import algosdk from 'algosdk';
import { z } from 'zod';
import { ResponseProcessor } from '../../utils';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Env, Props } from '../../types';
import * as msgpack from "algo-msgpack-with-bigint"
import {
  getUserAddress,
  getPublicKey,
  signWithTransit
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
 * Register asset transaction management tools to the MCP server
 */
export function registerAssetTransactionTools(server: McpServer, env: Env, props: Props): void {
  // Create a new Algorand Standard Asset (ASA)
  server.tool(
    'sdk_txn_create_asset',
    'Create a new Algorand Standard Asset (ASA)',
    {
      creator: z.string().describe('Creator address'),
      name: z.string().describe('Asset name'),
      unitName: z.string().describe('Unit name (ticker)'),
      totalSupply: z.number().describe('Total supply'),
      decimals: z.number().min(0).max(19).default(0).describe('Decimal precision (0-19)'),
      defaultFrozen: z.boolean().default(false).describe('Whether accounts are frozen by default'),
      url: z.string().optional().describe('URL for asset information'),
      metadataHash: z.string().optional().describe('Metadata hash (32-byte string)'),
      manager: z.string().optional().describe('Manager address'),
      reserve: z.string().optional().describe('Reserve address'),
      freeze: z.string().optional().describe('Freeze address'),
      clawback: z.string().optional().describe('Clawback address'),
      note: z.string().optional().describe('Optional transaction note')
    },
    async ({ creator, name, unitName, totalSupply, decimals, defaultFrozen,
      url, metadataHash, manager, reserve, freeze, clawback, note }) => {

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

        // Process optional metadataHash
        let metadataHashBytes: Uint8Array | undefined;
        if (metadataHash) {
          try {
            metadataHashBytes = new Uint8Array(Buffer.from(metadataHash, 'base64'));
          } catch (error) {
            throw new Error('Invalid metadataHash format. Expected base64 encoded string.');
          }
        }

        // Create asset creation transaction
        const txn = algosdk.makeAssetCreateTxnWithSuggestedParamsFromObject({
          from: creator,
          total: totalSupply,
          decimals,
          defaultFrozen,
          assetName: name,
          unitName,
          assetURL: url,
          assetMetadataHash: metadataHashBytes,
          manager,
          reserve,
          freeze,
          clawback,
          suggestedParams: params,
          note: noteBytes
        });

        // Return the encoded transaction
        return ResponseProcessor.processResponse({
          txID: txn.txID(),
          encodedTxn: Buffer.from(algosdk.encodeUnsignedTransaction(txn)).toString('base64'),
          txnInfo: {
            type: 'asset-create',
            creator,
            assetName: name,
            unitName,
            totalSupply,
            decimals,
            fee: params.fee,
            firstRound: params.firstRound,
            lastRound: params.lastRound
          }
        });
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Error creating asset transaction: ${error.message || 'Unknown error'}`
          }]
        };
      }
    }
  );

  // Opt-in to an asset
  server.tool(
    'sdk_txn_asset_optin',
    'Opt-in to an Algorand Standard Asset (ASA)',
    {
      address: z.string().describe('Account address to opt-in'),
      assetID: z.number().describe('Asset ID to opt-in to'),
      note: z.string().optional().describe('Optional transaction note')
    },
    async ({ address, assetID, note }) => {

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

        // Create asset opt-in transaction
        const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
          from: address,
          to: address, // For opt-in, to and from are the same
          amount: 0, // For opt-in, amount is 0
          assetIndex: assetID,
          suggestedParams: params,
          note: noteBytes
        });

        // Return the encoded transaction
        return ResponseProcessor.processResponse({
          txID: txn.txID(),
          encodedTxn: Buffer.from(algosdk.encodeUnsignedTransaction(txn)).toString('base64'),
          txnInfo: {
            type: 'asset-optin',
            address,
            assetID,
            fee: params.fee,
            firstRound: params.firstRound,
            lastRound: params.lastRound
          }
        });
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Error creating asset opt-in transaction: ${error.message || 'Unknown error'}`
          }]
        };
      }
    }
  );
  // Opt-in to USDC
  server.tool(
    'wallet_usdc_optin',
    'Opt-in agent wallet to USDC',
    {
      note: z.string().optional().describe('Optional transaction note')
    },
    async ({ note }) => {
      if (!props.email || !props.provider) {
        throw new Error('Email and provider must be provided in props');
      }
      if (!env.ALGORAND_ALGOD) {
        return {
          content: [{
            type: 'text',
            text: 'Algorand node URL not configured'
          }]
        };
      }



      try {
        const algodClient = createAlgoClient(env.ALGORAND_ALGOD, env.ALGORAND_TOKEN || '');
        if (!algodClient) {
          throw new Error('Failed to create Algorand client');
        }

        const params = await algodClient.getTransactionParams().do();
        const address = await getUserAddress(env, props.email, props.provider);
        const publicKeyResult = await getPublicKey(env, props.email, props.provider);
        if (!publicKeyResult.success || !publicKeyResult.publicKey) {
          throw new Error('Failed to get public key from vault');
        }

        const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
          from: address,
          to: address, 
          amount: 0, // For opt-in, amount is 0
          assetIndex: 31566704, // USDC Asset ID on Algorand Mainnet
          suggestedParams: params,
        });
        console.log('Public key from vault:', publicKeyResult.publicKey);
        console.log(`Signing transaction for ${props.email} with provider ${props.provider}`);
        const TAG: Buffer = Buffer.from("TX");
        console.log('TAG:', Buffer.from("TX"));
        const finalEncodedTxn = algosdk.encodeUnsignedTransaction(txn);
        const finalEncodedTxnTagged = ConcatArrays(TAG, finalEncodedTxn);
        console.log('Final encoded transaction:', finalEncodedTxnTagged);
        const finalEncodedTxnBase64 = Buffer.from(finalEncodedTxnTagged).toString('base64');
        const signatureResult = await signWithTransit(env, finalEncodedTxnBase64, props.email, props.provider);
        if (!signatureResult.success || !signatureResult.signature) {
          throw new Error('Failed to get signature from vault');
        }
        const signature = Buffer.from(signatureResult.signature, 'base64');
         const txnObj = txn.get_obj_for_encoding();
        const signedTxn: object = {
          txn: txnObj,
          sig: signature,
        };
        const encodedTxnUint8Array =new Uint8Array(msgpack.encode(signedTxn, { sortKeys: true, ignoreUndefined: true }))
        const response = await algodClient.sendRawTransaction(encodedTxnUint8Array).do();


        



        // Return the encoded transaction
        return ResponseProcessor.processResponse({
          txID: txn.txID(),
          txnInfo: {
            response,
            type: 'usdc-optin',
            address,
            assetID: 31566704,
            fee: 1000,
            firstRound: params.firstRound,
            lastRound: params.lastRound
          }
        });
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Error creating asset opt-in transaction: ${error.message || 'Unknown error'}`
          }]
        };
      }
    }
  );

  // Transfer asset
  server.tool(
    'sdk_txn_transfer_asset',
    'Transfer an Algorand Standard Asset (ASA)',
    {
      sender: z.string().describe('Sender address'),
      receiver: z.string().describe('Receiver address'),
      assetID: z.number().describe('Asset ID to transfer'),
      amount: z.number().describe('Amount of asset to transfer'),
      note: z.string().optional().describe('Optional transaction note')
    },
    async ({ sender, receiver, assetID, amount, note }) => {

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

        // Create asset transfer transaction
        const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
          from: sender,
          to: receiver,
          amount,
          assetIndex: assetID,
          suggestedParams: params,
          note: noteBytes
        });

        // Return the encoded transaction
        return ResponseProcessor.processResponse({
          txID: txn.txID(),
          encodedTxn: Buffer.from(algosdk.encodeUnsignedTransaction(txn)).toString('base64'),
          txnInfo: {
            type: 'asset-transfer',
            from: sender,
            to: receiver,
            assetID,
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
            text: `Error creating asset transfer transaction: ${error.message || 'Unknown error'}`
          }]
        };
      }
    }
  );

}
