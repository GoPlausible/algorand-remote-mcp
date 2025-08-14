import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { type Context, Hono } from "hono";
import { fetchUpstreamAuthToken, getUpstreamAuthorizeUrl, type Props } from "./utils/oauth-utils";
import {
	clientIdAlreadyApproved,
	parseRedirectApproval,
	renderApprovalDialog,
} from "./workers-oauth-utils";

const app = new Hono<{ Bindings: Env & { OAUTH_PROVIDER: OAuthHelpers } }>();

app.get("/authorize", async (c) => {
	console.log("Received OAuth authorization request");
	const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
	const { clientId } = oauthReqInfo;
	if (!clientId) {
		console.error("Invalid OAuth request: missing clientId");
		return c.text("Invalid request", 400);
	}
	console.log("Parsed OAuth request info:", oauthReqInfo);

	if (
		await clientIdAlreadyApproved(c.req.raw, oauthReqInfo.clientId, c.env.COOKIE_ENCRYPTION_KEY)
	) {
		console.log(`Client ID ${clientId} already approved, redirecting to Google`);
		return redirectToGoogle(c, oauthReqInfo);
	}
	console.log(`Client ID ${clientId} not approved yet, rendering approval dialog`);
	return renderApprovalDialog(c.req.raw, {
		client: await c.env.OAUTH_PROVIDER.lookupClient(clientId),
		server: {
			description: "Algorand MCP Remote Server OAuth for Google, by GoPlausible!",
			name: "GoPlausible Google OAuth",
		},
		state: { oauthReqInfo },
	});
});

app.post("/authorize", async (c) => {
	const { state, headers } = await parseRedirectApproval(c.req.raw, c.env.COOKIE_ENCRYPTION_KEY);
	if (!state.oauthReqInfo) {
		console.error("Invalid state in OAuth approval request");
		return c.text("Invalid request", 400);
	}
	console.log("Processing OAuth approval request with state:", state.oauthReqInfo);
	console.log("Redirect to Google");
	return redirectToGoogle(c, state.oauthReqInfo, headers);
});

async function redirectToGoogle(
	c: Context,
	oauthReqInfo: AuthRequest,
	headers: Record<string, string> = {},
) {
	console.log("Redirecting to Google for OAuth authorization");
	return new Response(null, {
		headers: {
			...headers,
			location: getUpstreamAuthorizeUrl({
				clientId: c.env.GOOGLE_CLIENT_ID,
				hostedDomain: c.env.HOSTED_DOMAIN,
				redirectUri: new URL("/callback", c.req.raw.url).href,
				scope: "email profile",
				state: btoa(JSON.stringify(oauthReqInfo)),
				upstreamUrl: "https://accounts.google.com/o/oauth2/v2/auth",
			}),
		},
		status: 302,
	});
}

/**
 * OAuth Callback Endpoint
 *
 * This route handles the callback from Google after user authentication.
 * It exchanges the temporary code for an access token, then stores some
 * user metadata & the auth token as part of the 'props' on the token passed
 * down to the client. It ends by redirecting the client back to _its_ callback URL
 */
app.get("/callback", async (c) => {
	// Get the oathReqInfo out of KV
	console.log("Received OAuth callback request");
	const oauthReqInfo = JSON.parse(atob(c.req.query("state") as string)) as AuthRequest;
	if (!oauthReqInfo.clientId) {
		return c.text("Invalid state", 400);
	}
	console.log("OAuth callback received with state:", oauthReqInfo);

	// Exchange the code for an access token
	const code = c.req.query("code");
	if (!code) {
		return c.text("Missing code", 400);
	}

	const [accessToken, googleErrResponse] = await fetchUpstreamAuthToken({
		clientId: c.env.GOOGLE_CLIENT_ID,
		clientSecret: c.env.GOOGLE_CLIENT_SECRET,
		code,
		grantType: "authorization_code",
		redirectUri: new URL("/callback", c.req.url).href,
		upstreamUrl: "https://accounts.google.com/o/oauth2/token",
	});
	if (googleErrResponse) {
		console.error("Failed to fetch access token from Google:", googleErrResponse);
		return googleErrResponse;
	}
	console.log("Successfully fetched access token from Google");

	// Fetch the user info from Google
	const userResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
		headers: {
			Authorization: `Bearer ${accessToken}`,
		},
	});
	if (!userResponse.ok) {
		console.error("Failed to fetch user info from Google:", await userResponse.text());
		return c.text(`Failed to fetch user info: ${await userResponse.text()}`, 500);
	}

	const { id, name, email } = (await userResponse.json()) as {
		id: string;
		name: string;
		email: string;
	};
	console.log("Successfully fetched user info from Google: ", { id, name, email });
	// Return back to the MCP client a new token
	const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
		metadata: {
			label: name,
		},
		props: {
			accessToken,
			email,
			name,
		} as Props,
		request: oauthReqInfo,
		scope: oauthReqInfo.scope,
		userId: id,
	});

	return Response.redirect(redirectTo);
});

export { app as OauthHandler };