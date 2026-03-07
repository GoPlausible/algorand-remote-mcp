/**
 * Haystack Router Tools for Algorand Remote MCP
 * DEX aggregator that finds the best swap route across multiple Algorand DEXes
 */

import { z } from 'zod';
import * as algosdk from 'algosdk';
import * as msgpack from 'algo-msgpack-with-bigint';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResponseProcessor } from '../../../utils';
import { Env, Props } from '../../../types';
import { getRouterClient } from './routerClient';
import {
  getUserAddress,
  getPublicKey,
  signWithTransit
} from '../../../utils/vaultManager';

function ConcatArrays(...arrs: ArrayLike<number>[]) {
  const size = arrs.reduce((sum, arr) => sum + arr.length, 0);
  const c = new Uint8Array(size);
  let offset = 0;
  for (let i = 0; i < arrs.length; i++) {
    c.set(arrs[i], offset);
    offset += arrs[i].length;
  }
  return c;
}

/**
 * Register Haystack Router tools to the MCP server
 */
export function registerHaystackRouterTools(server: McpServer, env: Env, props: Props): void {
  // Get swap quote
  server.tool(
    'haystack_get_swap_quote',
    'Get an optimized swap quote from Haystack Router — a DEX aggregator that finds the best swap route across multiple Algorand DEXes (Tinyman V2, Pact, Folks) and LST protocols (tALGO, xALGO). Returns the best-price quote with route details, USD values, and price impact. All amounts are in base units (e.g., 1000000 = 1 ALGO).',
    {
      fromASAID: z.number().int().describe('Input asset ID (0 = ALGO, 31566704 = USDC, 312769 = USDt, etc.)'),
      toASAID: z.number().int().describe('Output asset ID (0 = ALGO, 31566704 = USDC, 312769 = USDt, etc.)'),
      amount: z.number().int().describe('Amount in base units (e.g., 1000000 = 1 ALGO with 6 decimals)'),
      type: z.enum(['fixed-input', 'fixed-output']).default('fixed-input').describe('Quote type: fixed-input or fixed-output'),
      address: z.string().optional().describe('User Algorand address (optional, needed for auto opt-in detection)'),
      maxGroupSize: z.number().int().optional().default(16).describe('Maximum transactions in atomic group'),
      maxDepth: z.number().int().optional().default(4).describe('Maximum routing hops')
    },
    async ({ fromASAID, toASAID, amount, type, address, maxGroupSize, maxDepth }) => {
      try {
        const router = getRouterClient(env);

        const quoteParams: any = {
          fromASAID,
          toASAID,
          amount: BigInt(amount),
          type,
        };

        if (address) quoteParams.address = address;
        if (maxGroupSize !== undefined) quoteParams.maxGroupSize = maxGroupSize;
        if (maxDepth !== undefined) quoteParams.maxDepth = maxDepth;

        const quote = await router.newQuote(quoteParams);

        const result: any = {
          expectedOutput: quote.quote.toString(),
          inputAmount: quote.amount.toString(),
          fromASAID: quote.fromASAID,
          toASAID: quote.toASAID,
          type: quote.type,
          usdIn: quote.usdIn,
          usdOut: quote.usdOut,
          userPriceImpact: quote.userPriceImpact,
          marketPriceImpact: quote.marketPriceImpact,
          route: quote.route,
          flattenedRoute: quote.flattenedRoute,
          requiredAppOptIns: quote.requiredAppOptIns,
          protocolFees: quote.protocolFees,
          createdAt: quote.createdAt,
        };

        if (quote.address) {
          result.address = quote.address;
        }

        return ResponseProcessor.processResponse(result);
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Failed to get Haystack swap quote: ${error.message || 'Unknown error'}`
          }]
        };
      }
    }
  );

  // Execute swap
  server.tool(
    'haystack_execute_swap',
    'Execute an optimized token swap via Haystack Router — gets the best route across multiple DEXes (Tinyman V2, Pact, Folks) and LST protocols, then signs with the vault wallet and submits. This is an all-in-one tool: quote → sign → submit → confirm. All amounts are in base units.',
    {
      fromASAID: z.number().int().describe('Input asset ID (0 = ALGO, 31566704 = USDC, 312769 = USDt, etc.)'),
      toASAID: z.number().int().describe('Output asset ID (0 = ALGO, 31566704 = USDC, 312769 = USDt, etc.)'),
      amount: z.number().int().describe('Amount in base units (e.g., 1000000 = 1 ALGO with 6 decimals)'),
      slippage: z.number().optional().default(1).describe('Slippage tolerance percentage (e.g., 1 = 1%)'),
      type: z.enum(['fixed-input', 'fixed-output']).default('fixed-input').describe('Quote type'),
      note: z.string().optional().describe('Optional note to attach to the input transaction'),
      maxGroupSize: z.number().int().optional().default(16).describe('Maximum transactions in atomic group'),
      maxDepth: z.number().int().optional().default(4).describe('Maximum routing hops')
    },
    async ({ fromASAID, toASAID, amount, slippage, type, note, maxGroupSize, maxDepth }) => {
      if (!props.email || !props.provider) {
        return {
          content: [{
            type: 'text',
            text: 'Email and provider must be provided for swap execution'
          }]
        };
      }

      try {
        // 1. Get user address and public key from vault
        const address = await getUserAddress(env, props.email, props.provider);
        if (!address) {
          throw new Error('No active agent wallet configured');
        }

        const publicKeyResult = await getPublicKey(env, props.email, props.provider);
        if (!publicKeyResult.success || !publicKeyResult.publicKey) {
          throw new Error('Failed to get public key from vault');
        }

        // 2. Create a vault-based signer
        const signer = async (
          txnGroup: algosdk.Transaction[],
          indexesToSign: number[],
        ): Promise<Uint8Array[]> => {
          const results: Uint8Array[] = [];

          for (const index of indexesToSign) {
            const txn = txnGroup[index];
            const encodedTxn = algosdk.encodeUnsignedTransaction(txn);

            // Prepend "TX" tag for signing
            const TAG = Buffer.from('TX');
            const taggedTxn = ConcatArrays(TAG, encodedTxn);
            const taggedTxnBase64 = Buffer.from(taggedTxn).toString('base64');

            // Sign with vault
            const signatureResult = await signWithTransit(env, taggedTxnBase64, props.email!, props.provider!);
            if (!signatureResult.success || !signatureResult.signature) {
              throw new Error(`Failed to sign transaction at index ${index} with vault`);
            }

            const signature = new Uint8Array(Buffer.from(signatureResult.signature, 'base64'));

            // Construct signed transaction using msgpack
            const txnObj = msgpack.decode(algosdk.encodeUnsignedTransaction(txn));
            const signedTxn: any = {
              txn: txnObj,
              sig: signature,
            };

            results.push(new Uint8Array(msgpack.encode(signedTxn, { sortKeys: true, ignoreUndefined: true })));
          }

          return results;
        };

        // 3. Get router client and fetch quote
        const router = getRouterClient(env);

        const quoteParams: any = {
          fromASAID,
          toASAID,
          amount: BigInt(amount),
          type,
          address,
        };
        if (maxGroupSize !== undefined) quoteParams.maxGroupSize = maxGroupSize;
        if (maxDepth !== undefined) quoteParams.maxDepth = maxDepth;

        const quote = await router.newQuote(quoteParams);

        // 4. Build and execute swap
        const swapConfig: any = {
          quote,
          address,
          signer,
          slippage,
        };
        if (note) {
          swapConfig.note = new TextEncoder().encode(note);
        }

        const swap = await router.newSwap(swapConfig);
        const result = await swap.execute();

        // 5. Get swap summary
        const summary = swap.getSummary();
        const inputTxnId = swap.getInputTransactionId();

        // 6. Build response
        const response: any = {
          status: 'confirmed',
          confirmedRound: result.confirmedRound.toString(),
          txIds: result.txIds,
          signer: address,
          network: env.ALGORAND_NETWORK || 'mainnet',
          quote: {
            fromASAID: quote.fromASAID,
            toASAID: quote.toASAID,
            expectedOutput: quote.quote.toString(),
            inputAmount: quote.amount.toString(),
            type: quote.type,
            usdIn: quote.usdIn,
            usdOut: quote.usdOut,
            userPriceImpact: quote.userPriceImpact,
            route: quote.flattenedRoute,
          },
          slippage,
        };

        if (summary) {
          response.summary = {
            inputAssetId: summary.inputAssetId.toString(),
            outputAssetId: summary.outputAssetId.toString(),
            inputAmount: summary.inputAmount.toString(),
            outputAmount: summary.outputAmount.toString(),
            totalFees: summary.totalFees.toString(),
            transactionCount: summary.transactionCount,
            inputTxnId: summary.inputTxnId,
            outputTxnId: summary.outputTxnId,
          };
        }

        if (inputTxnId) {
          response.inputTransactionId = inputTxnId;
        }

        return ResponseProcessor.processResponse(response);
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Haystack swap failed: ${error.message || 'Unknown error'}`
          }]
        };
      }
    }
  );

  // Check opt-in status
  server.tool(
    'haystack_needs_optin',
    'Check if an Algorand address needs to opt into an asset before swapping. Returns true if opt-in is needed. Always returns false for ALGO (ASA 0).',
    {
      address: z.string().describe('Algorand address to check'),
      assetId: z.number().int().describe('Asset ID to check opt-in status for')
    },
    async ({ address, assetId }) => {
      try {
        const router = getRouterClient(env);
        const needsOptIn = await router.needsAssetOptIn(address, assetId);

        return ResponseProcessor.processResponse({
          address,
          assetId,
          needsOptIn,
          network: env.ALGORAND_NETWORK || 'mainnet',
        });
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Failed to check asset opt-in: ${error.message || 'Unknown error'}`
          }]
        };
      }
    }
  );
}
