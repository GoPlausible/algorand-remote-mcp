// workers-oauth-utils.ts

import type { AuthRequest, ClientInfo } from "./oauth-provider"; // Adjust path if necessary

const COOKIE_NAME = "mcp-approved-clients";
const ONE_YEAR_IN_SECONDS = 31536000;

// --- Helper Functions ---

/**
 * Encodes arbitrary data to a URL-safe base64 string.
 * @param data - The data to encode (will be stringified).
 * @returns A URL-safe base64 encoded string.
 */
function _encodeState(data: any): string {
	try {
		const jsonString = JSON.stringify(data);
		// Use btoa for simplicity, assuming Worker environment supports it well enough
		// For complex binary data, a Buffer/Uint8Array approach might be better
		return btoa(jsonString);
	} catch (e) {
		console.error("Error encoding state:", e);
		throw new Error("Could not encode state");
	}
}

/**
 * Decodes a URL-safe base64 string back to its original data.
 * @param encoded - The URL-safe base64 encoded string.
 * @returns The original data.
 */
function decodeState<T = any>(encoded: string): T {
	try {
		const jsonString = atob(encoded);
		return JSON.parse(jsonString);
	} catch (e) {
		console.error("Error decoding state:", e);
		throw new Error("Could not decode state");
	}
}
export function clearApprovedClientsCookie(): Record<string, string> {
  // expire immediately
  return {
    "Set-Cookie": `${COOKIE_NAME}=; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=0`
  };
}

export async function removeClientFromApprovedCookie(
  request: Request,
  cookieSecret: string,
  clientId: string
): Promise<Record<string, string>> {
  const existing = await getApprovedClientsFromCookie(request.headers.get("Cookie"), cookieSecret) || [];
  const next = existing.filter(id => id !== clientId);
  const payload = JSON.stringify(next);
  const key = await importKey(cookieSecret);
  const signature = await signWithHmacSha256(key, payload);
  const value = `${signature}.${btoa(payload)}`;
  return {
    "Set-Cookie": `${COOKIE_NAME}=${value}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=${ONE_YEAR_IN_SECONDS}`
  };
}
/**
 * Imports a secret key string for HMAC-SHA256 signing.
 * @param secret - The raw secret key string.
 * @returns A promise resolving to the CryptoKey object.
 */
async function importKey(secret: string): Promise<CryptoKey> {
	if (!secret) {
		throw new Error(
			"COOKIE_SECRET is not defined. A secret key is required for signing cookies.",
		);
	}
	console.log("Importing key for HMAC-SHA256 signing: ", secret); // Log first 10 chars for brevity
	const enc = new TextEncoder();
	return crypto.subtle.importKey(
		"raw",
		enc.encode(secret),
		{ hash: "SHA-256", name: "HMAC" },
		false, // not extractable
		["sign", "verify"], // key usages
	);
}

/**
 * Signs data using HMAC-SHA256.
 * @param key - The CryptoKey for signing.
 * @param data - The string data to sign.
 * @returns A promise resolving to the signature as a hex string.
 */
async function signWithHmacSha256(key: CryptoKey, data: string): Promise<string> {
	const enc = new TextEncoder();
	const signatureBuffer = await crypto.subtle.sign("HMAC", key, enc.encode(data));
	// Convert ArrayBuffer to hex string
	return Array.from(new Uint8Array(signatureBuffer))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/**
 * Verifies an HMAC-SHA256 signature.
 * @param key - The CryptoKey for verification.
 * @param signatureHex - The signature to verify (hex string).
 * @param data - The original data that was signed.
 * @returns A promise resolving to true if the signature is valid, false otherwise.
 */
async function verifyHmacSha256Signature(
	key: CryptoKey,
	signatureHex: string,
	data: string,
): Promise<boolean> {
	const enc = new TextEncoder();
	try {
		// Convert hex signature back to ArrayBuffer
		const signatureBytes = new Uint8Array(
			signatureHex.match(/.{1,2}/g)!.map((byte) => Number.parseInt(byte, 16)),
		);
		return await crypto.subtle.verify("HMAC", key, signatureBytes.buffer, enc.encode(data));
	} catch (e) {
		// Handle errors during hex parsing or verification
		console.error("Error verifying signature:", e);
		return false;
	}
}

/**
 * Parses the signed cookie and verifies its integrity.
 * @param cookieHeader - The value of the Cookie header from the request.
 * @param secret - The secret key used for signing.
 * @returns A promise resolving to the list of approved client IDs if the cookie is valid, otherwise null.
 */
async function getApprovedClientsFromCookie(
	cookieHeader: string | null,
	secret: string,
): Promise<string[] | null> {
	if (!cookieHeader) return null;

	const cookies = cookieHeader.split(";").map((c) => c.trim());
	const targetCookie = cookies.find((c) => c.startsWith(`${COOKIE_NAME}=`));

	if (!targetCookie) return null;

	const cookieValue = targetCookie.substring(COOKIE_NAME.length + 1);
	const parts = cookieValue.split(".");

	if (parts.length !== 2) {
		console.warn("Invalid cookie format received.");
		return null; // Invalid format
	}

	const [signatureHex, base64Payload] = parts;
	const payload = atob(base64Payload); // Assuming payload is base64 encoded JSON string

	const key = await importKey(secret);
	const isValid = await verifyHmacSha256Signature(key, signatureHex, payload);

	if (!isValid) {
		console.warn("Cookie signature verification failed.");
		return null; // Signature invalid
	}

	try {
		const approvedClients = JSON.parse(payload);
		if (!Array.isArray(approvedClients)) {
			console.warn("Cookie payload is not an array.");
			return null; // Payload isn't an array
		}
		// Ensure all elements are strings
		if (!approvedClients.every((item) => typeof item === "string")) {
			console.warn("Cookie payload contains non-string elements.");
			return null;
		}
		return approvedClients as string[];
	} catch (e) {
		console.error("Error parsing cookie payload:", e);
		return null; // JSON parsing failed
	}
}

// --- Exported Functions ---

/**
 * Result of checking if a client ID has already been approved
 */
export interface ApprovalCheckResult {
	/** Whether the client ID has been approved */
	approved: boolean;
	/** The preferred provider for this client, if available */
  provider: string;
}

/**
 * Checks if a given client ID has already been approved by the user,
 * based on a signed cookie.
 *
 * @param request - The incoming Request object to read cookies from.
 * @param clientId - The OAuth client ID to check approval for.
 * @param cookieSecret - The secret key used to sign/verify the approval cookie.
 * @returns A promise resolving to an object containing approval status and provider preference.
 */
export async function clientIdAlreadyApproved(
	request: Request,
	clientId: string,
	cookieSecret: string,
): Promise<ApprovalCheckResult> {
	console.log("Checking if client ID is already approved:", clientId);
	if (!clientId) return { approved: false, provider: '' };
	
	const cookieHeader = request.headers.get("Cookie");
	const approvedClients = await getApprovedClientsFromCookie(cookieHeader, cookieSecret);
	console.log("Approved clients from cookie:", approvedClients);
	
	// Check for provider preference cookie
	let provider = null // Default provider
	try {
		const cookies = cookieHeader ? cookieHeader.split(';').map(c => c.trim()) : [];
		const providerCookie = cookies.find(c => c.startsWith('mcp-provider-preference='));
		if (providerCookie) {
			provider = providerCookie.split('=')[1];
		}
	} catch (error) {
		console.error("Error reading provider preference cookie:", error);
	}
	
	return {
		approved: approvedClients?.includes(clientId) ?? false,
		provider: provider || null, // Default to Google if no preference set
	};
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
	 * Server information to display in the approval dialog
	 */
	server: {
		name: string;
		logo?: string;
		description?: string;
	};
	/**
	 * Arbitrary state data to pass through the approval flow
	 * Will be encoded in the form and returned when approval is complete
	 */
	state: Record<string, any>;
	/**
	 * Name of the cookie to use for storing approvals
	 * @default "mcp_approved_clients"
	 */
	cookieName?: string;
	/**
	 * Secret used to sign cookies for verification
	 * Can be a string or Uint8Array
	 * @default Built-in Uint8Array key
	 */
	cookieSecret?: string | Uint8Array;
	/**
	 * Cookie domain
	 * @default current domain
	 */
	cookieDomain?: string;
	/**
	 * Cookie path
	 * @default "/"
	 */
	cookiePath?: string;
	/**
	 * Cookie max age in seconds
	 * @default 30 days
	 */
	cookieMaxAge?: number;
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
	const { client, server, state } = options;
	console.log("Rendering approval dialog with options:", options);

	// Encode state for form submission
	const encodedState = btoa(JSON.stringify(state));

	// Sanitize any untrusted content
	const serverName = sanitizeHtml(server.name);
	console.log("Sanitized server name:", serverName);
	const clientName = client?.clientName ? sanitizeHtml(client.clientName) : "Unknown MCP Client";
	console.log("Sanitized client name:", clientName);
	const serverDescription = server.description ? sanitizeHtml(server.description) : "";

	// Safe URLs
	const logoUrl = server.logo ? sanitizeHtml(server.logo) : "";
	console.log("Sanitized logo URL:", logoUrl.substring(0, 100)); // Log first 100 chars for brevity
	// const clientUri = client?.clientUri ? sanitizeHtml(client.clientUri) : "";
	const clientUri =  "https://algorandmcp.goplausible.xyz"; // Default to GoPlausible MCP URL
	console.log("Sanitized client URI:", clientUri.substring(0, 100)); // Log first 100 chars for brevity
	// const policyUri = client?.policyUri ? sanitizeHtml(client.policyUri) : "http://goplausible.com/policy";
	const policyUri =  "http://goplausible.com/policy";
	console.log("Sanitized policy URI:", policyUri.substring(0, 100)); // Log first 100 chars for brevity
	const tosUri = client?.tosUri ? sanitizeHtml(client.tosUri) : "";
	console.log("Sanitized TOS URI:", tosUri.substring(0, 100)); // Log first 100 chars for brevity

	// Client contacts
	console.log("Sanitizing client contacts");
	const contacts =
		client?.contacts && client.contacts.length > 0
			? sanitizeHtml(client.contacts.join(", "))
			: "";
	console.log("Sanitized contacts:", contacts.substring(0, 100)); // Log first 100 chars for brevity

	// Get redirect URIs
	console.log("Sanitizing redirect URIs");
	const redirectUris =
		client?.redirectUris && client.redirectUris.length > 0
			? client.redirectUris.map((uri) => sanitizeHtml(uri))
			: [];
	console.log("Sanitized redirect URIs:", redirectUris.slice(0, 3)); // Log first 3 for brevity

	// Generate HTML for the approval dialog
	const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title> GoPlausible OAuth Authorization Request | ${clientName}  </title>
        <link rel="icon" href="data:image/png;base64,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AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAATaZmFD20ZUcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP///wEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==
 " />
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
            
            <h2 class="alert"><strong>${clientName || "A new MCP Client"}</strong> is requesting access</h1>
            
            <div class="client-info">
              <div class="client-detail">
                <div class="detail-label">Name:</div>
                <div class="detail-value">
                  ${clientName}
                </div>
              </div>
              
              ${clientUri
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
              
              ${policyUri
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
              
              ${tosUri
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
              
              ${redirectUris.length > 0
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
              
              ${contacts
			? `
                <div class="client-detail">
                  <div class="detail-label">Contact:</div>
                  <div class="detail-value">${contacts}</div>
                </div>
              `
			: ""
		}
            </div>
            
            <p>This MCP Client is requesting to be authorized on ${serverName}. Choose a provider to continue authentication:</p>
            
            <form method="post" action="${new URL(request.url).pathname}">
              <input type="hidden" name="state" value="${encodedState}">
              <!-- Add a hidden field to store the provider preference in the approval form -->
              <input type="hidden" name="provider_preference" id="provider_preference" value="google">
              
              <div class="auth-providers">
                <button type="submit" class="provider-button" style="background-color: #ffffff; border-color: #e1e4e8; color: #24292e; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);" name="provider" value="google" onclick="document.getElementById('provider_preference').value='google';">
                  <img src="https://www.gstatic.com/marketing-cms/assets/images/d5/dc/cfe9ce8b4425b410b49b7f2dd3f3/g.webp" alt="Google Logo" class="provider-logo">
                  <span>Continue with Google</span>
                </button>
                
                <button type="submit" class="provider-button" style="background-color: #ffffff; border-color: #e1e4e8; color: #24292e; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);" name="provider" value="github" onclick="document.getElementById('provider_preference').value='github';">
                  <img src="https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png" alt="GitHub Logo" class="provider-logo">
                  <span>Continue with GitHub</span>
                </button>
                
                <button type="button" class="provider-button disabled" disabled>
                  <img src="https://about.x.com/content/dam/about-twitter/x/brand-toolkit/logo-black.png.twimg.1920.png" alt="X Logo" class="provider-logo">
                  <span>Continue with X</span>
                  <span class="coming-soon">Coming soon</span>
                </button>
                
                <button type="submit" class="provider-button" style="background-color: #ffffff; border-color: #e1e4e8; color: #24292e; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);" name="provider" value="linkedin" onclick="document.getElementById('provider_preference').value='linkedin';">
                  <img src="https://content.linkedin.com/content/dam/me/business/en-us/amp/brand-site/v2/bg/LI-Bug.svg.original.svg" alt="LinkedIn Logo" class="provider-logo">
                  <span>Continue with LinkedIn</span>
                </button>
              </div>
              
              <div class="actions">
                <button type="button" class="button button-secondary" onclick="window.history.back()">Cancel</button>
              </div>
            </form>
          </div>
          <div class="powered-by">
            Powered by <a href="https://algorand.co" target="_blank" rel="noopener noreferrer">Algorand</a>
          </div>
        </div>
      </body>
    </html>
  `;
	console.log("Generated HTML content for approval dialog");
	return new Response(htmlContent, {
		headers: {
			"Content-Type": "text/html; charset=utf-8",
		},
	});
}

/**
 * Result of parsing the approval form submission.
 */
export interface ParsedApprovalResult {
	/** The original state object passed through the form. */
	state: any;
	/** Headers to set on the redirect response, including the Set-Cookie header. */
	headers: Record<string, string>;
}

/**
 * Parses the form submission from the approval dialog, extracts the state,
 * and generates Set-Cookie headers to mark the client as approved.
 *
 * @param request - The incoming POST Request object containing the form data.
 * @param cookieSecret - The secret key used to sign the approval cookie.
 * @returns A promise resolving to an object containing the parsed state and necessary headers.
 * @throws If the request method is not POST, form data is invalid, or state is missing.
 */
export async function parseRedirectApproval(
	request: Request,
	cookieSecret: string,
): Promise<ParsedApprovalResult> {
	if (request.method !== "POST") {
		throw new Error("Invalid request method. Expected POST.");
	}

	let state: any;
	let clientId: string | undefined;

	try {
		const formData = await request.formData();
		const encodedState = formData.get("state");
		const providerPreference = formData.get("provider_preference") || "google";

		if (typeof encodedState !== "string" || !encodedState) {
			throw new Error("Missing or invalid 'state' in form data.");
		}

		state = decodeState<{ oauthReqInfo?: AuthRequest }>(encodedState); // Decode the state
		clientId = state?.oauthReqInfo?.clientId; // Extract clientId from within the state

		if (!clientId) {
			throw new Error("Could not extract clientId from state object.");
		}
		
		// Add the provider preference to the state for use in the GET handler
		state.providerPreference = providerPreference;
	} catch (e) {
		console.error("Error processing form submission:", e);
		// Rethrow or handle as appropriate, maybe return a specific error response
		throw new Error(
			`Failed to parse approval form: ${e instanceof Error ? e.message : String(e)}`,
		);
	}

	// Get existing approved clients
	const cookieHeader = request.headers.get("Cookie");
	const existingApprovedClients =
		(await getApprovedClientsFromCookie(cookieHeader, cookieSecret)) || [];

	// Add the newly approved client ID (avoid duplicates)
	const updatedApprovedClients = Array.from(new Set([...existingApprovedClients, clientId]));

	// Sign the updated list
	const payload = JSON.stringify(updatedApprovedClients);
	const key = await importKey(cookieSecret);
	const signature = await signWithHmacSha256(key, payload);
	const newCookieValue = `${signature}.${btoa(payload)}`; // signature.base64(payload)

	// Generate Set-Cookie headers
	const headers: Record<string, string> = {
		"Set-Cookie": `${COOKIE_NAME}=${newCookieValue}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=${ONE_YEAR_IN_SECONDS}`,
	};
	
	// Add provider preference cookie
	if (state.providerPreference) {
		headers["Set-Cookie"] = [
			headers["Set-Cookie"],
			`mcp-provider-preference=${state.providerPreference}; Secure; Path=/; SameSite=Lax; Max-Age=${ONE_YEAR_IN_SECONDS}`
		].join(", ");
	}

	return { headers, state };
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
	upstreamUrl,
	clientId,
	scope,
	redirectUri,
	state,
	hostedDomain,
}: {
	upstreamUrl: string;
	clientId: string;
	scope: string;
	redirectUri: string;
	state?: string;
	hostedDomain?: string;
}) {
	const upstream = new URL(upstreamUrl);
	upstream.searchParams.set("client_id", clientId);
	upstream.searchParams.set("redirect_uri", redirectUri);
	upstream.searchParams.set("scope", scope);
	upstream.searchParams.set("response_type", "code");
	if (state) upstream.searchParams.set("state", state);
	if (hostedDomain) upstream.searchParams.set("hd", hostedDomain);
  console.log(`Constructed upstream authorization URL: ${upstream.href}`);
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
export async function fetchUpstreamAuthToken({
	clientId,
	clientSecret,
	code,
	redirectUri,
	upstreamUrl,
	grantType,
}: {
	code: string | undefined;
	upstreamUrl: string;
	clientSecret: string;
	redirectUri: string;
	clientId: string;
	grantType: string;
}): Promise<[string, null] | [null, Response]> {
	if (!code) {
		return [null, new Response("Missing code", { status: 400 })];
	}

	// Determine if this is a GitHub request based on the URL
	const isGitHub = upstreamUrl.includes('github.com');
	
	// Create appropriate parameters based on the provider
	const params: Record<string, string> = isGitHub ? {
		// GitHub uses standard OAuth parameter names
		client_id: clientId,
		client_secret: clientSecret,
		code,
		redirect_uri: redirectUri
	} : {
		// Google uses our custom parameter names
		clientId,
		clientSecret,
		code,
		grantType,
		redirectUri,
	};

	const headers: Record<string, string> = {
		"Content-Type": "application/x-www-form-urlencoded"
	};
	
	// GitHub requires Accept header for JSON response
	if (isGitHub) {
		headers["Accept"] = "application/json";
	}

	const resp = await fetch(upstreamUrl, {
		body: new URLSearchParams(params).toString(),
		headers,
		method: "POST",
	});
	
	if (!resp.ok) {
		console.error(`Failed to fetch access token: ${await resp.text()}`);
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

// Context from the auth process, encrypted & stored in the auth token
// and provided to the AlgorandRemoteMCP as this.props
export type Props = {
	name: string;
	email: string;
	accessToken: string;
	provider: string; // 'google' or 'github' or 'twitter' or 'linkedin'
};
