/**
 * ARC-26 Manager for Algorand Remote MCP
 * Handles Algorand URI generation following ARC-26 specification
 * https://github.com/algorandfoundation/ARCs/blob/main/ARCs/arc-0026.md
 */

import { z } from 'zod';
import { ResponseProcessor } from '../utils';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Env, Props } from '../types';

/**
 * Generate Algorand URI following ARC-26 specification
 * 
 * URI types:
 * 1. Account URI (for contacts): Just the address, optionally with a label
 *    - algorand://ADDRESS
 *    - algorand://ADDRESS?label=Silvio
 * 
 * 2. Payment URI: Address with amount (no asset)
 *    - algorand://ADDRESS?amount=150500000
 * 
 * 3. Asset Transfer URI: Address with amount and asset
 *    - algorand://ADDRESS?amount=150&asset=45
 * 
 * @param address Algorand address
 * @param label Optional label for the address
 * @param amount Optional amount in microAlgos (for payment) or asset units (for asset transfer)
 * @param assetId Optional asset ID (for asset transfer)
 * @param note Optional note
 * @returns Algorand URI string
 */
function generateAlgorandUri(
  address: string,
  label?: string,
  amount?: number,
  assetId?: number,
  note?: string
): string {
  // Validate address format (58 characters)
  if (!/^[A-Z2-7]{58}$/.test(address)) {
    throw new Error('Invalid Algorand address format');
  }
  
  // Build the base URI
  let uri = `algorand://${address}`;
  
  // Build query parameters
  const queryParams: string[] = [];
  
  // Add optional label
  if (label) {
    queryParams.push(`label=${encodeURIComponent(label)}`);
  }
  
  // Add optional amount
  if (amount !== undefined) {
    queryParams.push(`amount=${amount}`);
  }
  
  // Add optional assetId
  if (assetId !== undefined) {
    queryParams.push(`asset=${assetId}`);
  }
  
  // Add optional note
  if (note) {
    queryParams.push(`note=${encodeURIComponent(note)}`);
  }
  
  // Append query string if we have parameters
  if (queryParams.length > 0) {
    uri += '?' + queryParams.join('&');
  }
  
  return uri;
}

/**
 * Register ARC-26 tools to the MCP server
 */
export function registerArc26Tools(server: McpServer, env: Env, props: Props): void {
  // Generate Algorand URI
  server.tool(
    'generate_algorand_uri',
    'Generate a URI following the Algorand ARC-26 specification to send account address or request payment or asset transfer',
    {
      address: z.string().describe('Algorand address (58 characters)'),
      label: z.string().optional().describe('Optional label for the address'),
      amount: z.number().optional().describe('Amount in microAlgos (for payment) or asset units (for asset transfer)'),
      assetId: z.number().optional().describe('Asset ID (for asset transfer)'),
      note: z.string().optional().describe('Optional note')
    },
    async ({ address, label, amount, assetId, note }) => {
      try {
        const uri = generateAlgorandUri(address, label, amount, assetId, note);
        
        // Determine URI type
        let uriType = 'Account URI';
        if (amount !== undefined && assetId !== undefined) {
          uriType = 'Asset Transfer URI';
        } else if (amount !== undefined) {
          uriType = 'Payment URI';
        }
        
        return ResponseProcessor.processResponse({ 
          uri,
          uriType,
        });
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Error generating Algorand URI: ${error.message || 'Unknown error'}`
          }]
        };
      }
    }
  );
}
