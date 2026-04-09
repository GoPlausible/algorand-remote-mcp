import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
/**
 * Algod API Manager
 * Exports and registers all Algorand node API tools
 */
import type { Env } from "../../../types";
import { registerAccountApiTools } from "./account";
import { registerApplicationApiTools } from "./application";
import { registerAssetApiTools } from "./asset";
import { registerTransactionApiTools } from "./transaction";

/**
 * Register all Algorand node API tools to the MCP server
 */
export function registerAlgodApiTools(server: McpServer, env: Env): void {
	registerAccountApiTools(server, env);
	registerApplicationApiTools(server, env);
	registerAssetApiTools(server, env);
	registerTransactionApiTools(server, env);
}
