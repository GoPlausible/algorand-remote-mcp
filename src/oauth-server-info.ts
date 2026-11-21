import { getLogo } from "./logoUrl.js";

/**
 * How this server presents itself on the login picker. Per server: the shared login files
 * (oauth-handler.ts, workers-oauth-utils.ts, pending-logins.ts, synced from algorand-remote-mcp to
 * algorand-remote-mcp-lite by doauth's scripts/sync-oauth-provider.mjs) read it from here.
 */
export function oauthServerInfo(): { name: string; description: string; logo: string } {
	return {
		name: "Algorand Remote MCP OAuth",
		description:
			"Algorand MCP Remote Server Authentication using OAuth 2 protocol. Supports Google, GitHub, Twitter, and LinkedIn.",
		// The GoPlausible logo as a base64 data URL
		logo: getLogo(),
	};
}
