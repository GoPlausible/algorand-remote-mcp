import type { AuthRequest, OAuthHelpers } from "./oauth-provider";
import { type Context, Hono } from "hono";
import getLogo from "./logoUrl.js";

import {
	clientIdAlreadyApproved,
	parseRedirectApproval,
	renderApprovalDialog,
	fetchUpstreamAuthToken, getUpstreamAuthorizeUrl, type Props
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

app.get("/authorize", async (c) => {
	console.log("Received OAuth authorization request");
	const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
	const { clientId } = oauthReqInfo;
	if (!clientId) {
		console.error("Invalid OAuth request: missing clientId");
		return c.text("Invalid request", 400);
	}
	console.log("Parsed OAuth request info:", oauthReqInfo);

	// Check if client is already approved and get provider preference
	const { approved, provider = "google" } = await clientIdAlreadyApproved(
		c.req.raw,
		oauthReqInfo.clientId,
		c.env.COOKIE_ENCRYPTION_KEY || ''
	);

	if (approved) {
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
			logo: getLogo()},
		state: { oauthReqInfo },
	});
});

app.post("/authorize", async (c) => {
	// Clone the request before passing it to parseRedirectApproval
	const clonedReq = c.req.raw.clone();

	// Get the selected provider from the form data first
	const formData = await c.req.formData();
	const provider = formData.get("provider") || "google";
	console.log(`Selected provider: ${provider}`);

	// Now parse the redirect approval using the cloned request
	const { state, headers } = await parseRedirectApproval(clonedReq, c.env.COOKIE_ENCRYPTION_KEY || '');
	if (!state.oauthReqInfo) {
		console.error("Invalid state in OAuth approval request");
		return c.text("Invalid request", 400);
	}
	console.log("Processing OAuth approval request with state:", state.oauthReqInfo);

	return redirectToProvider(c, provider as string, state.oauthReqInfo, headers);
});

async function redirectToProvider(
	c: Context,
	provider: string,
	oauthReqInfo: AuthRequest,
	headers: Record<string, string> = {},
) {
	// Configure provider-specific OAuth parameters
	let clientId = '';
	let scope = '';
	let upstreamUrl = '';
	let hostedDomain = undefined;

	switch (provider) {
		case "github":
			console.log("Redirecting to GitHub for OAuth authorization");
			clientId = c.env.GITHUB_CLIENT_ID || '';
			scope = "user:email";
			upstreamUrl = "https://github.com/login/oauth/authorize";
			break;
		case "twitter":
			console.log("Redirecting to Twitter for OAuth authorization");
			clientId = c.env.TWITTER_CLIENT_ID || '';
			scope = "tweet.read users.read";
			upstreamUrl = "https://x.com/i/oauth2/authorize";
			break;
		case "linkedin":
			console.log("Redirecting to LinkedIn for OAuth authorization");
			clientId = c.env.LINKEDIN_CLIENT_ID || '';
			scope = "r_liteprofile r_emailaddress";
			upstreamUrl = "https://www.linkedin.com/oauth/v2/authorization";
			break;
		case "google":
		default:
			console.log("Redirecting to Google for OAuth authorization");
			clientId = c.env.GOOGLE_CLIENT_ID || '';
			scope = "email profile";
			upstreamUrl = "https://accounts.google.com/o/oauth2/v2/auth";
			hostedDomain = c.env.HOSTED_DOMAIN;
			break;
	}

	// Store the provider in the state for use in the callback
	const stateWithProvider = {
		...oauthReqInfo,
		provider
	};

	return new Response(null, {
		headers: {
			...headers,
			location: getUpstreamAuthorizeUrl({
				clientId,
				hostedDomain,
				redirectUri: new URL("/callback", c.req.raw.url).href,
				scope,
				state: btoa(JSON.stringify(stateWithProvider)),
				upstreamUrl,
			}),
		},
		status: 302,
	});
}

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

	switch (provider) {
		case "github":
			clientId = c.env.GITHUB_CLIENT_ID || '';
			clientSecret = c.env.GITHUB_CLIENT_SECRET || '';
			tokenUrl = "https://github.com/login/oauth/access_token";
			userInfoUrl = "https://api.github.com/user";
			break;
		case "twitter":
			clientId = c.env.TWITTER_CLIENT_ID || '';
			clientSecret = c.env.TWITTER_CLIENT_SECRET || '';
			tokenUrl = "https://x.com/i/oauth2/token";
			userInfoUrl = "https://x.com/2/me";
			break;
		case "linkedin":
			clientId = c.env.LINKEDIN_CLIENT_ID || '';
			clientSecret = c.env.LINKEDIN_CLIENT_SECRET || '';
			tokenUrl = "https://www.linkedin.com/oauth/v2/accessToken";
			userInfoUrl = "https://api.linkedin.com/v2/me";
			break;
		case "google":
		default:
			clientId = c.env.GOOGLE_CLIENT_ID || '';
			clientSecret = c.env.GOOGLE_CLIENT_SECRET || '';
			tokenUrl = "https://accounts.google.com/o/oauth2/token";
			userInfoUrl = "https://www.googleapis.com/oauth2/v2/userinfo";
			break;
	}

	const [accessToken, errorResponse] = await fetchUpstreamAuthToken({
		clientId,
		clientSecret,
		code,
		grantType: "authorization_code",
		redirectUri: new URL("/callback", c.req.url).href,
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

	// GitHub requires Accept header for REST API
	if (provider === "github") {
		headers["Accept"] = "application/vnd.github.v3+json";
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
		firstName: string;
		lastName: string;
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

		// GitHub doesn't always return email in the user profile
		// If email is null or not present, we need to make an additional request
		if (!githubUser.email) {
			const emailsResponse = await fetch("https://api.github.com/user/emails", { headers });
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
		email = ""; // Twitter API does not return email by default

	} else if (provider === "linkedin") {
		const linkedInUser = userData as LinkedInUser;
		id = linkedInUser.id;
		name = `${linkedInUser.firstName} ${linkedInUser.lastName}`;
		email = linkedInUser.emailAddress || ""; // LinkedIn API may not return email by default
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

export { app as OauthHandler };
