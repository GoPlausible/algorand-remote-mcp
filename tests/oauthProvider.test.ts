import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OAuthProvider, { redirectUriProblem } from "../src/oauth-provider";
import {
	type FetchCall,
	REDIRECT,
	VERIFIER,
	call,
	defaultWorld,
	exchangeCode,
	installUpstream,
	loginForCode,
	loginForTokens,
	makeEnv,
	providerOptions,
	register,
	registerClient,
} from "./oauthTestKit";

/**
 * The provider side, through the real OAuthProvider and OauthHandler. Items from
 * .claude/notes/doauth-protocol-fixes.md: M3 (registration rules and rate limit), D1 (PKCE S256 at
 * /token), H1 (grant cutoff), C3 (completeAuthorization re-checks the request), C4 (authenticated
 * /logout, with unwrapToken).
 */

const provider = new OAuthProvider(providerOptions());

let env: any;
let calls: FetchCall[];

beforeEach(() => {
	env = makeEnv();
	calls = installUpstream(defaultWorld());
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("M3: client registration", () => {
	const error = async (res: Response) => ((await res.json()) as { error: string }).error;

	// The protocol's rule, the same on all three servers: https, or http on a loopback host (the MCP
	// authorization spec: "All redirect URIs MUST be either localhost or use HTTPS")
	it("accepts https and loopback http", async () => {
		for (const uri of [
			"https://client.example/cb",
			"http://localhost:3000/cb",
			"http://127.0.0.1:8080/cb",
			"http://[::1]/cb",
		]) {
			expect((await register(provider, env, [uri])).status, uri).toBe(201);
		}
	});

	it("refuses redirect URIs with invalid_redirect_uri", async () => {
		for (const uri of [
			"javascript:alert(1)",
			"data:text/html,hi",
			"vbscript:msgbox",
			"file:///etc/passwd",
			"blob:https://client.example/x",
			"about:blank",
			"http://client.example/cb",
			"https://client.example/cb#frag",
			"/relative/cb",
		]) {
			const res = await register(provider, env, [REDIRECT, uri]);
			expect(res.status, uri).toBe(400);
			expect(await error(res), uri).toBe("invalid_redirect_uri");
		}
		expect([...env.OAUTH_KV.m.keys()].filter((k) => k.startsWith("client:"))).toHaveLength(0);
	});

	it("refuses app schemes and user information with invalid_redirect_uri", async () => {
		for (const uri of [
			"com.example.app:/oauth/cb",
			"cursor://anysphere.cursor-mcp/oauth/callback",
			"exp://192.168.1.20:8081/--/oauth",
			"https://claude.ai@evil.example/cb",
		]) {
			const res = await register(provider, env, [REDIRECT, uri]);
			expect(res.status, uri).toBe(400);
			expect(await error(res), uri).toBe("invalid_redirect_uri");
		}
		expect([...env.OAUTH_KV.m.keys()].filter((k) => k.startsWith("client:"))).toHaveLength(0);
	});

	it("refuses page, logo and key-set URLs that are not http(s), with invalid_client_metadata", async () => {
		for (const field of ["client_uri", "logo_uri", "policy_uri", "tos_uri", "jwks_uri"]) {
			const res = await register(provider, env, [REDIRECT], {
				[field]: "javascript:alert(1)",
			});
			expect(res.status, field).toBe(400);
			expect(await error(res), field).toBe("invalid_client_metadata");
		}
		const ok = await register(provider, env, [REDIRECT], {
			client_uri: "https://client.example",
			tos_uri: "https://client.example/tos",
		});
		expect(ok.status).toBe(201);
	});

	it("allows 10 registrations per minute from one address, then answers 429 with Retry-After", async () => {
		const from = (ip: string) =>
			register(provider, env, [REDIRECT], {}, { "CF-Connecting-IP": ip });
		for (let i = 0; i < 10; i++) expect((await from("198.51.100.7")).status).toBe(201);
		const limited = await from("198.51.100.7");
		expect(limited.status).toBe(429);
		expect(limited.headers.get("Retry-After")).toBe("60");
		expect((await from("198.51.100.8")).status).toBe(201);
	});

	it("explains each refused redirect URI", () => {
		expect(redirectUriProblem("https://client.example/cb")).toBeNull();
		expect(redirectUriProblem("http://evil.example/cb")).toMatch(/https/);
		expect(redirectUriProblem("https://client.example/cb#x")).toMatch(/fragment/);
		expect(redirectUriProblem("javascript:alert(1)")).toMatch(/https/);
		expect(redirectUriProblem("com.example.app:/cb")).toMatch(/https/);
		expect(redirectUriProblem("https://u@client.example/cb")).toMatch(/user information/);
	});
});

describe("D1: PKCE with S256 at /token", () => {
	it("advertises S256 only", async () => {
		const res = await call(provider, env, "/.well-known/oauth-authorization-server");
		const metadata = (await res.json()) as { code_challenge_methods_supported: string[] };
		expect(metadata.code_challenge_methods_supported).toEqual(["S256"]);
	});

	/** Issues a code, then rewrites its grant as another server's (shared store) might have it */
	async function codeWithGrant(clientId: string, edit: (grant: any) => void) {
		const code = await loginForCode(provider, env, clientId);
		const [userId, grantId] = code.split(":");
		const key = `grant:${userId}:${grantId}`;
		const grant = JSON.parse(env.OAUTH_KV.m.get(key));
		edit(grant);
		env.OAUTH_KV.m.set(key, JSON.stringify(grant));
		return code;
	}

	it("exchanges a code with the right verifier", async () => {
		const clientId = await registerClient(provider, env);
		const code = await loginForCode(provider, env, clientId);
		const res = await exchangeCode(provider, env, clientId, code, VERIFIER);
		expect(res.status).toBe(200);
	});

	it("refuses a wrong or missing verifier", async () => {
		const clientId = await registerClient(provider, env);
		const code = await loginForCode(provider, env, clientId);
		const wrong = await exchangeCode(provider, env, clientId, code, `${VERIFIER}x`);
		expect(((await wrong.json()) as { error: string }).error).toBe("invalid_grant");
		const missing = await exchangeCode(provider, env, clientId, code);
		expect(((await missing.json()) as { error: string }).error).toBe("invalid_request");
	});

	it("refuses a code issued without PKCE", async () => {
		const clientId = await registerClient(provider, env);
		const code = await codeWithGrant(clientId, (g) => {
			g.codeChallenge = undefined;
			g.codeChallengeMethod = undefined;
		});
		const res = await exchangeCode(provider, env, clientId, code);
		expect(res.status).toBe(400);
		expect(((await res.json()) as { error: string }).error).toBe("invalid_grant");
	});

	it("refuses a code issued with plain PKCE, even with the matching verifier", async () => {
		const clientId = await registerClient(provider, env);
		const code = await codeWithGrant(clientId, (g) => {
			g.codeChallenge = VERIFIER;
			g.codeChallengeMethod = "plain";
		});
		const res = await exchangeCode(provider, env, clientId, code, VERIFIER);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string; error_description: string };
		expect(body.error).toBe("invalid_grant");
		expect(body.error_description).toMatch(/Unsupported PKCE code_challenge_method/);
	});
});

describe("H1: grants issued before the cutoff", () => {
	const CUTOFF = Math.floor(Date.parse("2026-11-07T21:22:16Z") / 1000);
	const withCutoff = new OAuthProvider(providerOptions({ grantsIssuedBefore: CUTOFF }));

	async function session(createdAt: number | undefined) {
		const clientId = await registerClient(withCutoff, env);
		const tokens = await loginForTokens(withCutoff, env, clientId);
		const [userId, grantId] = tokens.refresh_token.split(":");
		const key = `grant:${userId}:${grantId}`;
		const grant = JSON.parse(env.OAUTH_KV.m.get(key));
		if (createdAt === undefined) grant.createdAt = undefined;
		else grant.createdAt = createdAt;
		env.OAUTH_KV.m.set(key, JSON.stringify(grant));
		return { clientId, key, refresh: tokens.refresh_token };
	}

	const refresh = (clientId: string, refreshToken: string) =>
		call(withCutoff, env, "/token", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "refresh_token",
				refresh_token: refreshToken,
				client_id: clientId,
			}),
		});

	it("refuses and deletes a grant created before the cutoff", async () => {
		const s = await session(CUTOFF - 1);
		const res = await refresh(s.clientId, s.refresh);
		expect(res.status).toBe(400);
		expect(((await res.json()) as { error: string }).error).toBe("invalid_grant");
		expect(env.OAUTH_KV.m.has(s.key)).toBe(false);
		expect((await refresh(s.clientId, s.refresh)).status).toBe(400);
	});

	it("counts a grant without createdAt as older than the cutoff", async () => {
		const s = await session(undefined);
		expect((await refresh(s.clientId, s.refresh)).status).toBe(400);
		expect(env.OAUTH_KV.m.has(s.key)).toBe(false);
	});

	it("refreshes a grant created at or after the cutoff", async () => {
		const s = await session(CUTOFF);
		const res = await refresh(s.clientId, s.refresh);
		expect(res.status).toBe(200);
		expect(((await res.json()) as { access_token: string }).access_token).toBeTruthy();
	});

	it("refreshes any grant when no cutoff is set", async () => {
		const clientId = await registerClient(provider, env);
		const tokens = await loginForTokens(provider, env, clientId);
		const res = await call(provider, env, "/token", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "refresh_token",
				refresh_token: tokens.refresh_token,
				client_id: clientId,
			}),
		});
		expect(res.status).toBe(200);
	});
});

describe("C3: completeAuthorization re-checks the request", () => {
	// A default handler that hands completeAuthorization whatever request it is given
	const probe = new OAuthProvider(
		providerOptions({
			defaultHandler: {
				async fetch(request: Request, env: any) {
					const request_ = (await request.json()) as Record<string, unknown>;
					try {
						const result = await env.OAUTH_PROVIDER.completeAuthorization({
							request: {
								responseType: "code",
								scope: [],
								state: "s",
								codeChallenge: "c",
								codeChallengeMethod: "S256",
								...request_,
							},
							userId: "u1",
							metadata: {},
							scope: [],
							props: { id: "u1" },
						});
						return Response.json(result);
					} catch (error) {
						return new Response((error as Error).message, { status: 500 });
					}
				},
			} as any,
		}),
	);

	const complete = (request: Record<string, unknown>) =>
		call(probe, env, "/complete", { method: "POST", body: JSON.stringify(request) });

	it("refuses an unknown client", async () => {
		const res = await complete({ clientId: "nope", redirectUri: REDIRECT });
		expect(await res.text()).toMatch(/unknown client/);
	});

	it("refuses a redirect URI the client did not register", async () => {
		const clientId = await registerClient(probe, env);
		const res = await complete({ clientId, redirectUri: "https://evil.example/cb" });
		expect(res.status).toBe(500);
		expect(await res.text()).toMatch(/not registered/);
		expect([...env.OAUTH_KV.m.keys()].some((k) => k.startsWith("grant:"))).toBe(false);
	});

	it("refuses the implicit flow while allowImplicitFlow is off", async () => {
		const clientId = await registerClient(probe, env);
		const res = await complete({ clientId, redirectUri: REDIRECT, responseType: "token" });
		expect(await res.text()).toMatch(/unsupported response type/);
		expect([...env.OAUTH_KV.m.keys()].some((k) => k.startsWith("token:"))).toBe(false);
	});

	it("refuses a response type the client did not register", async () => {
		const res = await register(probe, env, [REDIRECT], { response_types: ["none"] });
		const { client_id } = (await res.json()) as { client_id: string };
		const out = await complete({ clientId: client_id, redirectUri: REDIRECT });
		expect(await out.text()).toMatch(/not registered for this client/);
	});

	it("completes a valid request", async () => {
		const clientId = await registerClient(probe, env);
		const res = await complete({ clientId, redirectUri: REDIRECT });
		expect(res.status).toBe(200);
		const { redirectTo } = (await res.json()) as { redirectTo: string };
		expect(redirectTo.startsWith(`${REDIRECT}?code=`)).toBe(true);
	});
});

describe("C4: /logout", () => {
	const logout = (headers: Record<string, string> = {}, query = "", method = "POST") =>
		call(provider, env, `/logout${query}`, { method, headers });

	/** Logs Alice in, and seeds grants the logout must leave alone */
	async function setup() {
		const clientId = await registerClient(provider, env);
		const tokens = await loginForTokens(provider, env, clientId);
		const userId = "google-user-1";
		const seed = (key: string, grant: Record<string, unknown>) =>
			env.OAUTH_KV.m.set(
				key,
				JSON.stringify({ scope: [], createdAt: 1, encryptedProps: "", ...grant }),
			);
		seed(`grant:${userId}:other-client`, {
			id: "other-client",
			clientId: "another-client",
			userId,
			metadata: { provider: "google" },
		});
		seed(`grant:${userId}:github-user`, {
			id: "github-user",
			clientId,
			userId,
			metadata: { provider: "github" },
		});
		seed(`grant:${userId}2:longer-id`, {
			id: "longer-id",
			clientId,
			userId: `${userId}2`,
			metadata: { provider: "google" },
		});
		seed(`grant:${userId}:no-provider`, { id: "no-provider", clientId, userId, metadata: {} });
		env.OAUTH_KV.m.set(`token:${userId}:no-provider:t1`, "{}");
		return { clientId, tokens, userId };
	}

	it("refuses a request without a bearer token, and deletes nothing", async () => {
		const { clientId, userId } = await setup();
		const before = [...env.OAUTH_KV.m.keys()].sort();
		for (const method of ["GET", "POST"]) {
			const res = await logout(
				{},
				`?provider=google&clientId=${clientId}&userId=${userId}&email=alice@example.com&token=x`,
				method,
			);
			expect(res.status).toBe(401);
			expect(res.headers.get("WWW-Authenticate")).toContain("invalid_token");
		}
		expect([...env.OAUTH_KV.m.keys()].sort()).toEqual(before);
	});

	it("refuses an unknown, malformed or expired token", async () => {
		const { tokens } = await setup();
		expect((await logout({ Authorization: "Bearer a:b:c" })).status).toBe(401);
		expect((await logout({ Authorization: "Bearer not-a-token" })).status).toBe(401);

		const tokenKey = [...env.OAUTH_KV.m.keys()].find(
			(k: string) => k.startsWith("token:google-user-1:") && !k.includes("no-provider"),
		) as string;
		const record = JSON.parse(env.OAUTH_KV.m.get(tokenKey));
		record.expiresAt = Math.floor(Date.now() / 1000) - 1;
		env.OAUTH_KV.m.set(tokenKey, JSON.stringify(record));
		expect((await logout({ Authorization: `Bearer ${tokens.access_token}` })).status).toBe(401);
	});

	it("revokes only the caller's grants for the token's client, and never the client", async () => {
		const { clientId, tokens, userId } = await setup();
		const [, ownGrantId] = tokens.access_token.split(":");

		const res = await logout({ Authorization: `Bearer ${tokens.access_token}` });
		expect(res.status).toBe(200);
		expect(((await res.json()) as { success: boolean }).success).toBe(true);
		// One Set-Cookie header per cookie (L2)
		expect(res.headers.getSetCookie()).toHaveLength(2);

		const keys = [...env.OAUTH_KV.m.keys()] as string[];
		expect(keys).not.toContain(`grant:${userId}:${ownGrantId}`);
		expect(keys.some((k) => k.startsWith(`token:${userId}:${ownGrantId}:`))).toBe(false);
		expect(keys).not.toContain(`grant:${userId}:no-provider`);
		expect(keys).not.toContain(`token:${userId}:no-provider:t1`);
		expect(keys).toContain(`grant:${userId}:other-client`);
		expect(keys).toContain(`grant:${userId}:github-user`);
		expect(keys).toContain(`grant:${userId}2:longer-id`);
		expect(keys).toContain(`client:${clientId}`);

		const revoke = calls.find((c) => c.url.startsWith("https://oauth2.googleapis.com/revoke"));
		expect(new URLSearchParams(revoke?.body).get("token")).toBe("google-access-token");

		// The token is gone with its grant
		expect((await logout({ Authorization: `Bearer ${tokens.access_token}` })).status).toBe(401);
	});
});
