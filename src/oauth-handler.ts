import type { AuthRequest, OAuthHelpers } from "./oauth-provider";
import { Hono } from "hono";
import getLogo from "./logoUrl.js";

import {
	clientIdAlreadyApproved,
	parseRedirectApproval,
	renderApprovalDialog,
	redirectToProvider,
	revokeUpstreamToken,
	fetchUpstreamAuthToken, 
} from "./workers-oauth-utils";
import {type Props, Env} from "./types";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";

// Extend the Env type to include our OAuth configuration
interface OAuthEnv {
	OAUTH_PROVIDER: OAuthHelpers;
	OAUTH_KV: KVNamespace; // KV namespace for OAuth client data
	COOKIE_ENCRYPTION_KEY: string;
	GOOGLE_CLIENT_ID: string;
	GOOGLE_CLIENT_SECRET: string;
	GITHUB_CLIENT_ID: string;
	GITHUB_CLIENT_SECRET: string;
	TWITTER_CLIENT_ID: string;
	TWITTER_CLIENT_SECRET: string;
	LINKEDIN_CLIENT_ID: string;
	OAUTH_KV_SESSIONS: KVNamespace; // KV namespace for OAuth sessions
	LINKEDIN_CLIENT_SECRET: string;
	HOSTED_DOMAIN?: string;
}

const app = new Hono<{ Bindings: Env & OAuthEnv }>();

// Middleware to check if the request is authenticated
app.get("/authorize", async (c) => {
	console.log("[OAUTH_HANDLER] Received OAuth authorization request");
	const clonedRequest = c.req.raw.clone();
	const url = new URL(clonedRequest.url);
	const responseType = url.searchParams.get('response_type') || '';
	const clientId = url.searchParams.get('client_id') || '';
	const redirectUri = url.searchParams.get('redirect_uri') || '';
	const scope = (url.searchParams.get('scope') || '').split(' ').filter(Boolean);
	const state = url.searchParams.get('state') || '';
	const codeChallenge = url.searchParams.get('code_challenge') || undefined;
	const codeChallengeMethod = url.searchParams.get('code_challenge_method') || 'plain';
	if (!clientId) {
		console.error("[OAUTH_HANDLER] Invalid OAuth request: missing clientId");
		return c.text("Invalid request", 400);
	}
	console.log("[OAUTH_HANDLER] Parsed OAuth request info for Client ID:", clientId);

	const { approved, provider } = await clientIdAlreadyApproved(
		c.req.raw,
		clientId,
		c.env.COOKIE_ENCRYPTION_KEY || ''
	);
	const authReqInfo: AuthRequest = {
		responseType,
		clientId,
		redirectUri,
		scope,
		state,
		codeChallenge,
		codeChallengeMethod,
	}
	if (approved && provider && provider !== '' && authReqInfo) {
		console.log(`[OAUTH_HANDLER] Client ID ${clientId} already approved, redirecting to ${provider}`);
		return redirectToProvider(c, provider, clientId, authReqInfo);
	}
	console.log(`[OAUTH_HANDLER] Client ID ${clientId} not approved yet, rendering approval dialog`);

	console.log("[OAUTH_HANDLER] Rendering approval dialog with auth request info:", authReqInfo);
	return renderApprovalDialog(c.req.raw, {
		client: await c.env.OAUTH_PROVIDER.lookupClient(clientId),
		server: {
			description: "Algorand MCP Remote Server Authentication using OAuth 2 protocol. Supports Google, GitHub, Twitter, and LinkedIn.",
			name: "Algorand Remote MCP OAuth",
			// Using the GoPlausible logo as a base64 data URL
			//    `base64 -i src/assets/goPlausible-logo-type-h.png | pbcopy` (on macOS)
			//    `base64 -w 0 src/assets/goPlausible-logo-type-h.png | xclip -selection clipboard` (on Linux)
			logo: getLogo()
		},

		state: { provider: provider, clientId: clientId, authReqInfo: authReqInfo as AuthRequest },
	});


});

/**
 * OAuth Authorization Endpoint
 *
 * This route handles the initial authorization request from the client.
 * It checks if the client ID is already approved and redirects to the
 * appropriate provider or renders the approval dialog.
 */
app.post("/authorize", async (c) => {
	const clonedReq = c.req.raw.clone();
	const formData = await c.req.formData();
	const provider = formData.get("provider");
	console.log(`[OAUTH_HANDLER] Selected provider: ${provider}`);

	const { state, headers } = await parseRedirectApproval(clonedReq, c.env.COOKIE_ENCRYPTION_KEY || '');
	
	console.log("[OAUTH_HANDLER] Parsed state from form submission:", state);
	const authReqInfo: AuthRequest = state.authReqInfo as AuthRequest;
	if (!state.clientId) {
		console.error("[OAUTH_HANDLER] Invalid state in OAuth approval request! No Client Id");
		return c.text("Invalid request", 400);
	}
	console.log("[OAUTH_HANDLER] Processing OAuth approval request with state:", state.clientId);

	return redirectToProvider(c, provider as string, state.clientId, authReqInfo, headers);
});

/**
 * OAuth Callback Endpoint
 *
 * This route handles the callback from OAuth providers after user authentication.
 * It exchanges the temporary code for an access token, then stores some
 * user metadata & the auth token as part of the 'props' on the token passed
 * down to the client. It ends by redirecting the client back to _its_ callback URL
 */
app.get("/callback", async (c) => {
	// Get the oathReqInfo out of KV
	console.log("[OAUTH_HANDLER] Received OAuth callback request");
	const stateData = JSON.parse(atob(c.req.query("state") as string));
	console.log("[OAUTH_HANDLER] Parsed state data from query:", stateData);

	const provider = stateData.provider;


	if (!provider || provider === '') {
		return c.text("Invalid state", 400);
	}
	console.log(`[OAUTH_HANDLER] OAuth callback received from ${provider} with provider:`, provider);

	// Exchange the code for an access token
	const code = c.req.query("code");
	if (!code) {
		return c.text("Missing code", 400);
	}

	// Configure provider-specific parameters
	let clientId = '';
	let clientSecret = '';
	let tokenUrl = '';
	let userInfoUrl = '';
	let redirectUri = '';

	switch (provider) {
		case "github":
			clientId = c.env.GITHUB_CLIENT_ID || '';
			clientSecret = c.env.GITHUB_CLIENT_SECRET || '';
			tokenUrl = "https://github.com/login/oauth/access_token";
			userInfoUrl = "https://api.github.com/user";
			// Use a fixed redirect URI for GitHub that matches what's registered in the GitHub OAuth application settings
			redirectUri = "https://algorandmcp.goplausible.xyz/callback";
			break;
		case "twitter":
			clientId = c.env.TWITTER_CLIENT_ID || '';
			clientSecret = c.env.TWITTER_CLIENT_SECRET || '';
			tokenUrl = "https://x.com/i/oauth2/token";
			userInfoUrl = "https://x.com/2/me";
			redirectUri = new URL("/callback", c.req.url).href;
			break;
		case "linkedin":
			clientId = c.env.LINKEDIN_CLIENT_ID || '';
			clientSecret = c.env.LINKEDIN_CLIENT_SECRET || '';
			tokenUrl = "https://www.linkedin.com/oauth/v2/accessToken";
			userInfoUrl = "https://api.linkedin.com/v2/me";
			redirectUri = new URL("/callback", c.req.url).href;
			break;
		case "google":
			clientId = c.env.GOOGLE_CLIENT_ID || '';
			clientSecret = c.env.GOOGLE_CLIENT_SECRET || '';
			tokenUrl = "https://accounts.google.com/o/oauth2/token";
			userInfoUrl = "https://www.googleapis.com/oauth2/v2/userinfo";
			redirectUri = new URL("/callback", c.req.url).href;
			break;

	}

	const [accessToken, errorResponse] = await fetchUpstreamAuthToken({
		clientId,
		clientSecret,
		code,
		grantType: "authorization_code",
		redirectUri,
		upstreamUrl: tokenUrl,
	});

	if (errorResponse) {
		console.error(`[OAUTH_HANDLER] Failed to fetch access token from ${provider}:`, errorResponse);
		return errorResponse;
	}
	console.log(`[OAUTH_HANDLER] Successfully fetched access token from ${provider}`);

	// Fetch the user info from the provider
	const headers: Record<string, string> = {
		Authorization: `Bearer ${accessToken}`,
	};

	// GitHub requires Accept header and User-Agent header for REST API
	if (provider === "github") {
		headers["Accept"] = "application/vnd.github.v3+json";
		headers["User-Agent"] = "goplausible-remote-mcp";
	} else if (provider === "twitter") {
		headers["Authorization"] = `Bearer ${accessToken}`;
	} else if (provider === "linkedin") {
		headers["Authorization"] = `Bearer ${accessToken}`;
		headers["X-Restli-Protocol-Version"] = "2.0.0";
	}

	const userResponse = await fetch(userInfoUrl, { headers });

	if (!userResponse.ok) {
		console.error(`[OAUTH_HANDLER] Failed to fetch user info from ${provider}:`, await userResponse.text());
		return c.text(`Failed to fetch user info: ${await userResponse.text()}`, 500);
	}

	// Type the user data based on the provider
	interface GitHubUser {
		id: number;
		login: string;
		name?: string;
		email?: string;
	}

	interface GitHubEmail {
		email: string;
		primary: boolean;
		verified: boolean;
	}
	interface TwitterUser {
		id: string;
		name: string;
		username: string;
	}
	interface LinkedInUser {
		id: string;
		firstName: {
			localized?: Record<string, string>;
		} | string;
		lastName: {
			localized?: Record<string, string>;
		} | string;
		emailAddress?: string;
	}

	interface GoogleUser {
		id: string;
		name: string;
		email: string;
	}

	// Parse the user data with the appropriate type
	const userData = provider === "github"
		? await userResponse.json() as GitHubUser
		: provider === "twitter"
			? await userResponse.json() as TwitterUser
			: provider === "linkedin"
				? await userResponse.json() as LinkedInUser
				: await userResponse.json() as GoogleUser


	// Normalize user data based on provider
	let id: string;
	let name: string;
	let email: string;

	if (provider === "github") {
		const githubUser = userData as GitHubUser;
		id = githubUser.id.toString();
		name = githubUser.name || githubUser.login;

		// If email is null or not present, we need to make an additional request
		if (!githubUser.email) {
			const emailsResponse = await fetch("https://api.github.com/user/emails", {
				headers: {
					...headers,
					"User-Agent": "goplausible-remote-mcp" // Ensure User-Agent is set for this request too
				}
			});
			if (emailsResponse.ok) {
				const emails = await emailsResponse.json() as GitHubEmail[];
				const primaryEmail = emails.find(e => e.primary);
				email = primaryEmail ? primaryEmail.email : emails[0]?.email || "";
			} else {
				email = "";
			}
		} else {
			email = githubUser.email;
		}
	} else if (provider === "twitter") {
		const twitterUser = userData as TwitterUser;
		id = twitterUser.id;
		name = twitterUser.username;
		// Twitter API does not return email by default, so we generate a synthetic email
		// using the Twitter username to ensure compatibility with the vault-based account system
		email = `${twitterUser.username}`;

	} else if (provider === "linkedin") {
		const linkedInUser = userData as LinkedInUser;
		id = linkedInUser.id;

		// LinkedIn API returns name in a nested structure
		let firstName = "";
		let lastName = "";

		// Handle the different possible response formats
		if (linkedInUser.firstName && typeof linkedInUser.firstName === 'object' && 'localized' in linkedInUser.firstName && linkedInUser.firstName.localized) {
			// New API format with localized names
			const locales = Object.keys(linkedInUser.firstName.localized);
			if (locales.length > 0) {
				firstName = linkedInUser.firstName.localized[locales[0]];
			}
		} else if (typeof linkedInUser.firstName === 'string') {
			// Simple string format
			firstName = linkedInUser.firstName;
		}

		if (linkedInUser.lastName && typeof linkedInUser.lastName === 'object' && 'localized' in linkedInUser.lastName && linkedInUser.lastName.localized) {
			// New API format with localized names
			const locales = Object.keys(linkedInUser.lastName.localized);
			if (locales.length > 0) {
				lastName = linkedInUser.lastName.localized[locales[0]];
			}
		} else if (typeof linkedInUser.lastName === 'string') {
			// Simple string format
			lastName = linkedInUser.lastName;
		}

		name = `${firstName} ${lastName}`.trim();

		// LinkedIn API doesn't return email in the basic profile
		const emailResponse = await fetch("https://api.linkedin.com/v2/emailAddress?q=members&projection=(elements*(handle~))", {
			headers: {
				"Authorization": `Bearer ${accessToken}`,
				"X-Restli-Protocol-Version": "2.0.0"
			}
		});

		if (emailResponse.ok) {
			const emailData = await emailResponse.json() as any;
			email = emailData.elements?.[0]?.["handle~"]?.emailAddress || "";
		} else {
			console.error("[OAUTH_HANDLER] Failed to fetch LinkedIn email:", await emailResponse.text());
			email = "";
		}
	} else {
		// Google format
		const googleUser = userData as GoogleUser;
		id = googleUser.id;
		name = googleUser.name;
		email = googleUser.email;
	}

	console.log(`[OAUTH_HANDLER] Successfully fetched user info from ${provider}: `, { id, name, clientId: stateData.clientId, email });
	const scope = stateData.authReqInfo.scope
	console.log(`[OAUTH_HANDLER] OAuth scope requested: ${scope}`);
	// Return back to the MCP client a new token
	const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
		metadata: {
			label: name,
			provider, // Store the provider in metadata
		},
		props: {
			accessToken,
			email,
			name,
			provider, // Store the provider in props
			id, // User ID
			clientId: stateData.clientId, // Client ID for OAuth
		} as Props,
		request: stateData.authReqInfo as AuthRequest,
		scope: scope,
		userId: id,
	});

	return Response.redirect(redirectTo);
});

/**
 * Logout endpoint to clear cookies and revoke tokens
 * This endpoint is used to log out the user from the OAuth provider
 */
app.all("/logout", async (c) => {
	const url = new URL(c.req.raw.url);
	const provider = url.searchParams.get("provider") || undefined;
	const clientId = url.searchParams.get("clientId") || undefined;
	const userId = url.searchParams.get("userId") || undefined;
	const email = url.searchParams.get("email") || undefined;

	if (!provider || !clientId || !userId || !email) {
		return c.text("Missing provider, clientId or userId", 400);
	}
	console.log("[OAUTH_HANDLER] Received logout request:", {
		provider,
		clientId,
		userId,
		email
	});
	await c.env.OAUTH_KV.delete(`client:${clientId}`);
	console.log("[OAUTH_HANDLER] Deleted client from OAUTH_KV:", clientId);
	// Delete all tokens for this user and client
	let tokenList = await c.env.OAUTH_KV.list({prefix: `token:${userId}:${clientId}`});
	for (const key of tokenList.keys) {
		console.log("[OAUTH_HANDLER] Deleting token key:", key.name);
		await c.env.OAUTH_KV.delete(key.name);
	}
	console.log("[OAUTH_HANDLER] Deleted tokens for user:", userId, "and client:", clientId);
	// Delete the client from OAUTH_KV
	console.log("[OAUTH_HANDLER] Deleted client from OAUTH_KV:", clientId);
	const grantsList = await c.env.OAUTH_KV.list({ prefix: `grant:${userId}` });
	if (!grantsList.keys || grantsList.keys.length === 0) {
		for (const key of grantsList.keys) {
			console.log("[OAUTH_HANDLER] Deleting grant key:", key.name);
			await c.env.OAUTH_KV.delete(key.name);
		}
		console.log("[OAUTH_HANDLER] All grants deleted for user:", userId);
	}

	// Try to get access token from Authorization header or query param for convenience.
	const auth = c.req.header("authorization") || "";
	const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : undefined;
	const token = url.searchParams.get("token") || bearer || undefined;

	console.log("[OAUTH_HANDLER] Logout request details:", {
		provider,
		hasToken: !!token,
		tokenType: token ? typeof token : 'undefined',
		tokenLength: token ? token.length : 0,
		tokenValue: token ? `${token.substring(0, 5)}...${token.substring(token.length - 5)}` : 'none',
		auth: !!auth,
		bearer: !!bearer
	});

	// Only attempt token revocation if we have both provider and token
	if (provider && token) {
		console.log("[OAUTH_HANDLER] About to call revokeUpstreamToken with:", {
			provider,
			tokenLength: token.length,
			tokenFirstChars: token.substring(0, 5),
			tokenLastChars: token.substring(token.length - 5)
		});

		try {
			const ok = await revokeUpstreamToken(provider, token, c.env);
			console.log("[OAUTH_HANDLER] Upstream revocation result:", ok ? "ok" : "failed");
		} catch (error) {
			console.error("[OAUTH_HANDLER] Token revocation error:", error);
		}
	} else {
		return c.text("No provider or no token specified", 400);
	}

	// Return a success response with all cookies cleared
	return new Response(JSON.stringify({
		success: true,
		message: "Successfully logged out",
		forceReauthentication: true
	}), {
		status: 200,
		headers: {
			"Content-Type": "application/json",
			// Clear OAuth-related cookies
			"Set-Cookie": [
				`mcp-approved-clients=; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=0`,
				`mcp-provider-preference=; Secure; Path=/; SameSite=Lax; Max-Age=0`
			].join(", ")
		}
	});
});

export { app as OauthHandler };
