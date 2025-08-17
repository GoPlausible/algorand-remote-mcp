import type { AuthRequest, OAuthHelpers } from "./oauth-provider";
import { Hono } from "hono";
import getLogo from "./logoUrl.js";

import {
	clientIdAlreadyApproved,
	parseRedirectApproval,
	renderApprovalDialog,
	redirectToProvider,
	revokeUpstreamToken,
	fetchUpstreamAuthToken, type Props
} from "./workers-oauth-utils";

// Extend the Env type to include our OAuth configuration
interface OAuthEnv {
	OAUTH_PROVIDER: OAuthHelpers;
	COOKIE_ENCRYPTION_KEY: string;
	GOOGLE_CLIENT_ID: string;
	GOOGLE_CLIENT_SECRET: string;
	GITHUB_CLIENT_ID: string;
	GITHUB_CLIENT_SECRET: string;
	TWITTER_CLIENT_ID: string;
	TWITTER_CLIENT_SECRET: string;
	LINKEDIN_CLIENT_ID: string;
	LINKEDIN_CLIENT_SECRET: string;
	HOSTED_DOMAIN?: string;
}

const app = new Hono<{ Bindings: Env & OAuthEnv }>();

// Middleware to check if the request is authenticated
app.get("/authorize", async (c) => {
	console.log("Received OAuth authorization request");
	const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
	const { clientId } = oauthReqInfo;
	if (!clientId) {
		console.error("Invalid OAuth request: missing clientId");
		return c.text("Invalid request", 400);
	}
	console.log("Parsed OAuth request info:", oauthReqInfo);

	const { approved, provider } = await clientIdAlreadyApproved(
		c.req.raw,
		oauthReqInfo.clientId,
		c.env.COOKIE_ENCRYPTION_KEY || ''
	);

	if (approved && provider && provider !== '') {
		console.log(`Client ID ${clientId} already approved, redirecting to ${provider}`);
		return redirectToProvider(c, provider, oauthReqInfo);
	}
	console.log(`Client ID ${clientId} not approved yet, rendering approval dialog`);
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
		state: { oauthReqInfo },
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
	console.log(`Selected provider: ${provider}`);

	const { state, headers } = await parseRedirectApproval(clonedReq, c.env.COOKIE_ENCRYPTION_KEY || '');
	if (!state.oauthReqInfo) {
		console.error("Invalid state in OAuth approval request");
		return c.text("Invalid request", 400);
	}
	console.log("Processing OAuth approval request with state:", state.oauthReqInfo);

	return redirectToProvider(c, provider as string, state.oauthReqInfo, headers);
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
	console.log("Received OAuth callback request");
	const stateData = JSON.parse(atob(c.req.query("state") as string));
	const oauthReqInfo = stateData as AuthRequest;
	const provider = stateData.provider || "google";

	if (!oauthReqInfo.clientId) {
		return c.text("Invalid state", 400);
	}
	console.log(`OAuth callback received from ${provider} with state:`, oauthReqInfo);

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
		console.error(`Failed to fetch access token from ${provider}:`, errorResponse);
		return errorResponse;
	}
	console.log(`Successfully fetched access token from ${provider}`);

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
		console.error(`Failed to fetch user info from ${provider}:`, await userResponse.text());
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
			console.error("Failed to fetch LinkedIn email:", await emailResponse.text());
			email = "";
		}
	}
	else {
		// Google format
		const googleUser = userData as GoogleUser;
		id = googleUser.id;
		name = googleUser.name;
		email = googleUser.email;
	}

	console.log(`Successfully fetched user info from ${provider}: `, { id, name, email });

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
		} as Props,
		request: oauthReqInfo,
		scope: oauthReqInfo.scope,
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
	const revoke = 1
	const provider = url.searchParams.get("provider") || undefined;

	// Try to get access token from Authorization header or query param for convenience.
	const auth = c.req.header("authorization") || "";
	const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : undefined;
	const token = url.searchParams.get("token") || bearer || undefined;

	console.log("Logout request details:", {
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
		console.log("About to call revokeUpstreamToken with:", {
			provider,
			tokenLength: token.length,
			tokenFirstChars: token.substring(0, 5),
			tokenLastChars: token.substring(token.length - 5)
		});

		try {
			const ok = await revokeUpstreamToken(provider, token, c.env);
			console.log("Upstream revocation result:", ok ? "ok" : "failed");
		} catch (error) {
			console.error("Token revocation error:", error);
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
		}
	});
});

export { app as OauthHandler };
