/**
 * Skill Resource for Algorand Remote MCP
 * Provides access to comprehensive skill definition for using algorand-remote-mcp
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env, Props } from "../../types";
import { skill } from "../../utils/Skill.js";

/**
 * Register skill resource to the MCP server
 */
export function registerSkillResource(server: McpServer, env: Env, props: Props): void {
	// Main skill resource
	server.resource("Algorand MCP Skill", "algorand://remote-mcp-skill", (uri) => {
		return {
			contents: [
				{
					uri: uri.href,
					text: skill,
				},
			],
		};
	});
}
