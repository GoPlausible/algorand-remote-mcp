// The dOAuth login layer, shared by every server on the protocol's token store: doauth.org
// (client-worker, the master: doauth/client-worker/src), algorand-remote-mcp and
// algorand-remote-mcp-lite (synced copies, by doauth's scripts/sync-oauth-provider.mjs). Keep it free
// of anything specific to one server; per-server values live in oauth-server-info.ts.
import { type Context, Hono } from "hono";
import { type AuthRequest, AuthRequestError, type OAuthHelpers } from "./oauth-provider";
import { oauthServerInfo } from "./oauth-server-info";
import type { PendingLogins } from "./pending-logins";

import type { Env, Props } from "./types";
import {
	AUTHORIZE_COOKIE,
	AUTHORIZE_KEY_PREFIX,
	LEGACY_COOKIES,
	LOGIN_COOKIE,
	LOGIN_KEY_PREFIX,
	type PendingLogin,
	clearPendingCookie,
	fetchUpstreamAuthToken,
	generatePendingValue,
	isProvider,
	pendingCookie,
	redirectToProvider,
	renderApprovalDialog,
	revokeOwnSession,
	storePendingRecord,
	takePendingRecord,
} from "./workers-oauth-utils";

// Extend the Env type to include our OAuth configuration
interface OAuthEnv {
	PENDING_LOGINS: DurableObjectNamespace<PendingLogins>; // Pending login steps, one object each
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
	LINKEDIN_CLIENT_SECRET: string;
	HOSTED_DOMAIN?: string;
}

const app = new Hono<{ Bindings: Env & OAuthEnv }>();
type HandlerContext = Context<{ Bindings: Env & OAuthEnv }>;

const EXPIRED_LOGIN =
	"This login is invalid or has expired. Please start again from the application.";

/** For logs only: the first 6 characters of a user ID, enough to correlate lines without naming the user */
function shortId(id: unknown): string {
	return `${String(id ?? "").slice(0, 6)}…`;
}

/** Clears the cookies of the removed remembered-approval shortcut, if the browser still sends them */
function clearLegacyCookies(request: Request, headers: Headers): void {
	const cookieHeader = request.headers.get("Cookie") || "";
	for (const name of LEGACY_COOKIES) {
		if (cookieHeader.includes(`${name}=`)) {
			headers.append("Set-Cookie", `${name}=; Secure; Path=/; SameSite=Lax; Max-Age=0`);
		}
	}
}

/**
 * OAuth Authorization Endpoint (GET)
 *
 * Validates the request against the client's registration, keeps it on the server under a random
 * value, and renders the provider picker. The form carries only that value; a matching cookie
 * ties it to this browser.
 */
app.get("/authorize", async (c) => {
	console.log("[OAUTH_HANDLER] Received OAuth authorization request");

	let authReqInfo: AuthRequest;
	try {
		authReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
	} catch (error) {
		if (!(error instanceof AuthRequestError)) throw error;
		console.warn("[OAUTH_HANDLER] Rejected authorization request:", { error: error.error });
		// Shown here and never redirected: before login, a redirect would make this an open redirector
		return c.text(
			`Invalid authorization request: ${error.message} Please return to the application and try again.`,
			400,
		);
	}
	const clientId = authReqInfo.clientId;
	console.log("[OAUTH_HANDLER] Validated OAuth request for Client ID:", clientId);

	// Always show the provider picker: it is the only client-specific consent step. There is no
	// "remembered consent" shortcut; users always choose their provider (decision of 2026-11-07).
	const client = await c.env.OAUTH_PROVIDER.lookupClient(clientId);

	const requestId = generatePendingValue();
	await storePendingRecord(c.env.PENDING_LOGINS, AUTHORIZE_KEY_PREFIX, requestId, authReqInfo);

	const response = renderApprovalDialog(c.req.raw, {
		client,
		redirectUri: authReqInfo.redirectUri,
		scope: authReqInfo.scope,
		server: oauthServerInfo(),
		state: requestId,
	});
	// A cookie of this dialog's own: dialogs open in other tabs or apps keep theirs
	response.headers.append("Set-Cookie", await pendingCookie(AUTHORIZE_COOKIE, requestId));
	clearLegacyCookies(c.req.raw, response.headers);
	return response;
});

/**
 * OAuth Authorization Endpoint (POST): the user picked a provider in the dialog.
 *
 * Accepts only a form value that matches this browser's cookie and names a stored request, so a
 * form submitted from another site can't skip the dialog. Then sends the user to the provider.
 */
app.post("/authorize", async (c) => {
	const formData = await c.req.formData();
	const provider = formData.get("provider");
	console.log(`[OAUTH_HANDLER] Selected provider: ${provider}`);
	if (!isProvider(provider)) {
		return c.text("Invalid request: unknown provider", 400);
	}

	const requestId = formData.get("state");
	const authReqInfo = await takePendingRecord<AuthRequest>(
		c.env.PENDING_LOGINS,
		c.req.raw,
		AUTHORIZE_COOKIE,
		AUTHORIZE_KEY_PREFIX,
		requestId,
	);
	if (!authReqInfo) {
		console.warn(
			"[OAUTH_HANDLER] Rejected provider choice: no matching authorization request for this browser",
		);
		return c.text(EXPIRED_LOGIN, 400);
	}
	console.log(
		"[OAUTH_HANDLER] Processing OAuth approval request for Client ID:",
		authReqInfo.clientId,
	);

	// takePendingRecord accepted requestId, so it is a well-formed value; only its cookie is cleared
	const headers = new Headers();
	headers.append("Set-Cookie", await clearPendingCookie(AUTHORIZE_COOKIE, requestId as string));
	return redirectToProvider(c, provider, authReqInfo, headers);
});

/**
 * OAuth Callback Endpoint
 *
 * This route handles the callback from OAuth providers after user authentication.
 * The `state` must name a login this server started, in this browser (matching cookie), within
 * the last 10 minutes; the record is deleted on use. Then completeLogin exchanges the code and
 * finishes the authorization.
 */
app.get("/callback", async (c) => {
	console.log("[OAUTH_HANDLER] Received OAuth callback request");
	const state = c.req.query("state");
	const login = await takePendingRecord<PendingLogin>(
		c.env.PENDING_LOGINS,
		c.req.raw,
		LOGIN_COOKIE,
		LOGIN_KEY_PREFIX,
		state,
	);
	if (!login || !isProvider(login.provider)) {
		console.warn(
			"[OAUTH_HANDLER] Rejected callback: state unknown, expired, already used, or not from this browser",
		);
		return c.text(EXPIRED_LOGIN, 400);
	}

	// The login record is used up: whatever happens next, clear its cookie (only this login's;
	// takePendingRecord accepted state, so it is a well-formed value)
	let response: Response;
	try {
		response = await completeLogin(c, login);
	} catch (error) {
		console.error("[OAUTH_HANDLER] Error completing login:", { name: (error as Error)?.name });
		response = c.text("Login failed", 500);
	}
	const withCleared = new Response(response.body, response);
	withCleared.headers.append("Set-Cookie", await clearPendingCookie(LOGIN_COOKIE, state as string));
	return withCleared;
});

// Type the user data based on the provider
interface GitHubUser {
	id: number;
	login: string;
	name?: string;
	email?: string | null;
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
	sub: string;
	name: string;
	email?: string;
	email_verified?: boolean;
}

interface GoogleUser {
	id: string;
	name: string;
	email: string;
	verified_email?: boolean;
}

/**
 * Picks the GitHub address that may name an account: only addresses GitHub marks verified count.
 * The public address if it is verified, else the verified primary, else any verified address
 * (the same rule as doauth's gh-oidc-worker).
 * @returns The address, or "" when the account has no verified address
 */
export function pickVerifiedGitHubEmail(emails: unknown, publicEmail?: string | null): string {
	const verified = Array.isArray(emails)
		? (emails as GitHubEmail[]).filter((e) => e?.verified === true && !!e.email)
		: [];
	const pick =
		verified.find((e) => !!publicEmail && e.email === publicEmail) ??
		verified.find((e) => e.primary) ??
		verified[0];
	return pick?.email || "";
}

/**
 * Exchanges the provider's code for an access token, then stores some
 * user metadata & the auth token as part of the 'props' on the token passed
 * down to the client. It ends by redirecting the client back to _its_ callback URL
 */
async function completeLogin(c: HandlerContext, login: PendingLogin): Promise<Response> {
	const { provider, authReqInfo } = login;
	console.log(
		`[OAUTH_HANDLER] OAuth callback received from ${provider} for Client ID:`,
		authReqInfo.clientId,
	);

	// Exchange the code for an access token
	const code = c.req.query("code");
	if (!code) {
		return c.text("Missing code", 400);
	}

	// Configure provider-specific parameters
	let clientId = "";
	let clientSecret = "";
	let tokenUrl = "";
	let userInfoUrl = "";
	let redirectUri = "";
	switch (provider) {
		case "github":
			clientId = c.env.GITHUB_CLIENT_ID || "";
			clientSecret = c.env.GITHUB_CLIENT_SECRET || "";
			tokenUrl = "https://github.com/login/oauth/access_token";
			userInfoUrl = "https://api.github.com/user";
			// The same callback the authorization request used: this server's own /callback, which
			// must be registered in the GitHub OAuth app of this server
			redirectUri = new URL("/callback", c.req.url).href;
			break;
		case "twitter":
			clientId = c.env.TWITTER_CLIENT_ID || "";
			clientSecret = c.env.TWITTER_CLIENT_SECRET || "";
			tokenUrl = "https://api.x.com/2/oauth2/token";
			userInfoUrl = "https://api.x.com/2/users/me";
			// The verifier was stored with this login, so concurrent logins can't overwrite each other's
			if (!login.codeVerifier) {
				console.error("[OAUTH_HANDLER] Missing PKCE verifier in the X login record:", {
					clientId: authReqInfo.clientId,
				});
				return c.text("Twitter session expired or PKCE missing", 400);
			}
			redirectUri = new URL("/callback", c.req.url).href;
			break;
		case "linkedin":
			clientId = c.env.LINKEDIN_CLIENT_ID || "";
			clientSecret = c.env.LINKEDIN_CLIENT_SECRET || "";
			tokenUrl = "https://www.linkedin.com/oauth/v2/accessToken";
			userInfoUrl = "https://api.linkedin.com/v2/userinfo";
			redirectUri = new URL("/callback", c.req.url).href;
			break;
		case "google":
			clientId = c.env.GOOGLE_CLIENT_ID || "";
			clientSecret = c.env.GOOGLE_CLIENT_SECRET || "";
			tokenUrl = "https://accounts.google.com/o/oauth2/token";
			userInfoUrl = "https://www.googleapis.com/oauth2/v2/userinfo";
			redirectUri = new URL("/callback", c.req.url).href;
			break;
	}

	const [accessToken, errorResponse] = await fetchUpstreamAuthToken(c.env, {
		clientId,
		clientSecret,
		code,
		grantType: "authorization_code",
		redirectUri,
		upstreamUrl: tokenUrl,
		codeVerifier: provider === "twitter" ? login.codeVerifier : undefined,
	});

	if (errorResponse) {
		console.error(`[OAUTH_HANDLER] Failed to fetch access token from ${provider}`);
		return errorResponse;
	}
	console.log(`[OAUTH_HANDLER] Successfully fetched access token from ${provider}`);

	// Fetch the user info from the provider
	const headers: Record<string, string> = {
		Authorization: `Bearer ${accessToken}`,
	};

	// GitHub requires Accept header and User-Agent header for REST API
	if (provider === "github") {
		headers.Accept = "application/vnd.github.v3+json";
		headers["User-Agent"] = "goplausible-remote-mcp";
	} else if (provider === "twitter") {
		headers["Content-Type"] = "application/json";
	}

	const userResponse = await fetch(userInfoUrl, { headers });

	if (!userResponse.ok) {
		const resText = await userResponse.text();
		console.error(`[OAUTH_HANDLER] Failed to fetch user info from ${provider}: status ${userResponse.status}`);
		return c.text(`Failed to fetch user info: ${resText}`, 500);
	}

	const res = await userResponse.json();

	// Normalize user data based on provider
	let id: string;
	let name: string;
	let email: string;

	if (provider === "github") {
		const githubUser = res as GitHubUser;
		id = githubUser.id != null ? String(githubUser.id) : "";
		name = githubUser.name || githubUser.login;

		// Only an address GitHub marks verified may name an account, so /user/emails is always read,
		// even when /user has a public email. None leaves email empty, which the identity check
		// below rejects.
		email = "";
		const emailsResponse = await fetch("https://api.github.com/user/emails", {
			headers: {
				...headers,
				"User-Agent": "goplausible-remote-mcp", // Ensure User-Agent is set for this request too
			},
		});
		if (emailsResponse.ok) {
			email = pickVerifiedGitHubEmail(await emailsResponse.json(), githubUser.email);
		}
	} else if (provider === "twitter") {
		const twitterUser =
			res && typeof res === "object" && "data" in res
				? (res.data as TwitterUser)
				: ({} as TwitterUser);
		id = twitterUser.id || "";
		name = twitterUser.username;
		// Twitter API does not return email by default, so the X username names the account
		// in the vault-based account system
		email = twitterUser.username || "";
	} else if (provider === "linkedin") {
		const linkedInUser = res as LinkedInUser;
		id = linkedInUser.sub || "";
		name = linkedInUser.name;
		// A missing email used to become the literal string "undefined", shared by every such user
		email = linkedInUser.email_verified === false ? "" : linkedInUser.email || "";
	} else {
		// Google format
		const googleUser = res as GoogleUser;
		id = googleUser.id || "";
		name = googleUser.name;
		email = googleUser.verified_email === false ? "" : googleUser.email || "";
	}

	// The email (or X username) names the user's Vault account and the ID binds it, so both must be real
	if (!id || !email) {
		console.error(`[OAUTH_HANDLER] Rejected ${provider} login without a usable identity:`, {
			hasId: !!id,
			hasEmail: !!email,
		});
		return c.text(
			`Your ${provider} account has no verified email${provider === "twitter" ? " or username" : ""} that this server can use to identify you.`,
			400,
		);
	}

	console.log(`[OAUTH_HANDLER] Successfully fetched user info from ${provider}:`, {
		id: shortId(id),
		clientId: authReqInfo.clientId,
	});
	const scope = authReqInfo.scope;

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
			clientId: authReqInfo.clientId, // Client ID for OAuth
		} as Props,
		request: authReqInfo,
		scope,
		userId: id,
	});

	return Response.redirect(redirectTo, 302);
}

/**
 * Logout endpoint: revokes the caller's own session.
 *
 * Requires `Authorization: Bearer <access token>`. Who is logging out (user, client, provider)
 * comes from that validated token, never from query parameters. Then revokeOwnSession revokes
 * the upstream provider token and this user's grants for that client; client registrations are
 * never deleted.
 */
app.all("/logout", async (c) => {
	const invalidToken = (description: string) =>
		c.json({ error: "invalid_token", error_description: description }, 401, {
			"WWW-Authenticate": `Bearer realm="OAuth", error="invalid_token", error_description="${description}"`,
		});

	const authHeader = c.req.header("authorization") || "";
	const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
	if (!token) {
		return invalidToken("Missing bearer access token");
	}

	const session = await c.env.OAUTH_PROVIDER.unwrapToken(token);
	if (!session) {
		console.log("[OAUTH_HANDLER] Logout rejected: invalid or expired access token");
		return invalidToken("Invalid or expired access token");
	}

	const { userId, clientId } = session;
	const provider: string | undefined = session.props?.provider;
	console.log("[OAUTH_HANDLER] Logout request:", { userId: shortId(userId), clientId, provider });

	let revoked: number;
	try {
		revoked = await revokeOwnSession(c.env.OAUTH_PROVIDER, c.env, {
			userId,
			clientId,
			provider,
			upstreamToken: session.props?.accessToken,
		});
	} catch (error) {
		console.error("[OAUTH_HANDLER] Error revoking grants during logout:", error);
		return c.text("Logout failed", 500);
	}
	console.log("[OAUTH_HANDLER] Revoked grants:", { userId: shortId(userId), clientId, revoked });

	const headers = new Headers({ "Content-Type": "application/json" });
	// Each cookie needs its own Set-Cookie header
	for (const name of LEGACY_COOKIES) {
		headers.append("Set-Cookie", `${name}=; Secure; Path=/; SameSite=Lax; Max-Age=0`);
	}

	return new Response(
		JSON.stringify({
			success: true,
			message: "Successfully logged out",
			forceReauthentication: true,
		}),
		{ status: 200, headers },
	);
});

export { app as OauthHandler };
