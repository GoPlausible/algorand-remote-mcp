/**
 * Account Manager for Algorand Remote MCP
 * Handles account-related operations on the Algorand blockchain
 */

import algosdk from 'algosdk';
import { z } from 'zod';
import { ResponseProcessor } from '../utils';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Env, Props } from '../types';
import { 
  getUserAccountType, 
  retrieveSecret, 
  getPublicKey, 
  createKeypair, 
  deleteSecret, 
  signWithSecret,
  signWithVault 
} from '../utils/vaultManager';

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
  
  // Migration tool for KV-based accounts
  server.tool(
    'migrate_to_vault',
    'Migrate your account from KV-based mnemonic to vault-based keypair',
    {},
    async () => {
      try {
        // Check if user already has a KV-based account
        const mnemonic = await retrieveSecret(env, props.email);
        
        if (!mnemonic) {
          return {
            content: [{
              type: 'text',
              text: 'No KV-based account found for migration.'
            }]
          };
        }
        
        // Check if user already has a vault-based account
        const publicKeyResult = await getPublicKey(env, props.email);
        
        if (publicKeyResult.success) {
          return {
            content: [{
              type: 'text',
              text: 'You already have a vault-based account. No migration needed.'
            }]
          };
        }
        
        // Get old account information
        const oldAccount = algosdk.mnemonicToSecretKey(mnemonic);
        const oldAddress = oldAccount.addr;
        
        // Get account information to identify assets and check balance
        if (!env.ALGORAND_ALGOD) {
          throw new Error('Algorand node URL not configured');
        }
        const algodClient = new algosdk.Algodv2(env.ALGORAND_TOKEN || '', env.ALGORAND_ALGOD, '');
        
        let accountInfo;
        try {
          accountInfo = await algodClient.accountInformation(oldAddress).do();
        } catch (error) {
          // Account doesn't exist on the blockchain (0 Algo)
          // Just create a new vault-based account and delete the old mnemonic
          console.log('Account not found on blockchain, creating new vault-based account');
          
          // Create a new vault-based account
          if (!props.email) {
            throw new Error('User email is required for migration');
          }
          const keypairResult = await createKeypair(env, props.email);
          
          if (!keypairResult.success) {
            throw new Error(keypairResult.error || 'Failed to create keypair in vault');
          }
          
          // Get the new address
          const newPublicKeyResult = await getPublicKey(env, props.email);
          
          if (!newPublicKeyResult.success || !newPublicKeyResult.publicKey) {
            throw new Error(newPublicKeyResult.error || 'Failed to get public key from vault');
          }
          
          const newPublicKeyBuffer = Buffer.from(newPublicKeyResult.publicKey, 'base64');
          const newAddress = algosdk.encodeAddress(newPublicKeyBuffer);
          
          // Delete the old mnemonic
          await deleteSecret(env, props.email);
          
          return ResponseProcessor.processResponse({
            success: true,
            oldAddress,
            newAddress,
            message: 'A new vault-based account has been created. The old account was not active on the blockchain.'
          });
        }
        
        // Count assets that need to be migrated
        const assets = accountInfo.assets || [];
        const assetsToMigrate = assets.filter((asset: any) => asset.amount > 0);
        const assetCount = assetsToMigrate.length;
        
        // Calculate required fees
        const requiredFees = (2 * assetCount + 1) * 0.001; // (2N + 1) * 0.001 Algo
        
        // Get minimum balance requirement directly from account info
        const mbr = accountInfo['min-balance'];
        
        // Check if account has enough balance for migration
        const spendableBalance = accountInfo.amount - mbr;
        
        // If account has no assets and insufficient balance for migration,
        // just create a new vault-based account
        if (assetCount === 0 && spendableBalance < requiredFees * 1000000) {
          console.log('Account has no assets and insufficient balance, creating new vault-based account');
          
          // Create a new vault-based account
          if (!props.email) {
            throw new Error('User email is required for migration');
          }
          const keypairResult = await createKeypair(env, props.email);
          
          if (!keypairResult.success) {
            throw new Error(keypairResult.error || 'Failed to create keypair in vault');
          }
          
          // Get the new address
          const newPublicKeyResult = await getPublicKey(env, props.email);
          
          if (!newPublicKeyResult.success || !newPublicKeyResult.publicKey) {
            throw new Error(newPublicKeyResult.error || 'Failed to get public key from vault');
          }
          
          const newPublicKeyBuffer = Buffer.from(newPublicKeyResult.publicKey, 'base64');
          const newAddress = algosdk.encodeAddress(newPublicKeyBuffer);
          
          // Delete the old mnemonic
          await deleteSecret(env, props.email);
          
          return ResponseProcessor.processResponse({
            success: true,
            oldAddress,
            newAddress,
            message: 'A new vault-based account has been created. The old account had insufficient balance for migration and no assets.'
          });
        }
        
        // If account has assets but insufficient balance, return an error
        if (assetCount > 0 && spendableBalance < requiredFees * 1000000 + 10000) {
          return {
            content: [{
              type: 'text',
              text: `Cannot migrate account: Insufficient balance for migration. You need at least ${requiredFees.toFixed(3)} Algo above your minimum balance requirement for transaction fees. Current spendable balance: ${(spendableBalance / 1000000).toFixed(6)} Algo.`
            }]
          };
        }
        
        // If we get here, the account has either:
        // 1. No assets but sufficient balance for migration, or
        // 2. Assets and sufficient balance for migration
        
        // Step 1: Create a new vault-based account
        if (!props.email) {
          throw new Error('User email is required for migration');
        }
        const keypairResult = await createKeypair(env, props.email);
        
        if (!keypairResult.success) {
          throw new Error(keypairResult.error || 'Failed to create keypair in vault');
        }
        
        // Get the public key and derive the address
        const newPublicKeyResult = await getPublicKey(env, props.email);
        
        if (!newPublicKeyResult.success || !newPublicKeyResult.publicKey) {
          throw new Error(newPublicKeyResult.error || 'Failed to get public key from vault');
        }
        
        const newPublicKeyBuffer = Buffer.from(newPublicKeyResult.publicKey, 'base64');
        const newAddress = algosdk.encodeAddress(newPublicKeyBuffer);
        
        // If there are no assets to migrate, we can skip to the final step
        if (assetCount === 0) {
          // Step 5: Close out the old account to the new account (transfer all remaining Algos)
          const params = await algodClient.getTransactionParams().do();
          const closeTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
            from: oldAddress,
            to: newAddress,
            amount: 0, // Just send 0 amount
            closeRemainderTo: newAddress, // This will send all remaining Algos to the new address
            suggestedParams: params
          });
          
          // Sign with old account's private key
          const signedCloseTxn = closeTxn.signTxn(oldAccount.sk);
          
          // Submit transaction
          const closeResult = await algodClient.sendRawTransaction(signedCloseTxn).do();
          await algosdk.waitForConfirmation(algodClient, closeResult.txId, 4);
          
          // Delete the old mnemonic
          await deleteSecret(env, props.email);
          
          return ResponseProcessor.processResponse({
            success: true,
            oldAddress,
            newAddress,
            closeTransaction: closeResult.txId,
            message: 'Account successfully migrated to the vault. Your account is now more secure.'
          });
        }
        
        // If we get here, the account has assets and sufficient balance
        
        // Step 2: Fund the new account with minimum amount to cover opt-ins
        const params = await algodClient.getTransactionParams().do();
        
        // Calculate funding amount: minimum balance (0.1 Algo) + fees for opt-ins
        const fundingAmount = 100000 + assetCount * 100000; // 0.1 Algo + 0.1 Algo per asset for min balance
        
        const fundingTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
          from: oldAddress,
          to: newAddress,
          amount: fundingAmount,
          suggestedParams: params
        });
        
        // Sign with old account's private key
        const signedFundingTxn = fundingTxn.signTxn(oldAccount.sk);
        
        // Submit transaction
        const fundingResult = await algodClient.sendRawTransaction(signedFundingTxn).do();
        await algosdk.waitForConfirmation(algodClient, fundingResult.txId, 4);
        
        // Step 3: Opt-in to all assets from the old account
        const optinResults = [];
        
        for (const assetHolding of assetsToMigrate) {
          // Create opt-in transaction
          const optinTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
            from: newAddress,
            to: newAddress,
            amount: 0,
            assetIndex: assetHolding['asset-id'],
            suggestedParams: params
          });
          
          // Sign with vault
          if (!props.email) {
            throw new Error('User email is required for signing');
          }
          const encodedTxn = Buffer.from(algosdk.encodeUnsignedTransaction(optinTxn)).toString('base64');
          const signature = await signWithSecret(env, props.email as string, encodedTxn);
          
          if (!signature) {
            throw new Error(`Failed to sign opt-in transaction for asset ${assetHolding['asset-id']}`);
          }
          
          // Submit transaction
          const txResult = await algodClient.sendRawTransaction(Buffer.from(signature, 'base64')).do();
          await algosdk.waitForConfirmation(algodClient, txResult.txId, 4);
          
          optinResults.push({
            assetId: assetHolding['asset-id'],
            txId: txResult.txId,
            status: 'success'
          });
        }
        
        // Step 4: Transfer all assets from old account to new account
        const transferResults = [];
        
        for (const assetHolding of assetsToMigrate) {
          // Create asset transfer transaction with closeRemainderTo
          const transferTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
            from: oldAddress,
            to: newAddress,
            amount: 0, // Just send 0 amount
            assetIndex: assetHolding['asset-id'],
            closeRemainderTo: newAddress, // This will send all assets to the new address
            suggestedParams: params
          });
          
          // Sign with old account's private key
          const signedTxn = transferTxn.signTxn(oldAccount.sk);
          
          // Submit transaction
          const txResult = await algodClient.sendRawTransaction(signedTxn).do();
          await algosdk.waitForConfirmation(algodClient, txResult.txId, 4);
          
          transferResults.push({
            assetId: assetHolding['asset-id'],
            txId: txResult.txId,
            status: 'success'
          });
        }
        
        // Step 5: Close out the old account to the new account (transfer all remaining Algos)
        const closeTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
          from: oldAddress,
          to: newAddress,
          amount: 0, // Just send 0 amount
          closeRemainderTo: newAddress, // This will send all remaining Algos to the new address
          suggestedParams: params
        });
        
        // Sign with old account's private key
        const signedCloseTxn = closeTxn.signTxn(oldAccount.sk);
        
        // Submit transaction
        const closeResult = await algodClient.sendRawTransaction(signedCloseTxn).do();
        await algosdk.waitForConfirmation(algodClient, closeResult.txId, 4);
        
        // Step 6: Delete the secret from the KV store
        await deleteSecret(env, props.email);
        
        return ResponseProcessor.processResponse({
          success: true,
          oldAddress,
          newAddress,
          fundingTransaction: fundingResult.txId,
          optinResults,
          transferResults,
          closeTransaction: closeResult.txId,
          message: 'Account successfully migrated to the vault. Your account is now more secure.',
          benefits: [
            'Enhanced security with HashiCorp Vault',
            'Private keys never leave the secure vault',
            'Cryptographic operations performed within the vault',
            'Better key management and rotation capabilities'
          ]
        });
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Error migrating account: ${error.message || 'Unknown error'}`
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
