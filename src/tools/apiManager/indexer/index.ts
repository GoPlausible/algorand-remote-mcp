/**
 * Indexer API Manager
 * Exports and registers all Algorand indexer API tools
 */
import { Env } from '../../../types';
import { registerIndexerAccountTools } from './account';
import { registerIndexerApplicationTools } from './application';
import { registerIndexerAssetTools } from './asset';
import { registerIndexerTransactionTools } from './transaction';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ResponseProcessor } from '../../../utils';
/**
 * Register all indexer API tools to the MCP server
 */
export function registerIndexerApiTools(server: McpServer,env: Env): void {
  registerIndexerAccountTools(server, env);
  registerIndexerApplicationTools(server, env);
  registerIndexerAssetTools(server, env);
  registerIndexerTransactionTools(server, env);
   // Algorand indexer search tool
  server.tool(
    'indexer_search',
    'Search the Algorand indexer for accounts, transactions, assets, or applications',
    {
      type: z.enum(['accounts', 'transactions', 'assets', 'applications']).describe('Type of entity to search'),
      query: z.record(z.any()).describe('Query parameters'),
      limit: z.number().int().min(1).max(1000).default(100).describe('Max number of results')
    },
    async ({ type, query, limit }) => {
      
      if (!env.ALGORAND_INDEXER) {
        return {
          content: [{
            type: 'text',
            text: 'Algorand indexer URL not configured'
          }]
        };
      }
      
      try {
        // Build the indexer URL
        const baseUrl = env.ALGORAND_INDEXER;
        let url = `${baseUrl}/v2/${type}`;
        
        // Add query parameters
        const queryParams = new URLSearchParams();
        Object.entries(query).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            queryParams.append(key, String(value));
          }
        });
        
        // Add limit parameter
        queryParams.append('limit', String(limit));
        
        // Append query string
        if (queryParams.toString()) {
          url += '?' + queryParams.toString();
        }
        
        // Make the request
        const response = await fetch(url, {
          headers: {
            'Content-Type': 'application/json'
          }
        });
        
        if (!response.ok) {
          throw new Error(`Indexer request failed with status: ${response.status}`);
        }
        
        const data = await response.json();
        return ResponseProcessor.processResponse(data);
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Indexer search error: ${error.message || 'Unknown error'}`
          }]
        };
      }
    }
  );
}
