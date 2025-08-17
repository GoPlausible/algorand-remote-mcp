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
			logo: getLogo()},
		state: { oauthReqInfo },
	});
});

app.post("/authorize", async (c) => {
	// Clone the request before passing it to parseRedirectApproval
	const clonedReq = c.req.raw.clone();

	// Get the selected provider from the form data first
	const formData = await c.req.formData();
	const provider = formData.get("provider");
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
	let redirectUri = '';

	switch (provider) {
		case "github":
			console.log("Redirecting to GitHub for OAuth authorization");
			clientId = c.env.GITHUB_CLIENT_ID || '';
			scope = "read:user user:email";
			upstreamUrl = "https://github.com/login/oauth/authorize";
			// Use a fixed redirect URI for GitHub that matches what's registered in the GitHub OAuth application settings
			redirectUri = new URL("/callback", c.req.raw.url).href;
			break;
		case "twitter":
			console.log("Redirecting to Twitter for OAuth authorization");
			clientId = c.env.TWITTER_CLIENT_ID || '';
			scope = "tweet.read users.read";
			upstreamUrl = "https://x.com/i/oauth2/authorize";
			redirectUri = new URL("/callback", c.req.raw.url).href;
			break;
		case "linkedin":
			console.log("Redirecting to LinkedIn for OAuth authorization");
			clientId = c.env.LINKEDIN_CLIENT_ID || '';
			scope = "r_liteprofile r_emailaddress";
			upstreamUrl = "https://www.linkedin.com/oauth/v2/authorization";
			redirectUri = new URL("/callback", c.req.raw.url).href;
			break;
		case "google":
		default:
			console.log("Redirecting to Google for OAuth authorization");
			clientId = c.env.GOOGLE_CLIENT_ID || '';
			scope = "email profile";
			upstreamUrl = "https://accounts.google.com/o/oauth2/v2/auth";
			hostedDomain = c.env.HOSTED_DOMAIN;
			redirectUri = new URL("/callback", c.req.raw.url).href;
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
				redirectUri,
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
		default:
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

		// GitHub doesn't always return email in the user profile
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
		// We need to make a separate request to get the email
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

async function revokeUpstreamToken(
  provider: string,
  token: string,
  env: any,

): Promise<boolean> {
  try {
    console.log(`Attempting to revoke token for provider: ${provider}, token length: ${token.length}`);
    
    switch (provider) {
      case "google": {
        console.log("Using Google revocation endpoint");
        try {
          const params = new URLSearchParams({ token });
          console.log(`Request params: ${params.toString()}`);
          
          const resp = await fetch("https://oauth2.googleapis.com/revoke", {
            method: "POST",
            headers: { 
              "Content-Type": "application/x-www-form-urlencoded"
            },
            body: params
          });
          
          const responseText = await resp.text();
          console.log(`Google revocation response: status=${resp.status}, body=${responseText}`);
          
          return resp.ok || resp.status === 200;
        } catch (error) {
          console.error("Error in Google token revocation:", error);
          return false;
        }
      }
      case "github": {
        // GitHub token revocation - use the correct endpoint for token revocation
        console.log("Using GitHub revocation endpoint");
        const basic = btoa(`${env.GITHUB_CLIENT_ID}:${env.GITHUB_CLIENT_SECRET}`);
        
        // Use the token endpoint directly instead of the grant endpoint
        const endpoint = `https://api.github.com/applications/${env.GITHUB_CLIENT_ID}/token`;
        const endpointGrant = `https://api.github.com/applications/${env.GITHUB_CLIENT_ID}/grant`;
        
        console.log(`GitHub endpoint: ${endpoint}`);
        
        try {
          const resp = await fetch(endpoint, {
            method: "DELETE",
            headers: {
              "Authorization": `Basic ${basic}`,
              "Accept": "application/vnd.github+json",
              "User-Agent": "goplausible-remote-mcp"
            },
            body: JSON.stringify({ access_token: token })
          });
          
          const responseText = await resp.text();
          console.log(`GitHub token revocation response: status=${resp.status}, body=${responseText}`);

		  ///////////

		  const respGrant = await fetch(endpointGrant, {
            method: "DELETE",
            headers: {
              "Authorization": `Basic ${basic}`,
              "Accept": "application/vnd.github+json",
              "User-Agent": "goplausible-remote-mcp"
            },
            body: JSON.stringify({ access_token: token })
          });
          
          const responseTextGrant = await respGrant.text();
          console.log(`GitHub grant revocation response: status=${respGrant.status}, body=${responseTextGrant}`);
          
          // GitHub returns 204 No Content for successful revocation
          return (resp.status === 204 || resp.status === 200 || resp.status === 404) &&
				 (respGrant.status === 204 || respGrant.status === 200 || respGrant.status === 404);
        } catch (error) {
          console.error("Error in GitHub token revocation:", error);
          return false;
        }
      }
      case "twitter": {
        // OAuth 2.0 token revocation (X)
        console.log("Using Twitter revocation endpoint");
        const basic = btoa(`${env.TWITTER_CLIENT_ID}:${env.TWITTER_CLIENT_SECRET}`);
        const body = new URLSearchParams({
          token,
          token_type_hint: "access_token",
          client_id: env.TWITTER_CLIENT_ID // harmless extra for some implementations
        });
        
        console.log(`Twitter request params: ${body.toString()}`);
        
        const resp = await fetch("https://api.x.com/2/oauth2/revoke", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": `Basic ${basic}`
          },
          body
        });
        
        const responseText = await resp.text();
        console.log(`Twitter revocation response: status=${resp.status}, body=${responseText}`);
        
        return resp.ok;
      }
      case "linkedin": {
        // LinkedIn OAuth 2.0 token revocation
        console.log("Using LinkedIn revocation endpoint");
        const params = new URLSearchParams({
          token,
          client_id: env.LINKEDIN_CLIENT_ID,
          client_secret: env.LINKEDIN_CLIENT_SECRET
        });
        
        console.log(`LinkedIn request params: ${params.toString()}`);
        
        const resp = await fetch("https://www.linkedin.com/oauth/v2/revoke", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params
        });
        
        const responseText = await resp.text();
        console.log(`LinkedIn revocation response: status=${resp.status}, body=${responseText}`);
        
        return resp.ok || resp.status === 200;
      }
      default:
        console.log(`Unknown provider: ${provider}`);
        return false;
    }
  } catch (e) {
    console.error("Token revocation error:", e);
    return false;
  }
}
// ---- /logout ----
// Clears approval cookie so /authorize shows provider picker again.
// Optionally revokes upstream token if the agent includes it.
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
    console.log("Skipping token revocation:", { 
      revoke: !!revoke, 
      provider: provider || "missing", 
      token: token ? "present" : "missing" 
    });
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
