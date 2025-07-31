/**
 * Algod Asset API Tools
 * Direct access to Algorand node asset data
 */

import algosdk from 'algosdk';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResponseProcessor } from '../../../utils';
import { Env } from '../../../types';

/**
 * Create and validate an Algorand client
 */
function createAlgoClient(algodUrl: string, token:string): algosdk.Algodv2 | null {
  if (!algodUrl) {
    console.error('Algorand node URL not configured');
    return null;
  }
  
  return new algosdk.Algodv2(token, algodUrl, '');
}

/**
 * Register asset API tools to the MCP server
 */
export function registerAssetApiTools(server: McpServer,env: Env): void {
  // Get asset information
  server.tool(
    'api_algod_get_asset_info',
    'Get asset details from algod',
    { 
      assetId: z.number().int().describe('The asset ID')
    },
    async ({ assetId }) => {
      
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
        
        // Get asset information
        const response = await algodClient.getAssetByID(Number(assetId)).do();
        
        // Format the response to include more readable asset information
        const assetParams = response.params;
        const formattedResponse = {
          ...response,
          readableParams: {
            name: assetParams.name,
            unitName: assetParams['unit-name'],
            total: assetParams.total,
            decimals: assetParams.decimals,
            defaultFrozen: assetParams['default-frozen'],
            creator: assetParams.creator,
            manager: assetParams.manager,
            reserve: assetParams.reserve,
            freeze: assetParams.freeze,
            clawback: assetParams.clawback,
            url: assetParams.url ? Buffer.from(assetParams.url).toString() : undefined,
            metadataHash: assetParams['metadata-hash'] 
              ? Buffer.from(assetParams['metadata-hash']).toString('hex') 
              : undefined
          }
        };
        
        return ResponseProcessor.processResponse(formattedResponse);
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Error getting asset info: ${error.message || 'Unknown error'}`
          }]
        };
      }
    }
  );
  
  // Get asset holding information
  server.tool(
    'api_algod_get_asset_holding',
    'Get asset holding information for an account',
    { 
      address: z.string().describe('Account address'),
      assetId: z.number().int().describe('The asset ID')
    },
    async ({ address, assetId }) => {
      
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
        
        // Validate address
        if (!algosdk.isValidAddress(address)) {
          throw new Error('Invalid Algorand address');
        }
        
        // Get asset holding information
        const accountInfo = await algodClient.accountInformation(String(address)).do();
        const assets = accountInfo.assets || [];
        
        // Find the specific asset
        const assetInfo = assets.find((asset: any) => asset['asset-id'] === assetId);
        
        if (!assetInfo) {
          return {
            content: [{
              type: 'text',
              text: `Account ${address} does not hold asset ${assetId}`
            }]
          };
        }
        
        const formattedResponse = {
          address,
          assetId,
          amount: assetInfo.amount,
          isFrozen: assetInfo['is-frozen'],
          optedIn: true
        };
        
        return ResponseProcessor.processResponse(formattedResponse);
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Error getting asset holding: ${error.message || 'Unknown error'}`
          }]
        };
      }
    }
  );
    // Get asset verification status from Pera Wallet
  server.tool(
    'asset_verification_status',
    'Get the verification status of an Algorand asset from Pera Wallet',
    { 
      assetId: z.number().int().min(0).max(9223372036854776000)
        .describe('Asset ID to check verification status')
    },
    async ({ assetId }) => {
      // Define the expected response type
      interface AssetVerificationResponse {
        asset_id: number;
        verification_tier: "verified" | "unverified" | "suspicious";
        explorer_url: string;
      }
      
      // Get the Pera Wallet API URL from environment variables or use default
      const peraWalletApiBaseUrl = env.PERA_WALLET_API_URL || 'https://mainnet.api.perawallet.app/v1/public';
      const verificationEndpoint = `${peraWalletApiBaseUrl}/asset-verifications/${assetId}/`;
      
      try {
        // Make API request to Pera Wallet
        const response = await fetch(verificationEndpoint);
        
        if (!response.ok) {
          if (response.status === 404) {
            // Get the Pera Explorer URL from environment variables or use default
            const explorerBaseUrl = env.PERA_EXPLORER_URL || 'https://explorer.perawallet.app';
            return ResponseProcessor.processResponse({
              asset_id: assetId,
              verification_tier: "unverified" as const,
              explorer_url: `${explorerBaseUrl}/asset/${assetId}/`,
              message: "Asset not found in Pera verification database"
            });
          }
          
          throw new Error(`API request failed with status: ${response.status}`);
        }
        
        const data = await response.json() as AssetVerificationResponse;
        
        return ResponseProcessor.processResponse({
          asset_id: data.asset_id,
          verification_tier: data.verification_tier,
          explorer_url: data.explorer_url
        });
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Error checking asset verification status: ${error.message || 'Unknown error'}`
          }]
        };
      }
    }
  );
}
