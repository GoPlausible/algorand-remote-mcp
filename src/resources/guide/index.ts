/**
 * Skill Resource for Algorand Remote MCP
 * Provides access to comprehensive skill definition for using algorand-remote-mcp
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { skill } from '../../utils/Skill.js';
import { Env, Props } from '../../types';

/**
 * Register skill resource to the MCP server
 */
export function registerSkillResource(server: McpServer, env: Env, props: Props): void {
  // Main skill resource
  server.resource("Algorand MCP Skill", "algorand://remote-mcp-skill", (uri) => {
    return {
      contents: [{
        uri: uri.href,
        text: skill
      }]
    };
  });
}
