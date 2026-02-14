/**
 * Tinyman Manager for Algorand Remote MCP
 * Provides tool-based access to Tinyman DEX operations
 */

import algosdk from 'algosdk';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { Env, Props } from '../types';
import { Swap, poolUtils, SwapType, SupportedNetwork } from '@tinymanorg/tinyman-js-sdk';
import { signWithTransit } from '../utils/vaultManager';
import { z } from 'zod';

/**
 * Get asset decimals for a given asset ID
 */
async function getAssetDecimals(assetId: number, env: Env): Promise<number> {
  try {
    const algodClient = new algosdk.Algodv2(env.ALGORAND_TOKEN || '', env.ALGORAND_ALGOD, '');
    if (assetId === 0) return 6; // Algo has 6 decimals
    const assetInfo = await algodClient.getAssetByID(assetId).do();
    return assetInfo.params.decimals;
  } catch (error) {
    console.error(`Failed to get decimals for asset ${assetId}:`, error);
    return 6; // Default to 6 decimals if we can't get the info
  }
}

import { createAlgoClient } from '../utils/algoClient';

/**
 * Register Tinyman tools to the MCP server
 */
export async function registerTinymanTools(server: McpServer, env: Env, props: Props): Promise<void> {
  console.log('Registering Tinyman tools for Algorand Remote MCP');

  // Fixed Input Swap
  server.tool(
    'tinyman_fixed_input_swap',
    'Execute a swap with a fixed input amount',
    {
      address: z.string().describe('Sender address'),
      assetIn: z.number().int().describe('ID of the input asset'),
      assetOut: z.number().int().describe('ID of the output asset'),
      amount: z.number().int().describe('Amount to swap (in input asset units)'),
      slippage: z.number().optional().default(0.05).describe('Slippage tolerance (e.g., 0.05 for 5%)'),
      network: z.enum(['mainnet', 'testnet']).optional().default('mainnet').describe('Algorand network')
    },
    async (args) => {
      try {
        const {
          address,
          assetIn,
          assetOut,
          amount,
          slippage,
          network = env.ALGORAND_NETWORK || 'mainnet'
        } = args;

        console.log('[TINYMAN_SWAP] Executing fixed input swap with args:', {
          address,
          assetIn,
          assetOut,
          amount,
          slippage,
          network
        });

        // Add email and provider from props to env for vault operations
        const enhancedEnv = {
          ...env,
          email: props.email,
          provider: props.provider
        };

        if ((!assetIn && assetIn !== 0) || (!assetOut && assetOut !== 0) || !amount || !address) {
          throw new McpError(ErrorCode.InvalidParams, 'Missing required parameters');
        }

        // Create algod client
        const algodClient = createAlgoClient(env.ALGORAND_ALGOD, env.ALGORAND_TOKEN || '') as any;
        if (!algodClient) {
          throw new McpError(ErrorCode.InternalError, 'Failed to create Algorand client');
        }

        const initiatorAddr = address.toString();
        console.log('[TINYMAN_SWAP] Initiator Address:', initiatorAddr);

        // Get pool information
        const pool = await poolUtils.v2.getPoolInfo({
          network: network as SupportedNetwork,
          client: algodClient,
          asset1ID: Number(assetIn),
          asset2ID: Number(assetOut)
        });
        console.log('[TINYMAN_SWAP] Pool Info:', {
          asset1ID: pool.asset1ID,
          asset2ID: pool.asset2ID
        });

        // Get asset decimals
        const [assetInDecimals, assetOutDecimals] = await Promise.all([
          getAssetDecimals(assetIn, enhancedEnv),
          getAssetDecimals(assetOut, enhancedEnv)
        ]);
        console.log('[TINYMAN_SWAP] Asset Decimals - In:', assetInDecimals, 'Out:', assetOutDecimals);

        // Check if the asset IDs match the pool's asset IDs
        const isAssetInFirst = pool.asset1ID === Number(assetIn);
        console.log('[TINYMAN_SWAP] Asset order check:', { 
          isAssetInFirst, 
          poolAsset1: pool.asset1ID, 
          poolAsset2: pool.asset2ID,
          requestAssetIn: assetIn,
          requestAssetOut: assetOut
        });
        
        // Get swap quote - make sure to use the correct asset order based on the pool
        const fixedInputSwapQuote = await Swap.v2.getQuote({
          type: SwapType.FixedInput,
          pool,
          amount: BigInt(amount),
          assetIn: { 
            id: isAssetInFirst ? pool.asset1ID : pool.asset2ID, 
            decimals: isAssetInFirst ? assetInDecimals : assetOutDecimals 
          },
          assetOut: { 
            id: isAssetInFirst ? pool.asset2ID : pool.asset1ID, 
            decimals: isAssetInFirst ? assetOutDecimals : assetInDecimals 
          },
          network: network as SupportedNetwork,
          slippage
        });
        console.log('[TINYMAN_SWAP] Fixed Input Swap Quote:', fixedInputSwapQuote);

        // Generate transactions
        console.log('[TINYMAN_SWAP] Generating transactions with params:', {
          client: algodClient ? 'algodClient (valid)' : 'algodClient (invalid)',
          network,
          quote: fixedInputSwapQuote ? 'quote (valid)' : 'quote (invalid)',
          swapType: SwapType.FixedInput,
          slippage,
          initiatorAddr
        });
        
        // Debug the quote object structure
        console.log('[TINYMAN_SWAP] Quote structure check:', {
          quoteType: fixedInputSwapQuote.type,
          quoteData: fixedInputSwapQuote.data ? 'data exists' : 'data missing',
          quoteDataKeys: fixedInputSwapQuote.data ? Object.keys(fixedInputSwapQuote.data) : [],
          // Use type assertion to access properties safely
          swapType: (fixedInputSwapQuote.data as any)?.swap_type,
          assetIn: (fixedInputSwapQuote.data as any)?.asset_in,
          assetOut: (fixedInputSwapQuote.data as any)?.asset_out
        });
        
        // Check if the quote has transaction data
        const quoteData = fixedInputSwapQuote.data as any;
        if (!quoteData || !quoteData.transactions || quoteData.transactions.length === 0) {
          throw new Error('Quote does not contain transaction data');
        }
        
        console.log('[TINYMAN_SWAP] Using transaction data from quote:', {
          txCount: quoteData.transactions.length
        });
        
        // Get suggested transaction parameters
        const params = await algodClient.getTransactionParams().do();
        
        // Use the fee from the quote
        if (quoteData.transaction_fee) {
          const quoteFee = Number(quoteData.transaction_fee);
          // Calculate fee per transaction - divide by number of transactions and add a small buffer
          const feePerTxn = Math.ceil(quoteFee / quoteData.transactions.length) + 1000;
          params.fee = feePerTxn;
          params.flatFee = true;
          console.log('[TINYMAN_SWAP] Using fee from quote:', {
            quoteTotalFee: quoteFee,
            transactionCount: quoteData.transactions.length,
            feePerTransaction: feePerTxn
          });
        } else {
          // Fallback to a safe default if quote doesn't provide fee info
          params.fee = 3000;
          params.flatFee = true;
          console.log('[TINYMAN_SWAP] Using default fee:', params.fee);
        }
        
        // Create transactions from the quote data
        const transactions = [];
        
        // Handle pay transactions first
        for (const txnData of quoteData.transactions) {
          if (txnData.type === 'pay') {
            // Payment transaction
            const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
              from: initiatorAddr,
              to: txnData.receiver,
              amount: Number(txnData.amount),
              suggestedParams: params
            });
            transactions.push(txn);
            console.log('[TINYMAN_SWAP] Created payment transaction:', {
              to: txnData.receiver,
              amount: Number(txnData.amount)
            });
          }
        }
        
        // Then handle asset transfers
        for (const txnData of quoteData.transactions) {
          if (txnData.type === 'axfer') {
            // Asset transfer transaction
            const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
              from: initiatorAddr,
              to: txnData.receiver,
              amount: Number(txnData.amount),
              assetIndex: txnData.asset_id,
              suggestedParams: params
            });
            transactions.push(txn);
            console.log('[TINYMAN_SWAP] Created asset transfer transaction:', {
              assetId: txnData.asset_id,
              to: txnData.receiver,
              amount: Number(txnData.amount)
            });
          }
        }
        
        // Finally handle application calls
        for (const txnData of quoteData.transactions) {
          if (txnData.type === 'appl') {
            // Application call transaction
            const appArgs = txnData.args ? txnData.args.map((arg: string) => new Uint8Array(Buffer.from(arg, 'base64'))) : [];
            const accounts = txnData.accounts || [];
            const foreignApps = txnData.apps || [];
            const foreignAssets = txnData.assets || [];
            
            // Use the direct function instead of the object-based approach
            const txn = algosdk.makeApplicationNoOpTxn(
              initiatorAddr,
              params,
              txnData.app_id,
              appArgs,
              accounts,
              foreignApps,
              foreignAssets,
              new Uint8Array(0), // note
              undefined, // lease
              undefined, // rekeyTo
              undefined  // boxes
            );
            transactions.push(txn);
            console.log('[TINYMAN_SWAP] Created application call transaction:', {
              appIndex: txnData.app_id,
              appArgsCount: appArgs.length,
              accountsCount: accounts.length,
              foreignAppsCount: foreignApps.length,
              foreignAssetsCount: foreignAssets.length
            });
          }
        }
        
        console.log('[TINYMAN_SWAP] Created transactions:', transactions.length);
        
        // Preserve the original order from the quote
        const orderedTransactions = [];
        for (const txnData of quoteData.transactions) {
          const txnType = txnData.type;
          // Find the corresponding transaction in our transactions array
          for (let i = 0; i < transactions.length; i++) {
            const txn = transactions[i];
            if ((txnType === 'pay' && txn.type === 'pay') || 
                (txnType === 'axfer' && txn.type === 'axfer') || 
                (txnType === 'appl' && txn.type === 'appl')) {
              orderedTransactions.push(txn);
              transactions.splice(i, 1); // Remove the transaction so we don't use it again
              break;
            }
          }
        }
        
        console.log('[TINYMAN_SWAP] Ordered transactions:', orderedTransactions.length);
        
        // Assign group ID
        const txGroup = algosdk.assignGroupID(orderedTransactions);
        console.log('[TINYMAN_SWAP] Assigned group ID to transactions');
        
        // Sign transactions using Hashicorp Vault
        const signedTxns = [];
        
        if (orderedTransactions.length === 0) {
          throw new Error('No transactions created');
        }
        
        for (const txn of orderedTransactions) {
          const encodedTxn = Buffer.from(algosdk.encodeUnsignedTransaction(txn)).toString('base64');

          // Prepare for signing with Vault
          const TAG = Buffer.from("TX");
          const finalEncodedTxn = new Uint8Array(Buffer.from(encodedTxn, 'base64'));
          const finalEncodedTxnTagged = new Uint8Array(TAG.length + finalEncodedTxn.length);
          finalEncodedTxnTagged.set(TAG);
          finalEncodedTxnTagged.set(finalEncodedTxn, TAG.length);

          const finalEncodedTxnBase64 = Buffer.from(finalEncodedTxnTagged).toString('base64');

          // Sign with Vault
          if (!enhancedEnv.email || !enhancedEnv.provider) {
            throw new Error('Email and provider must be provided for transaction signing');
          }
          const signatureResult = await signWithTransit(
            enhancedEnv, 
            finalEncodedTxnBase64, 
            enhancedEnv.email, 
            enhancedEnv.provider
          );

          if (!signatureResult.success || !signatureResult.signature) {
            throw new Error('Failed to sign transaction with vault');
          }

          // Create signed transaction
          const signature = Buffer.from(signatureResult.signature, 'base64');
          
          // Fix the transaction object to replace appAccounts with accounts
          const txnObj = txn.get_obj_for_encoding() as any;
          if (txnObj.appAccounts) {
            txnObj.accounts = txnObj.appAccounts;
            delete txnObj.appAccounts;
          }
          
          // Create signed transaction with fixed object
          const signedTxn = {
            txn: txnObj,
            sig: signature
          };
          
          // Encode the signed transaction
          const encodedSignedTxn = algosdk.encodeObj(signedTxn);
          signedTxns.push(encodedSignedTxn);
        }
        console.log('[TINYMAN_SWAP] All transactions signed:', signedTxns.length);

        // Submit the signed transactions
        const txnBlob = Buffer.concat(signedTxns.map(stxn => Buffer.from(stxn)));
        const swapExecutionResponse = await algodClient.sendRawTransaction(txnBlob).do();
        const txId = swapExecutionResponse.txId || swapExecutionResponse.txid;
        // Wait for confirmation
        const confirmedTxn = await algosdk.waitForConfirmation(algodClient, txId, 5);
        console.log('[TINYMAN_SWAP] Swap Execution Response:', {
          txId: txId,
          confirmedRound: confirmedTxn['confirmed-round']
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              txId: txId,
              confirmedRound: confirmedTxn['confirmed-round'],
              quote: fixedInputSwapQuote
            })
          }]
        };
      } catch (error) {
        console.error('[TINYMAN_SWAP] Error during fixed input swap:', error);
        if (error instanceof McpError) {
          throw error;
        }
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to execute fixed input swap: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // Fixed Output Swap
  server.tool(
    'tinyman_fixed_output_swap',
    'Execute a swap with a fixed output amount',
    {
      address: z.string().describe('Sender address'),
      assetIn: z.number().int().describe('ID of the input asset'),
      assetOut: z.number().int().describe('ID of the output asset'),
      amount: z.number().int().describe('Amount to receive (in output asset units)'),
      slippage: z.number().optional().default(0.05).describe('Slippage tolerance (e.g., 0.05 for 5%)'),
      network: z.enum(['mainnet', 'testnet']).optional().default('mainnet').describe('Algorand network')
    },
    async (args) => {
      try {
        const {
          address,
          assetIn,
          assetOut,
          amount,
          slippage = 0.05,
          network = env.ALGORAND_NETWORK || 'mainnet'
        } = args;

        console.log('[TINYMAN_SWAP] Executing fixed output swap with args:', {
          address: address ? `${address.substring(0, 8)}...` : undefined,
          assetIn,
          assetOut,
          amount,
          slippage,
          network
        });

        // Add email and provider from props to env for vault operations
        const enhancedEnv = {
          ...env,
          email: props.email,
          provider: props.provider
        };

        if ((!assetIn && assetIn !== 0) || (!assetOut && assetOut !== 0) || !amount || !address) {
          throw new McpError(ErrorCode.InvalidParams, 'Missing required parameters');
        }

        // Create algod client
        const algodClient = createAlgoClient(env.ALGORAND_ALGOD, env.ALGORAND_TOKEN || '') as any;
        if (!algodClient) {
          throw new McpError(ErrorCode.InternalError, 'Failed to create Algorand client');
        }

        const initiatorAddr = address;
        console.log('[TINYMAN_SWAP] Initiator Address:', initiatorAddr);

        // Get pool information
        const pool = await poolUtils.v2.getPoolInfo({
          network: network as SupportedNetwork,
          client: algodClient,
          asset1ID: Number(assetIn),
          asset2ID: Number(assetOut)
        });
        console.log('[TINYMAN_SWAP] Pool Info:', {
          asset1ID: pool.asset1ID,
          asset2ID: pool.asset2ID
        });

        // Get asset decimals
        const [assetInDecimals, assetOutDecimals] = await Promise.all([
          getAssetDecimals(assetIn, enhancedEnv),
          getAssetDecimals(assetOut, enhancedEnv)
        ]);
        console.log('[TINYMAN_SWAP] Asset Decimals - In:', assetInDecimals, 'Out:', assetOutDecimals);

        // Check if the asset IDs match the pool's asset IDs
        const isAssetInFirst = pool.asset1ID === Number(assetIn);
        console.log('[TINYMAN_SWAP] Asset order check:', { 
          isAssetInFirst, 
          poolAsset1: pool.asset1ID, 
          poolAsset2: pool.asset2ID,
          requestAssetIn: assetIn,
          requestAssetOut: assetOut
        });
        
        // Get swap quote - make sure to use the correct asset order based on the pool
        const fixedOutputSwapQuote = await Swap.v2.getQuote({
          type: SwapType.FixedOutput,
          pool,
          amount: BigInt(amount),
          assetIn: { 
            id: isAssetInFirst ? pool.asset1ID : pool.asset2ID, 
            decimals: isAssetInFirst ? assetInDecimals : assetOutDecimals 
          },
          assetOut: { 
            id: isAssetInFirst ? pool.asset2ID : pool.asset1ID, 
            decimals: isAssetInFirst ? assetOutDecimals : assetInDecimals 
          },
          network: network as SupportedNetwork,
          slippage
        });
        console.log('[TINYMAN_SWAP] Fixed Output Swap Quote:', fixedOutputSwapQuote);

        // Generate transactions
        console.log('[TINYMAN_SWAP] Generating transactions with params:', {
          client: algodClient ? 'algodClient (valid)' : 'algodClient (invalid)',
          network,
          quote: fixedOutputSwapQuote ? 'quote (valid)' : 'quote (invalid)',
          swapType: SwapType.FixedOutput,
          slippage,
          initiatorAddr
        });
        
        // Debug the quote object structure
        console.log('[TINYMAN_SWAP] Quote structure check:', {
          quoteType: fixedOutputSwapQuote.type,
          quoteData: fixedOutputSwapQuote.data ? 'data exists' : 'data missing',
          quoteDataKeys: fixedOutputSwapQuote.data ? Object.keys(fixedOutputSwapQuote.data) : [],
          // Use type assertion to access properties safely
          swapType: (fixedOutputSwapQuote.data as any)?.swap_type,
          assetIn: (fixedOutputSwapQuote.data as any)?.asset_in,
          assetOut: (fixedOutputSwapQuote.data as any)?.asset_out
        });
        
        // Check if the quote has transaction data
        const quoteData = fixedOutputSwapQuote.data as any;
        if (!quoteData || !quoteData.transactions || quoteData.transactions.length === 0) {
          throw new Error('Quote does not contain transaction data');
        }
        
        console.log('[TINYMAN_SWAP] Using transaction data from quote:', {
          txCount: quoteData.transactions.length
        });
        
        // Get suggested transaction parameters
        const params = await algodClient.getTransactionParams().do();
        
        // Use the fee from the quote
        if (quoteData.transaction_fee) {
          const quoteFee = Number(quoteData.transaction_fee);
          // Calculate fee per transaction - divide by number of transactions and add a small buffer
          const feePerTxn = Math.ceil(quoteFee / quoteData.transactions.length) + 1000;
          params.fee = feePerTxn;
          params.flatFee = true;
          console.log('[TINYMAN_SWAP] Using fee from quote:', {
            quoteTotalFee: quoteFee,
            transactionCount: quoteData.transactions.length,
            feePerTransaction: feePerTxn
          });
        } else {
          // Fallback to a safe default if quote doesn't provide fee info
          params.fee = 3000;
          params.flatFee = true;
          console.log('[TINYMAN_SWAP] Using default fee:', params.fee);
        }
        
        // Create transactions from the quote data
        const transactions = [];
        
        // Handle pay transactions first
        for (const txnData of quoteData.transactions) {
          if (txnData.type === 'pay') {
            // Payment transaction
            const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
              from: initiatorAddr,
              to: txnData.receiver,
              amount: Number(txnData.amount),
              suggestedParams: params
            });
            transactions.push(txn);
            console.log('[TINYMAN_SWAP] Created payment transaction:', {
              to: txnData.receiver,
              amount: Number(txnData.amount)
            });
          }
        }
        
        // Then handle asset transfers
        for (const txnData of quoteData.transactions) {
          if (txnData.type === 'axfer') {
            // Asset transfer transaction
            const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
              from: initiatorAddr,
              to: txnData.receiver,
              amount: Number(txnData.amount),
              assetIndex: txnData.asset_id,
              suggestedParams: params
            });
            transactions.push(txn);
            console.log('[TINYMAN_SWAP] Created asset transfer transaction:', {
              assetId: txnData.asset_id,
              to: txnData.receiver,
              amount: Number(txnData.amount)
            });
          }
        }
        
        // Finally handle application calls
        for (const txnData of quoteData.transactions) {
          if (txnData.type === 'appl') {
            // Application call transaction
            const appArgs = txnData.args ? txnData.args.map((arg: string) => new Uint8Array(Buffer.from(arg, 'base64'))) : [];
            const accounts = txnData.accounts || [];
            const foreignApps = txnData.apps || [];
            const foreignAssets = txnData.assets || [];
            
            // Use the direct function instead of the object-based approach
            const txn = algosdk.makeApplicationNoOpTxn(
              initiatorAddr,
              params,
              txnData.app_id,
              appArgs,
              accounts,
              foreignApps,
              foreignAssets,
              new Uint8Array(0), // note
              undefined, // lease
              undefined, // rekeyTo
              undefined  // boxes
            );
            transactions.push(txn);
            console.log('[TINYMAN_SWAP] Created application call transaction:', {
              appIndex: txnData.app_id,
              appArgsCount: appArgs.length,
              accountsCount: accounts.length,
              foreignAppsCount: foreignApps.length,
              foreignAssetsCount: foreignAssets.length
            });
          }
        }
        
        console.log('[TINYMAN_SWAP] Created transactions:', transactions.length);
        
        // Preserve the original order from the quote
        const orderedTransactions = [];
        for (const txnData of quoteData.transactions) {
          const txnType = txnData.type;
          // Find the corresponding transaction in our transactions array
          for (let i = 0; i < transactions.length; i++) {
            const txn = transactions[i];
            if ((txnType === 'pay' && txn.type === 'pay') || 
                (txnType === 'axfer' && txn.type === 'axfer') || 
                (txnType === 'appl' && txn.type === 'appl')) {
              orderedTransactions.push(txn);
              transactions.splice(i, 1); // Remove the transaction so we don't use it again
              break;
            }
          }
        }
        
        console.log('[TINYMAN_SWAP] Ordered transactions:', orderedTransactions.length);
        
        // Assign group ID
        const txGroup = algosdk.assignGroupID(orderedTransactions);
        console.log('[TINYMAN_SWAP] Assigned group ID to transactions');
        
        // Sign transactions using Hashicorp Vault
        const signedTxns = [];
        
        if (orderedTransactions.length === 0) {
          throw new Error('No transactions created');
        }
        
        for (const txn of orderedTransactions) {
          const encodedTxn = Buffer.from(algosdk.encodeUnsignedTransaction(txn)).toString('base64');

          // Prepare for signing with Vault
          const TAG = Buffer.from("TX");
          const finalEncodedTxn = new Uint8Array(Buffer.from(encodedTxn, 'base64'));
          const finalEncodedTxnTagged = new Uint8Array(TAG.length + finalEncodedTxn.length);
          finalEncodedTxnTagged.set(TAG);
          finalEncodedTxnTagged.set(finalEncodedTxn, TAG.length);

          const finalEncodedTxnBase64 = Buffer.from(finalEncodedTxnTagged).toString('base64');

          // Sign with Vault
          if (!enhancedEnv.email || !enhancedEnv.provider) {
            throw new Error('Email and provider must be provided for transaction signing');
          }
          const signatureResult = await signWithTransit(
            enhancedEnv, 
            finalEncodedTxnBase64, 
            enhancedEnv.email, 
            enhancedEnv.provider
          );

          if (!signatureResult.success || !signatureResult.signature) {
            throw new Error('Failed to sign transaction with vault');
          }

          // Create signed transaction
          const signature = Buffer.from(signatureResult.signature, 'base64');
          
          // Fix the transaction object to replace appAccounts with accounts
          const txnObj = txn.get_obj_for_encoding() as any;
          if (txnObj.appAccounts) {
            txnObj.accounts = txnObj.appAccounts;
            delete txnObj.appAccounts;
          }
          
          // Create signed transaction with fixed object
          const signedTxn = {
            txn: txnObj,
            sig: signature
          };
          
          // Encode the signed transaction
          const encodedSignedTxn = algosdk.encodeObj(signedTxn);
          signedTxns.push(encodedSignedTxn);
        }
        console.log('[TINYMAN_SWAP] All transactions signed:', signedTxns.length);

        // Submit the signed transactions
        const txnBlob = Buffer.concat(signedTxns.map(stxn => Buffer.from(stxn)));
        const swapExecutionResponse = await algodClient.sendRawTransaction(txnBlob).do();
        const txId = swapExecutionResponse.txId || swapExecutionResponse.txid;
        // Wait for confirmation
        const confirmedTxn = await algosdk.waitForConfirmation(algodClient, txId, 5);
        console.log('[TINYMAN_SWAP] Swap Execution Response:', {
          txId: txId,
          confirmedRound: confirmedTxn['confirmed-round']
        });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              txId: txId,
              confirmedRound: confirmedTxn['confirmed-round'],
              quote: fixedOutputSwapQuote
            })
          }]
        };
      } catch (error) {
        console.error('[TINYMAN_SWAP] Error during fixed output swap:', error);
        if (error instanceof McpError) {
          throw error;
        }
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to execute fixed output swap: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );
}
