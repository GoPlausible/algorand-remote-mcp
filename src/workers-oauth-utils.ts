// Part of the dOAuth login layer: master in doauth/client-worker/src, synced unchanged into
// algorand-remote-mcp and algorand-remote-mcp-lite by doauth's scripts/sync-oauth-provider.mjs.
// workers-oauth-utils.ts

import type { Context } from "hono";
import type { AuthRequest, ClientInfo, OAuthHelpers } from "./oauth-provider";
import { COOKIE_PREFIX } from "./oauth-server-info";
import type { PendingLogins } from "./pending-logins";

/** What each sign-in provider is asked to share (the upstream scopes), shown on the picker too */
export const UPSTREAM_SCOPES: Record<Provider, string> = {
	google: "email profile",
	github: "read:user user:email",
	twitter: "tweet.read users.read",
	linkedin: "openid profile email",
};

const PROVIDER_LABELS: Record<Provider, string> = {
	google: "Google",
	github: "GitHub",
	twitter: "X",
	linkedin: "LinkedIn",
};

// --- Pending logins ---
//
// A login request never travels through the browser. Each step stores it in a PendingLogins
// Durable Object named by a random value, sends only that value onward, and sets a cookie
// holding the same value:
//   GET /authorize   stores `authorize:<value>`; the dialog form posts the value back.
//   POST /authorize  takes that record and stores `login:<value>` (with the X PKCE verifier);
//                    the value is the `state` sent to the provider.
//   GET /callback    takes the `login:` record.
// Taking a record requires the matching cookie and deletes the record, so each value works
// once, only in the browser that started the login, and only for 10 minutes
// (RFC 6749 §10.12, RFC 9700 §4.7.1). Ported from doauth's client-worker.
//
// Each pending record has a cookie of its own, named after its value (pendingCookieName), so
// logins started at the same time in several tabs or apps of one browser each keep theirs and
// none replaces another's. Each cookie lasts 10 minutes at most and is cleared when its record is
// used. A SameSite=Lax cookie can be set only by a same-site request or a top-level navigation to
// this host (RFC 6265bis §5.7, step 18), so no page elsewhere can fill a browser with them.

export const PROVIDERS = ["google", "github", "twitter", "linkedin"] as const;
export type Provider = (typeof PROVIDERS)[number];

export function isProvider(value: unknown): value is Provider {
	return typeof value === "string" && (PROVIDERS as readonly string[]).includes(value);
}

/** A login on its way to the provider and back, stored under `login:<state>` */
export interface PendingLogin {
	provider: Provider;
	authReqInfo: AuthRequest;
	/** X only: the PKCE verifier this server uses toward X */
	codeVerifier?: string;
}

export const LOGIN_TTL_SECONDS = 600;
export const AUTHORIZE_KEY_PREFIX = "authorize:";
export const LOGIN_KEY_PREFIX = "login:";
// The bases of the cookie names, one cookie per pending record: `<base>-<tag of its value>`.
// __Host-: Secure, Path=/ and no Domain, so no other host can set or overwrite it (RFC 6265bis §4.1.3.2)
export const AUTHORIZE_COOKIE = `__Host-${COOKIE_PREFIX}-authorize`;
export const LOGIN_COOKIE = `__Host-${COOKIE_PREFIX}-login`;

/** Cookies of the remembered-approval shortcut, removed on 2026-11-20; cleared wherever we can */
export const LEGACY_COOKIES = [
	`${COOKIE_PREFIX}-approved-clients`,
	`${COOKIE_PREFIX}-provider-preference`,
] as const;

/** 32 random bytes, base64url: always 43 characters */
const PENDING_VALUE = /^[A-Za-z0-9_-]{43}$/;

export function generatePendingValue(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return _b64url(bytes);
}

/**
 * The name of the cookie that ties the pending record `value` to this browser: the base, then the
 * first 16 characters of the value's SHA-256 (base64url), so the name gives nothing of the value away
 */
export async function pendingCookieName(base: string, value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return `${base}-${_b64url(new Uint8Array(digest)).slice(0, 16)}`;
}

/** HttpOnly, Secure, SameSite=Lax: sent on the provider's top-level redirect back, never readable by scripts */
export async function pendingCookie(base: string, value: string): Promise<string> {
	return `${await pendingCookieName(base, value)}=${value}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=${LOGIN_TTL_SECONDS}`;
}

/** Clears the cookie of the pending record `value` only, leaving the other logins' cookies alone */
export async function clearPendingCookie(base: string, value: string): Promise<string> {
	return `${await pendingCookieName(base, value)}=; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=0`;
}

function readCookie(cookieHeader: string | null, name: string): string | null {
	if (!cookieHeader) return null;
	for (const part of cookieHeader.split(";")) {
		const cookie = part.trim();
		if (cookie.startsWith(`${name}=`)) return cookie.slice(name.length + 1);
	}
	return null;
}

function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

function pendingObject(namespace: DurableObjectNamespace<PendingLogins>, name: string) {
	return namespace.get(namespace.idFromName(name));
}

/** Stores a pending record under `<keyPrefix><value>` for LOGIN_TTL_SECONDS */
export async function storePendingRecord(
	namespace: DurableObjectNamespace<PendingLogins>,
	keyPrefix: string,
	value: string,
	record: unknown,
): Promise<void> {
	await pendingObject(namespace, `${keyPrefix}${value}`).put(record, LOGIN_TTL_SECONDS);
}

/**
 * Takes the pending record that `value` names, if this browser holds the matching cookie,
 * and deletes it so the value can't be used again.
 * @param cookieBase - AUTHORIZE_COOKIE or LOGIN_COOKIE; the cookie's name is derived from `value`
 * @returns The record, or null if the value is malformed, the cookie is missing or different,
 *   or the record has expired or was already used.
 */
export async function takePendingRecord<T>(
	namespace: DurableObjectNamespace<PendingLogins>,
	request: Request,
	cookieBase: string,
	keyPrefix: string,
	value: unknown,
): Promise<T | null> {
	if (typeof value !== "string" || !PENDING_VALUE.test(value)) return null;
	const cookie = readCookie(
		request.headers.get("Cookie"),
		await pendingCookieName(cookieBase, value),
	);
	if (!cookie || !timingSafeEqual(cookie, value)) return null;

	return ((await pendingObject(namespace, `${keyPrefix}${value}`).take()) as T | null) ?? null;
}

// --- Helper Functions ---

function _b64url(u8: Uint8Array) {
	return btoa(String.fromCharCode(...u8))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}
export function generateCodeVerifier(): string {
	const bytes = new Uint8Array(64);
	crypto.getRandomValues(bytes);
	// 43..128 chars allowed; 64 is fine
	return _b64url(bytes).slice(0, 64);
}
export async function computeS256CodeChallenge(verifier: string): Promise<string> {
	const enc = new TextEncoder().encode(verifier);
	const hash = await crypto.subtle.digest("SHA-256", enc);
	return _b64url(new Uint8Array(hash));
}

/**
 * Configuration for the approval dialog
 */
export interface ApprovalDialogOptions {
	/**
	 * Client information to display in the approval dialog
	 */
	client: ClientInfo | null;
	/**
	 * The redirect URI this request will return to, already validated against the client's
	 * registration. Shown prominently: it is the one fact about the client this server can vouch for.
	 */
	redirectUri: string;
	/**
	 * The scopes the client asked for, shown to the user
	 */
	scope?: string[];
	/**
	 * Server information to display in the approval dialog
	 */
	server: {
		name: string;
		logo?: string;
		description?: string;
		/** The page icon: a URL or a data: URL */
		favicon?: string;
		/** What the client can do once the user continues, completing "If you continue, ..." */
		accessSummary: string;
		/** The name in the "Powered by" footer */
		poweredBy?: string;
	};
	/**
	 * Opaque value naming the pending authorization request on the server.
	 * The form posts it back; the request itself never goes to the browser.
	 */
	state: string;
}

/**
 * Renders an approval dialog for OAuth authorization
 * The dialog displays information about the client and server
 * and includes a form to submit approval
 *
 * @param request - The HTTP request
 * @param options - Configuration for the approval dialog
 * @returns A Response containing the HTML approval dialog
 */
export function renderApprovalDialog(request: Request, options: ApprovalDialogOptions): Response {
	const { client, server, state, redirectUri, scope = [] } = options;
	console.log("[WORKER_OAUTH_UTILS] Rendering approval dialog for client:", client?.clientId);

	const encodedState = sanitizeHtml(state);

	// Sanitize any untrusted content
	const serverName = sanitizeHtml(server.name);
	const clientName = client?.clientName
		? sanitizeHtml(client.clientName)
		: "An unnamed application";
	const serverDescription = server.description ? sanitizeHtml(server.description) : "";
	const favicon = server.favicon ? sanitizeHtml(server.favicon) : "";
	const accessSummary = sanitizeHtml(server.accessSummary);
	const poweredBy = sanitizeHtml(server.poweredBy || "Algorand");

	// Where the user will be sent: the origin for web addresses, the whole URI for app schemes
	const returnTo = sanitizeHtml(displayDestination(redirectUri));

	// Safe URLs
	const logoUrl = server.logo ? sanitizeHtml(server.logo) : "";
	// The client's own pages, as it registered them, and only as http(s) links: a registered
	// `javascript:` URL would otherwise run script on this origin when clicked
	const clientUri = webUrl(client?.clientUri);
	const policyUri = webUrl(client?.policyUri);
	const tosUri = webUrl(client?.tosUri);

	// Client contacts
	const contacts =
		client?.contacts && client.contacts.length > 0
			? sanitizeHtml(client.contacts.join(", "))
			: "";

	// Get redirect URIs
	const redirectUris =
		client?.redirectUris && client.redirectUris.length > 0
			? client.redirectUris.map((uri) => sanitizeHtml(uri))
			: [];

	// Generate HTML for the approval dialog
	const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title> GoPlausible OAuth Authorization Request | ${clientName}  </title>
        <link rel="icon" href="${favicon}" />
        <style>
          /* Modern, responsive styling with system fonts */
          :root {
            --primary-color: #0070f3;
            --error-color: #f44336;
            --border-color: #e5e7eb;
            --text-color: #333;
            --background-color: #fff;
            --card-shadow: 0 8px 36px 8px rgba(0, 0, 0, 0.1);
          }
          
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, 
                         Helvetica, Arial, sans-serif, "Apple Color Emoji", 
                         "Segoe UI Emoji", "Segoe UI Symbol";
            line-height: 1.6;
            color: var(--text-color);
            background-color: #f9fafb;
            margin: 0;
            padding: 0;
          }
          
          .container {
            max-width: 600px;
            margin: 2rem auto;
            padding: 1rem;
          }
          
          .precard {
            padding: 2rem;
            text-align: center;
          }
          
          .card {
            background-color: var(--background-color);
            border-radius: 8px;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
            padding: 2rem;
            border: 1px solid #e0e0e0;
          }
          
          .header {
            text-align: center;
            margin-bottom: 1.5rem;
          }
          
          .logo {
            width: 200px;
            height: auto;
            margin: 0 auto 1.5rem;
            display: block;
            object-fit: contain;
          }
          
          .title {
            margin: 0;
            font-size: 1.3rem;
            font-weight: 400;
          }
          
          .alert {
            margin: 0;
            font-size: 1.5rem;
            font-weight: 400;
            margin: 1rem 0;
            text-align: center;
          }
          
          .description {
            color: #555;
          }
          
          .server-links {
            margin-top: 1rem;
            font-size: 0.9rem;
          }
          
          .server-links a {
            color: var(--primary-color);
            text-decoration: none;
          }
          
          .server-links a:hover {
            text-decoration: underline;
          }

          .notice {
            margin: -0.5rem 0 1rem;
            font-size: 0.9rem;
            color: #6b7280;
            text-align: center;
          }

          .destination {
            margin: 0 0 1.25rem;
            padding: 0.75rem 1rem;
            border-radius: 8px;
            background-color: #eff6ff;
            border: 1px solid #bfdbfe;
            word-break: break-all;
          }
          
          .client-info {
            border: 1px solid #d0d0d0;
            border-radius: 8px;
            padding: 1.25rem 1.25rem 0.75rem;
            margin-bottom: 2rem;
            background-color: #fafafa;
            box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05);
          }
          
          .client-name {
            font-weight: 600;
            font-size: 1.2rem;
            margin: 0 0 0.5rem 0;
          }
          
          .client-detail {
            display: flex;
            margin-bottom: 0.5rem;
            align-items: baseline;
          }
          
          .detail-label {
            font-weight: 500;
            min-width: 120px;
          }
          
          .detail-value {
            font-family: SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
            word-break: break-all;
          }
          
          .detail-value a {
            color: inherit;
            text-decoration: underline;
          }
          
          .detail-value.small {
            font-size: 0.8em;
          }
          
          .external-link-icon {
            font-size: 0.75em;
            margin-left: 0.25rem;
            vertical-align: super;
          }
          
          .actions {
            display: flex;
            justify-content: flex-end;
            gap: 1rem;
            margin-top: 2rem;
          }
          
          .button {
            padding: 0.9rem 1.75rem;
            border-radius: 8px;
            font-weight: 500;
            cursor: pointer;
            border: none;
            font-size: 1rem;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
            transition: all 0.2s ease;
          }
          
          .button:hover {
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
            transform: translateY(-1px);
          }
          
          .button-primary {
            background-color: var(--primary-color);
            color: white;
          }
          
          .button-secondary {
            background-color: #f5f5f5;
            border: 1px solid #d0d0d0;
            color: var(--text-color);
          }
          
          .button-secondary:hover {
            background-color: #ebebeb;
          }
          
          .auth-providers {
            display: flex;
            flex-direction: column;
            gap: 1rem;
            margin: 1.5rem 0 2rem;
            padding: 1.25rem;
            background-color: #f8f9fa;
            border-radius: 10px;
            border: 1px solid #e0e0e0;
          }
          
          .provider-button {
            display: flex;
            align-items: center;
            padding: 1rem 1.25rem;
            border-radius: 8px;
            border: 1px solid #d0d0d0;
            background-color: white;
            cursor: pointer;
            transition: all 0.2s ease;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
            margin-bottom: 0.5rem;
            font-weight: 500;
          }
          
          .provider-button:hover {
            background-color: #f9fafb;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
            transform: translateY(-1px);
          }
          
          .provider-button.disabled {
            opacity: 0.7;
            cursor: not-allowed;
            position: relative;
            background-color: #f9f9f9;
          }
          
          .provider-button.disabled:hover {
            background-color: #f9f9f9;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
            transform: none;
          }
          
          .coming-soon {
            position: absolute;
            right: 1rem;
            font-size: 0.7rem;
            background-color: #f0f0f0;
            padding: 0.2rem 0.4rem;
            border-radius: 4px;
            color: #666;
          }
          
          .provider-logo {
            width: 28px;
            height: 28px;
            margin-right: 1.25rem;
            object-fit: contain;
          }
          
          .powered-by {
            text-align: center;
            margin-top: 1.5rem;
            font-size: 0.8rem;
            color: #666;
          }
          
          .powered-by a {
            color: var(--primary-color);
            text-decoration: none;
          }
          
          .powered-by a:hover {
            text-decoration: underline;
          }
          
          /* Responsive adjustments */
          @media (max-width: 640px) {
            .auth-providers {
              gap: 0.75rem;
            }
            
            .provider-button {
              padding: 0.6rem 0.75rem;
            }
            
            .provider-logo {
              width: 20px;
              height: 20px;
              margin-right: 0.75rem;
            }
            
            .container {
              margin: 1rem auto;
              padding: 0.5rem;
            }
            
            .card {
              padding: 1.5rem;
            }
            
            .client-detail {
              flex-direction: column;
            }
            
            .detail-label {
              min-width: unset;
              margin-bottom: 0.25rem;
            }
            
            .actions {
              flex-direction: column;
            }
            
            .button {
              width: 100%;
            }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="precard">
            <div class="header">
              ${logoUrl ? `<img src="${logoUrl}" alt="${serverName} Logo" class="logo">` : ""}
              <h1 class="title"><strong>${serverName}</strong></h1>
            </div>
            
            ${serverDescription ? `<p class="description">${serverDescription}</p>` : ""}
            <div class="server-links">
              <a href="https://goplausible.xyz/terms" target="_blank" rel="noopener noreferrer">Terms of Service</a> | 
              <a href="https://goplausible.xyz/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
            </div>
          </div>
            
          <div class="card">
            
            <h2 class="alert"><strong>${clientName}</strong> is requesting access</h2>
            <p class="notice">The application chose this name itself; ${serverName} has not verified it.</p>
            <p class="destination">After you log in, you will be sent to <strong>${returnTo}</strong></p>
            
            <div class="client-info">
              <div class="client-detail">
                <div class="detail-label">Name:</div>
                <div class="detail-value">
                  ${clientName}
                </div>
              </div>
              
              ${
					clientUri
						? `
                <div class="client-detail">
                  <div class="detail-label">Website:</div>
                  <div class="detail-value small">
                    <a href="${clientUri}" target="_blank" rel="noopener noreferrer">
                      ${clientUri}
                    </a>
                  </div>
                </div>
              `
						: ""
				}
              
              ${
					policyUri
						? `
                <div class="client-detail">
                  <div class="detail-label">Privacy Policy:</div>
                  <div class="detail-value">
                    <a href="${policyUri}" target="_blank" rel="noopener noreferrer">
                      ${policyUri}
                    </a>
                  </div>
                </div>
              `
						: ""
				}
              
              ${
					tosUri
						? `
                <div class="client-detail">
                  <div class="detail-label">Terms of Service:</div>
                  <div class="detail-value">
                    <a href="${tosUri}" target="_blank" rel="noopener noreferrer">
                      ${tosUri}
                    </a>
                  </div>
                </div>
              `
						: ""
				}
              
              ${
					redirectUris.length > 0
						? `
                <div class="client-detail">
                  <div class="detail-label">Redirect URIs:</div>
                  <div class="detail-value small">
                    ${redirectUris.map((uri) => `<div>${uri}</div>`).join("")}
                  </div>
                </div>
              `
						: ""
				}
              
              ${
					contacts
						? `
                <div class="client-detail">
                  <div class="detail-label">Contact:</div>
                  <div class="detail-value">${contacts}</div>
                </div>
              `
						: ""
				}

              <div class="client-detail">
                <div class="detail-label">Requested scopes:</div>
                <div class="detail-value small">
                  ${scope.length > 0 ? scope.map((s) => `<div>${sanitizeHtml(s)}</div>`).join("") : "None specified"}
                </div>
              </div>
            </div>

            <p>If you continue, ${accessSummary}</p>

            <div class="client-info">
              <div class="client-detail">
                <div class="detail-label">Your sign-in provider shares:</div>
                <div class="detail-value small">
                  ${PROVIDERS.map((p) => `<div>${PROVIDER_LABELS[p]}: ${sanitizeHtml(UPSTREAM_SCOPES[p])}</div>`).join("")}
                </div>
              </div>
            </div>
            
            <p>Continue only if you trust ${returnTo}. Choose a provider to log in:</p>

            <form method="post" action="${new URL(request.url).pathname}">
              <input type="hidden" name="state" value="${encodedState}">
              
              <div class="auth-providers">
                <button type="submit" class="provider-button" style="background-color: #ffffff; border-color: #e1e4e8; color: #24292e; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);" name="provider" value="google">
                  <img src="https://www.gstatic.com/marketing-cms/assets/images/d5/dc/cfe9ce8b4425b410b49b7f2dd3f3/g.webp" alt="Google Logo" class="provider-logo">
                  <span>Continue with Google</span>
                </button>
                
                <button type="submit" class="provider-button" style="background-color: #ffffff; border-color: #e1e4e8; color: #24292e; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);" name="provider" value="github">
                  <img src="https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png" alt="GitHub Logo" class="provider-logo">
                  <span>Continue with GitHub</span>
                </button>
                
           
                
                <button type="submit" class="provider-button" style="background-color: #ffffff; border-color: #e1e4e8; color: #24292e; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);" name="provider" value="linkedin">
                  <img src="https://content.linkedin.com/content/dam/me/business/en-us/amp/brand-site/v2/bg/LI-Bug.svg.original.svg" alt="LinkedIn Logo" class="provider-logo">
                  <span>Continue with LinkedIn</span>
                </button>

                <button type="submit" class="provider-button" style="background-color: #ffffff; border-color: #e1e4e8; color: #24292e; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);" name="provider" value="twitter">
                  <img src="https://about.x.com/content/dam/about-twitter/x/brand-toolkit/logo-black.png.twimg.1920.png" alt="X Logo" class="provider-logo">
                  <span>Continue with X</span>
                </button>

              </div>
              
              <div class="actions">
                <button type="button" class="button button-secondary" onclick="window.history.back()">Cancel</button>
              </div>
            </form>
          </div>
          <div class="powered-by">
            Powered by <a href="https://algorand.co" target="_blank" rel="noopener noreferrer">${poweredBy}</a>
          </div>
        </div>
      </body>
    </html>
  `;
	/* 
  // Removed because Twitter X has suspended @GoPlausible account based on afalse flag from their automated systems. Appeal sent but till that time the button is commented!


  */
	return new Response(htmlContent, {
		headers: {
			"Content-Type": "text/html; charset=utf-8",
			// The page names one pending login: never cache it
			"Cache-Control": "no-store",
			// No framing, so the provider buttons can't be clickjacked (RFC 9700 §4.16)
			"Content-Security-Policy": "frame-ancestors 'none'",
			"X-Frame-Options": "DENY",
		},
	});
}

export async function revokeUpstreamToken(
	provider: string,
	token: string,
	env: any,
): Promise<boolean> {
	try {
		console.log(
			`[WORKER_OAUTH_UTILS] Attempting to revoke token for provider: ${provider}, token length: ${token.length}`,
		);

		switch (provider) {
			case "google": {
				console.log("[WORKER_OAUTH_UTILS] Using Google revocation endpoint");
				try {
					const params = new URLSearchParams({ token });

					const resp = await fetch("https://oauth2.googleapis.com/revoke", {
						method: "POST",
						headers: {
							"Content-Type": "application/x-www-form-urlencoded",
						},
						body: params,
					});

					const responseText = await resp.text();
					console.log(
						`[WORKER_OAUTH_UTILS] Google revocation response: status=${resp.status}, body=${responseText}`,
					);

					return resp.ok || resp.status === 200;
				} catch (error) {
					console.error("[WORKER_OAUTH_UTILS] Error in Google token revocation:", error);
					return false;
				}
			}
			case "github": {
				// GitHub token revocation - use the correct endpoint for token revocation
				console.log("[WORKER_OAUTH_UTILS] Using GitHub revocation endpoint");
				const basic = btoa(`${env.GITHUB_CLIENT_ID}:${env.GITHUB_CLIENT_SECRET}`);

				// Use the token endpoint directly instead of the grant endpoint
				const endpoint = `https://api.github.com/applications/${env.GITHUB_CLIENT_ID}/token`;
				const endpointGrant = `https://api.github.com/applications/${env.GITHUB_CLIENT_ID}/grant`;

				console.log(`[WORKER_OAUTH_UTILS] GitHub endpoint: ${endpoint}`);

				try {
					const resp = await fetch(endpoint, {
						method: "DELETE",
						headers: {
							Authorization: `Basic ${basic}`,
							Accept: "application/vnd.github+json",
							"User-Agent": "goplausible-remote-mcp",
						},
						body: JSON.stringify({ access_token: token }),
					});

					const responseText = await resp.text();
					console.log(
						`[WORKER_OAUTH_UTILS] GitHub token revocation response: status=${resp.status}, body=${responseText}`,
					);

					///////////

					const respGrant = await fetch(endpointGrant, {
						method: "DELETE",
						headers: {
							Authorization: `Basic ${basic}`,
							Accept: "application/vnd.github+json",
							"User-Agent": "goplausible-remote-mcp",
						},
						body: JSON.stringify({ access_token: token }),
					});

					const responseTextGrant = await respGrant.text();
					console.log(
						`[WORKER_OAUTH_UTILS] GitHub grant revocation response: status=${respGrant.status}, body=${responseTextGrant}`,
					);

					// GitHub returns 204 No Content for successful revocation
					return (
						(resp.status === 204 || resp.status === 200 || resp.status === 404) &&
						(respGrant.status === 204 ||
							respGrant.status === 200 ||
							respGrant.status === 404)
					);
				} catch (error) {
					console.error("[WORKER_OAUTH_UTILS] Error in GitHub token revocation:", error);
					return false;
				}
			}
			case "twitter": {
				// OAuth 2.0 token revocation (X)
				console.log("[WORKER_OAUTH_UTILS] Using Twitter revocation endpoint");
				const basic = btoa(`${env.TWITTER_CLIENT_ID}:${env.TWITTER_CLIENT_SECRET}`);
				const body = new URLSearchParams({
					token,
					token_type_hint: "access_token",
					client_id: env.TWITTER_CLIENT_ID, // harmless extra for some implementations
				});

				const resp = await fetch("https://api.x.com/2/oauth2/revoke", {
					method: "POST",
					headers: {
						"Content-Type": "application/x-www-form-urlencoded",
						Authorization: `Basic ${basic}`,
					},
					body,
				});

				const responseText = await resp.text();
				console.log(
					`[WORKER_OAUTH_UTILS] Twitter revocation response: status=${resp.status}, body=${responseText}`,
				);

				return resp.ok;
			}
			case "linkedin": {
				// LinkedIn OAuth 2.0 token revocation
				console.log("[WORKER_OAUTH_UTILS] Using LinkedIn revocation endpoint");
				const params = new URLSearchParams({
					token,
					client_id: env.LINKEDIN_CLIENT_ID,
					client_secret: env.LINKEDIN_CLIENT_SECRET,
				});

				const resp = await fetch("https://www.linkedin.com/oauth/v2/revoke", {
					method: "POST",
					headers: { "Content-Type": "application/x-www-form-urlencoded" },
					body: params,
				});

				const responseText = await resp.text();
				console.log(
					`[WORKER_OAUTH_UTILS] LinkedIn revocation response: status=${resp.status}, body=${responseText}`,
				);

				return resp.ok || resp.status === 200;
			}
			default:
				console.log(`[WORKER_OAUTH_UTILS] Unknown provider: ${provider}`);
				return false;
		}
	} catch (e) {
		console.error("[WORKER_OAUTH_UTILS] Token revocation error:", e);
		return false;
	}
}
/** The session to end: whose it is and which client it was issued to, from a validated token */
export interface OwnSession {
	userId: string;
	clientId: string;
	provider?: string;
	/** The upstream provider's access token, kept in the grant's props */
	upstreamToken?: string;
}

/**
 * Ends one user's session with one client, for /logout and the wallet_logout tool: a best-effort
 * revocation of the upstream provider token, then every grant (with its tokens) this user holds
 * for this client. Client registrations are never touched: all users of a client share them, on
 * every dOAuth server.
 * @param helpers - Grant listing and revocation (env.OAUTH_PROVIDER, or grantHelpers(env))
 * @returns How many grants were revoked
 */
export async function revokeOwnSession(
	helpers: Pick<OAuthHelpers, "listUserGrants" | "revokeGrant">,
	env: any,
	session: OwnSession,
): Promise<number> {
	const { userId, clientId, provider, upstreamToken } = session;

	// Upstream first: the provider token lives in the grant's props, which are gone once the grant is revoked
	if (provider && upstreamToken) {
		try {
			const ok = await revokeUpstreamToken(provider, upstreamToken, env);
			console.log("[WORKER_OAUTH_UTILS] Upstream revocation result:", ok ? "ok" : "failed");
		} catch (error) {
			console.error("[WORKER_OAUTH_UTILS] Upstream token revocation error:", error);
		}
	}

	// listUserGrants lists `grant:<userId>:`, with the colon, so a shorter ID matches no other user
	let revoked = 0;
	let cursor: string | undefined;
	do {
		const page = await helpers.listUserGrants(userId, { cursor });
		for (const grant of page.items) {
			// The grant key's userId is the bare provider ID, so a GitHub user and an X user with the
			// same numeric ID share the prefix. Revoke only grants from the caller's own provider
			// (a grant with no recorded provider is revoked).
			const grantProvider: string | undefined = grant.metadata?.provider;
			const sameProvider = !grantProvider || !provider || grantProvider === provider;
			if (grant.clientId === clientId && sameProvider) {
				await helpers.revokeGrant(grant.id, userId);
				revoked++;
			}
		}
		cursor = page.cursor;
	} while (cursor);
	return revoked;
}

/**
 * Sends the user to the chosen provider.
 *
 * Stores the validated request under a fresh random value (`login:<value>`, 10 minutes, in a
 * PendingLogins Durable Object), sends only that value to the provider as `state`, and sets the
 * matching browser-binding cookie.
 *
 * @param provider - The provider the user picked
 * @param authReqInfo - The authorization request, already validated by parseAuthRequest
 * @param headers - Extra response headers, such as a cookie to clear
 */
export async function redirectToProvider(
	c: Context,
	provider: Provider,
	authReqInfo: AuthRequest,
	headers: Headers = new Headers(),
) {
	// Configure provider-specific OAuth parameters
	let upstreamClientId = "";
	let scope = "";
	let upstreamUrl = "";
	let hostedDomain = undefined;
	let redirectUri = "";
	let codeVerifier: string | undefined;
	let codeChallengeParam: string | undefined;
	let codeChallengeMethod: string | undefined;
	let redirectUriOverride: string | undefined;
	switch (provider) {
		case "github":
			console.log("[WORKER_OAUTH_UTILS] Redirecting to GitHub for OAuth authorization");
			upstreamClientId = c.env.GITHUB_CLIENT_ID || "";
			scope = UPSTREAM_SCOPES.github;
			upstreamUrl = "https://github.com/login/oauth/authorize";
			redirectUri = new URL("/callback", c.req.raw.url).href;
			break;
		case "twitter":
			console.log("[WORKER_OAUTH_UTILS] Redirecting to Twitter for OAuth authorization");
			upstreamClientId = c.env.TWITTER_CLIENT_ID || "";
			scope = UPSTREAM_SCOPES.twitter;
			upstreamUrl = "https://x.com/i/oauth2/authorize";
			redirectUri = new URL("/callback", c.req.raw.url).href;
			redirectUriOverride = c.env.BASE_URL
				? new URL("/callback", c.env.BASE_URL).href
				: undefined;
			// One verifier per login, kept in that login's record
			codeVerifier = generateCodeVerifier();
			codeChallengeParam = await computeS256CodeChallenge(codeVerifier);
			codeChallengeMethod = "S256";
			break;
		case "linkedin":
			console.log("[WORKER_OAUTH_UTILS] Redirecting to LinkedIn for OAuth authorization");
			upstreamClientId = c.env.LINKEDIN_CLIENT_ID || "";
			scope = UPSTREAM_SCOPES.linkedin;
			upstreamUrl = "https://www.linkedin.com/oauth/v2/authorization";
			redirectUri = new URL("/callback", c.req.raw.url).href;
			break;
		case "google":
			console.log("[WORKER_OAUTH_UTILS] Redirecting to Google for OAuth authorization");
			upstreamClientId = c.env.GOOGLE_CLIENT_ID || "";
			scope = UPSTREAM_SCOPES.google;
			upstreamUrl = "https://accounts.google.com/o/oauth2/v2/auth";
			hostedDomain = c.env.HOSTED_DOMAIN;
			redirectUri = new URL("/callback", c.req.raw.url).href;
			break;
		default:
			throw new Error(`Unknown provider: ${provider}`);
	}

	// The request stays on the server; the provider only sees a random value
	const state = generatePendingValue();
	const login: PendingLogin = {
		provider,
		authReqInfo,
		...(codeVerifier ? { codeVerifier } : {}),
	};
	await storePendingRecord(c.env.PENDING_LOGINS, LOGIN_KEY_PREFIX, state, login);

	// Copy into a Headers object, which keeps each Set-Cookie header separate
	const responseHeaders = new Headers(headers);
	responseHeaders.append("Set-Cookie", await pendingCookie(LOGIN_COOKIE, state));
	responseHeaders.set(
		"location",
		getUpstreamAuthorizeUrl({
			provider,
			codeChallenge: provider === "twitter" ? codeChallengeParam : authReqInfo.codeChallenge,
			codeChallengeMethod:
				provider === "twitter" ? codeChallengeMethod : authReqInfo.codeChallengeMethod,
			clientId: upstreamClientId,
			hostedDomain,
			redirectUri: redirectUriOverride || redirectUri,
			scope,
			grantType: "authorization_code",
			state,
			upstreamUrl,
		}),
	);

	return new Response(null, { headers: responseHeaders, status: 302 });
}

/** An http(s) URL, HTML-escaped for an attribute or text; anything else (javascript:, data:, ...) gives "" */
function webUrl(value: string | undefined): string {
	if (!value) return "";
	try {
		const { protocol } = new URL(value);
		return protocol === "https:" || protocol === "http:" ? sanitizeHtml(value) : "";
	} catch {
		return "";
	}
}

/** What to show as the destination: a web address's origin, or the whole URI for an app scheme */
function displayDestination(redirectUri: string): string {
	try {
		const url = new URL(redirectUri);
		return url.protocol === "https:" || url.protocol === "http:" ? url.origin : redirectUri;
	} catch {
		return redirectUri;
	}
}

/**
 * Sanitizes HTML content to prevent XSS attacks
 * @param unsafe - The unsafe string that might contain HTML
 * @returns A safe string with HTML special characters escaped
 */
function sanitizeHtml(unsafe: string): string {
	return unsafe
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

/**
 * Constructs an authorization URL for an upstream service.
 *
 * @param {Object} options
 * @param {string} options.upstream_url - The base URL of the upstream service.
 * @param {string} options.client_id - The client ID of the application.
 * @param {string} options.redirect_uri - The redirect URI of the application.
 * @param {string} [options.state] - The state parameter.
 * @param {string} [options.hosted_domain] - The hosted domain parameter.
 *
 * @returns {string} The authorization URL.
 */
export function getUpstreamAuthorizeUrl({
	provider,
	upstreamUrl,
	clientId,
	scope,
	grantType,
	redirectUri,
	state,
	hostedDomain,
	codeChallenge,
	codeChallengeMethod,
}: {
	provider: string;
	upstreamUrl: string;
	clientId: string;
	scope: string;
	redirectUri: string;
	grantType: string;
	state?: string;
	hostedDomain?: string;
	codeChallenge?: string;
	codeChallengeMethod?: string;
}) {
	const upstream = new URL(upstreamUrl);
	upstream.searchParams.set("client_id", clientId);
	upstream.searchParams.set("redirect_uri", redirectUri);
	upstream.searchParams.set("scope", scope);

	if (provider === "twitter" && codeChallenge) {
		upstream.searchParams.set("code_challenge", codeChallenge);
		upstream.searchParams.set("code_challenge_method", "S256");
		upstream.searchParams.set("grant_type", grantType);
	}
	console.log(`[WORKER_OAUTH_UTILS] Using grant type: ${grantType}`);
	upstream.searchParams.set("response_type", "code");
	if (state) upstream.searchParams.set("state", state);
	if (hostedDomain) upstream.searchParams.set("hd", hostedDomain);
	return upstream.href;
}

/**
 * Fetches an authorization token from an upstream service.
 *
 * @param {Object} options
 * @param {string} options.client_id - The client ID of the application.
 * @param {string} options.client_secret - The client secret of the application.
 * @param {string} options.code - The authorization code.
 * @param {string} options.redirect_uri - The redirect URI of the application.
 * @param {string} options.upstream_url - The token endpoint URL of the upstream service.
 * @param {string} options.grant_type - The grant type.
 *
 * @returns {Promise<[string, null] | [null, Response]>} A promise that resolves to an array containing the access token or an error response.
 */
export async function fetchUpstreamAuthToken(
	env: any,
	{
		clientId,
		clientSecret,
		code,
		redirectUri,
		upstreamUrl,
		grantType,
		codeVerifier,
	}: {
		code: string | undefined;
		upstreamUrl: string;
		clientSecret: string;
		redirectUri: string;
		clientId: string;
		grantType: string;
		codeVerifier?: string;
	},
): Promise<[string, null] | [null, Response]> {
	if (!code) {
		return [null, new Response("Missing code", { status: 400 })];
	}

	// Determine if this is a GitHub request based on the URL
	const isGitHub = upstreamUrl.includes("github.com");
	const isLinkedIn = upstreamUrl.includes("linkedin.com");
	const isX = upstreamUrl.includes("x.com") || upstreamUrl.includes("twitter.com");

	// Create appropriate parameters based on the provider
	const params: Record<string, string> = isGitHub
		? {
				// GitHub uses standard OAuth parameter names
				client_id: clientId,
				client_secret: clientSecret,
				code,
				redirect_uri: redirectUri,
			}
		: isLinkedIn
			? {
					// LinkedIn uses standard OAuth parameter names
					client_id: clientId,
					client_secret: clientSecret,
					code,
					redirect_uri: redirectUri,
					grant_type: grantType,
				}
			: isX
				? {
						// X (Twitter) uses standard OAuth parameter names
						client_id: clientId,
						client_secret: clientSecret,
						code,
						redirect_uri: redirectUri,
						grant_type: grantType,
						...(codeVerifier ? { code_verifier: codeVerifier } : {}),
					}
				: {
						// Google uses our custom parameter names
						clientId,
						clientSecret,
						code,
						grantType,
						redirectUri,
					};

	const headers: Record<string, string> = {
		"Content-Type": "application/x-www-form-urlencoded",
	};

	// GitHub requires Accept header for JSON response
	if (isGitHub) {
		headers.Accept = "application/json";
	}
	if (isX) {
		const basic = btoa(`${env.TWITTER_CLIENT_ID}:${env.TWITTER_CLIENT_SECRET}`);
		headers.Authorization = `Basic ${basic}`;
	}

	const resp = await fetch(upstreamUrl, {
		body: new URLSearchParams(params).toString(),
		headers,
		method: "POST",
	});

	if (!resp.ok) {
		await resp.text();
		console.error("[WORKER_OAUTH_UTILS] Failed to fetch access token");
		return [null, new Response("Failed to fetch access token", { status: 500 })];
	}

	interface authTokenResponse {
		access_token: string;
	}

	const body = (await resp.json()) as authTokenResponse;
	if (!body.access_token) {
		return [null, new Response("Missing access token", { status: 400 })];
	}
	return [body.access_token, null];
}
