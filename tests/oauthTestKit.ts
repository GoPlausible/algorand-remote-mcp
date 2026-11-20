/**
 * Test kit for the OAuth flow: in-memory Workers KV, a PENDING_LOGINS namespace backed by the real
 * PendingLogins class, a fake rate limiter, a fake upstream world (Google, GitHub, LinkedIn, X),
 * and a request helper with a per-browser cookie jar. Nothing here touches the network: an
 * unexpected fetch throws.
 */
import { vi } from "vitest";
import { OauthHandler } from "../src/oauth-handler";
import type OAuthProvider from "../src/oauth-provider";
import type { OAuthProviderOptions } from "../src/oauth-provider";
import { PendingLogins } from "../src/pending-logins";

export const BASE = "https://algorandmcp.goplausible.xyz";
export const REDIRECT = "https://client.example/cb";
export const VERIFIER = `${"v".repeat(43)}-verifier-for-pkce-tests-0123456789`;

/** In-memory Workers KV with small pages and a key cursor, so pagination code paths run */
export function memoryKV(pageSize = 2) {
	const m = new Map<string, string>();
	return {
		m,
		async get(key: string, opts?: unknown) {
			const value = m.get(key);
			if (value === undefined) return null;
			const type = typeof opts === "string" ? opts : (opts as { type?: string })?.type;
			return type === "json" ? JSON.parse(value) : value;
		},
		async put(key: string, value: string) {
			m.set(key, String(value));
		},
		async delete(key: string) {
			m.delete(key);
		},
		async list({
			prefix = "",
			cursor,
			limit,
		}: { prefix?: string; cursor?: string; limit?: number } = {}) {
			const all = [...m.keys()]
				.filter((k) => k.startsWith(prefix) && (!cursor || k > cursor))
				.sort();
			const size = Math.min(limit ?? pageSize, pageSize);
			const keys = all.slice(0, size).map((name) => ({ name }));
			const done = all.length <= size;
			return {
				keys,
				list_complete: done,
				cursor: done ? undefined : keys[keys.length - 1].name,
			};
		},
	};
}

/** One Durable Object's storage in memory: the synchronous KV API and the alarm */
export function objectStorage() {
	const data = new Map<string, unknown>();
	let alarm: number | null = null;
	return {
		data,
		get alarm() {
			return alarm;
		},
		kv: {
			get: (key: string) => (data.has(key) ? structuredClone(data.get(key)) : undefined),
			put: (key: string, value: unknown) => void data.set(key, structuredClone(value)),
			delete: (key: string) => data.delete(key),
		},
		async setAlarm(time: number | Date) {
			alarm = Number(time);
		},
		async deleteAlarm() {
			alarm = null;
		},
	};
}

/**
 * A PENDING_LOGINS namespace: one real PendingLogins object per name, called the way an RPC stub
 * is (arguments and results are structured clones)
 */
export function pendingLoginsNamespace() {
	const objects = new Map<string, PendingLogins>();
	const objectFor = (name: string) => {
		let object = objects.get(name);
		if (!object) {
			object = new PendingLogins({ storage: objectStorage() } as any, {} as any);
			objects.set(name, object);
		}
		return object;
	};
	return {
		objects,
		idFromName: (name: string) => name,
		get: (id: string) => ({
			put: (record: unknown, ttl: number) => objectFor(id).put(structuredClone(record), ttl),
			take: async () => structuredClone(await objectFor(id).take()),
		}),
	};
}

/** The Workers rate limiter: `limit` successes per key */
export function rateLimiter(limit = 10) {
	const counts = new Map<string, number>();
	return {
		counts,
		async limit({ key }: { key: string }) {
			const n = (counts.get(key) ?? 0) + 1;
			counts.set(key, n);
			return { success: n <= limit };
		},
	};
}

export function makeEnv() {
	return {
		OAUTH_KV: memoryKV(),
		VAULT_ENTITIES: memoryKV(),
		PENDING_LOGINS: pendingLoginsNamespace(),
		REGISTER_RATE_LIMITER: rateLimiter(),
		GOOGLE_CLIENT_ID: "google-id",
		GOOGLE_CLIENT_SECRET: "google-secret",
		GITHUB_CLIENT_ID: "github-id",
		GITHUB_CLIENT_SECRET: "github-secret",
		TWITTER_CLIENT_ID: "x-id",
		TWITTER_CLIENT_SECRET: "x-secret",
		LINKEDIN_CLIENT_ID: "linkedin-id",
		LINKEDIN_CLIENT_SECRET: "linkedin-secret",
	} as any;
}

export const providerOptions = (
	extra: Partial<OAuthProviderOptions> = {},
): OAuthProviderOptions => ({
	apiRoute: "/sse",
	apiHandler: { fetch: async () => new Response("api ok") } as any,
	defaultHandler: OauthHandler as any,
	authorizeEndpoint: "/authorize",
	tokenEndpoint: "/token",
	clientRegistrationEndpoint: "/register",
	...extra,
});

export const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as any;

/** What the fake providers answer; tests change it before a login */
export interface UpstreamWorld {
	google: Record<string, unknown>;
	github: { user: Record<string, unknown>; emails: unknown };
	linkedin: Record<string, unknown>;
	x: { data: Record<string, unknown> };
	/** X: upstream code -> the code_challenge its token request must match */
	xChallenges: Map<string, string>;
}

export function defaultWorld(): UpstreamWorld {
	return {
		google: {
			id: "google-user-1",
			name: "Alice",
			email: "alice@example.com",
			verified_email: true,
		},
		github: {
			user: { id: 4242, login: "octo", name: "Octo", email: null },
			emails: [{ email: "octo@example.com", primary: true, verified: true }],
		},
		linkedin: {
			sub: "li-user-1",
			name: "Lin",
			email: "lin@example.com",
			email_verified: true,
		},
		x: { data: { id: "x-user-1", name: "Ex", username: "exuser" } },
		xChallenges: new Map(),
	};
}

export interface FetchCall {
	url: string;
	body: string;
}

/** Stubs global fetch with the fake providers; returns the list of calls made */
export function installUpstream(world: UpstreamWorld): FetchCall[] {
	const calls: FetchCall[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input instanceof Request ? input.url : input);
			const body = String(init?.body ?? "");
			calls.push({ url, body });
			if (url.startsWith("https://accounts.google.com/o/oauth2/token")) {
				return Response.json({ access_token: "google-access-token" });
			}
			if (url.startsWith("https://www.googleapis.com/oauth2/v2/userinfo")) {
				return Response.json(world.google);
			}
			if (url.startsWith("https://oauth2.googleapis.com/revoke")) {
				return new Response("", { status: 200 });
			}
			if (url.startsWith("https://github.com/login/oauth/access_token")) {
				return Response.json({ access_token: "github-access-token" });
			}
			if (url === "https://api.github.com/user") return Response.json(world.github.user);
			if (url === "https://api.github.com/user/emails") {
				return Response.json(world.github.emails);
			}
			if (url.startsWith("https://www.linkedin.com/oauth/v2/accessToken")) {
				return Response.json({ access_token: "linkedin-access-token" });
			}
			if (url.startsWith("https://api.linkedin.com/v2/userinfo")) {
				return Response.json(world.linkedin);
			}
			if (url.startsWith("https://api.x.com/2/oauth2/token")) {
				const params = new URLSearchParams(body);
				const expected = world.xChallenges.get(params.get("code") ?? "");
				const verifier = params.get("code_verifier") ?? "";
				if (!expected || (await s256(verifier)) !== expected) {
					return Response.json({ error: "invalid_request" }, { status: 400 });
				}
				return Response.json({ access_token: `x-access-token-${params.get("code")}` });
			}
			if (url.startsWith("https://api.x.com/2/users/me")) return Response.json(world.x);
			throw new Error(`unexpected fetch ${url}`);
		}),
	);
	return calls;
}

export async function s256(verifier: string) {
	const digest = new Uint8Array(
		await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
	);
	return btoa(String.fromCharCode(...digest))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

/** A browser's cookies */
export type Jar = Map<string, string>;

/** Sends a request through the provider, carrying and updating the browser's cookies */
export async function call(
	provider: OAuthProvider,
	env: any,
	path: string,
	init: RequestInit = {},
	jar?: Jar,
) {
	const headers = new Headers(init.headers);
	if (jar?.size) headers.set("Cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
	const res = await provider.fetch(new Request(`${BASE}${path}`, { ...init, headers }), env, ctx);
	if (jar) {
		for (const line of res.headers.getSetCookie()) {
			const [pair, ...attrs] = line.split(";").map((s) => s.trim());
			const eq = pair.indexOf("=");
			if (attrs.some((a) => a.toLowerCase() === "max-age=0")) jar.delete(pair.slice(0, eq));
			else jar.set(pair.slice(0, eq), pair.slice(eq + 1));
		}
	}
	return res;
}

export async function register(
	provider: OAuthProvider,
	env: any,
	redirectUris: unknown[] = [REDIRECT],
	extra: Record<string, unknown> = {},
	headers: Record<string, string> = {},
) {
	return call(provider, env, "/register", {
		method: "POST",
		headers: { "Content-Type": "application/json", ...headers },
		body: JSON.stringify({
			redirect_uris: redirectUris,
			token_endpoint_auth_method: "none",
			client_name: "Test Client",
			...extra,
		}),
	});
}

export async function registerClient(provider: OAuthProvider, env: any) {
	const res = await register(provider, env);
	return ((await res.json()) as { client_id: string }).client_id;
}

export async function authorizeQuery(clientId: string, extra: Record<string, string> = {}) {
	return new URLSearchParams({
		response_type: "code",
		client_id: clientId,
		redirect_uri: REDIRECT,
		state: "client-state",
		code_challenge: await s256(VERIFIER),
		code_challenge_method: "S256",
		...extra,
	}).toString();
}

/** The form value the dialog posts back */
export function dialogState(html: string): string {
	const match = html.match(/name="state" value="([^"]+)"/);
	if (!match) throw new Error("no state in the dialog");
	return match[1];
}

/** GET /authorize, then the provider choice; returns the provider redirect and its state */
export async function startLogin(
	provider: OAuthProvider,
	env: any,
	clientId: string,
	upstream: string,
	jar: Jar,
) {
	const page = await call(provider, env, `/authorize?${await authorizeQuery(clientId)}`, {}, jar);
	if (page.status !== 200) throw new Error(`authorize failed: ${page.status}`);
	const res = await call(
		provider,
		env,
		"/authorize",
		{
			method: "POST",
			body: new URLSearchParams({
				provider: upstream,
				state: dialogState(await page.text()),
			}),
		},
		jar,
	);
	if (res.status !== 302) throw new Error(`provider choice failed: ${res.status}`);
	const location = new URL(res.headers.get("location") ?? "");
	return { res, location, state: location.searchParams.get("state") ?? "" };
}

/** A whole login through Google; returns the client's authorization code */
export async function loginForCode(provider: OAuthProvider, env: any, clientId: string) {
	const jar: Jar = new Map();
	const { state } = await startLogin(provider, env, clientId, "google", jar);
	const res = await call(provider, env, `/callback?code=upstream-code&state=${state}`, {}, jar);
	if (res.status !== 302) throw new Error(`callback failed: ${res.status} ${await res.text()}`);
	const back = new URL(res.headers.get("location") ?? "");
	return back.searchParams.get("code") ?? "";
}

/** A whole login and the token exchange */
export async function loginForTokens(provider: OAuthProvider, env: any, clientId: string) {
	const code = await loginForCode(provider, env, clientId);
	const res = await exchangeCode(provider, env, clientId, code, VERIFIER);
	if (res.status !== 200) throw new Error(`token exchange failed: ${res.status}`);
	return (await res.json()) as { access_token: string; refresh_token: string };
}

export function exchangeCode(
	provider: OAuthProvider,
	env: any,
	clientId: string,
	code: string,
	verifier?: string,
) {
	const body = new URLSearchParams({
		grant_type: "authorization_code",
		code,
		client_id: clientId,
		redirect_uri: REDIRECT,
	});
	if (verifier) body.set("code_verifier", verifier);
	return call(provider, env, "/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body,
	});
}
