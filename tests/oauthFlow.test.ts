import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pickVerifiedGitHubEmail } from "../src/oauth-handler";
import OAuthProvider from "../src/oauth-provider";
import { AUTHORIZE_COOKIE, LOGIN_COOKIE } from "../src/workers-oauth-utils";
import {
	BASE,
	type FetchCall,
	type Jar,
	REDIRECT,
	type UpstreamWorld,
	authorizeQuery,
	call,
	defaultWorld,
	dialogState,
	installUpstream,
	loginForCode,
	makeEnv,
	providerOptions,
	registerClient,
	s256,
	startLogin,
} from "./oauthTestKit";

/**
 * The browser side of the login, through the real OAuthProvider and OauthHandler, with the
 * providers stubbed. Items from .claude/notes/doauth-protocol-fixes.md: C1 (state kept on the
 * server, single use, bound to the browser), C2 (/authorize validation), H2 (the provider picker),
 * L1 (X PKCE verifier per login), L2 (one Set-Cookie header per cookie), M1 (who the user is),
 * L4 (no emails in the logs).
 */

const provider = new OAuthProvider(providerOptions());

let env: any;
let world: UpstreamWorld;
let calls: FetchCall[];
let clientId: string;

beforeEach(async () => {
	env = makeEnv();
	world = defaultWorld();
	calls = installUpstream(world);
	clientId = await registerClient(provider, env);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const upstreamCalls = () => calls.filter((c) => !c.url.startsWith(BASE));

describe("C1: the login state stays on the server", () => {
	it("completes a login and returns the client's state with a code", async () => {
		const code = await loginForCode(provider, env, clientId);
		expect(code.split(":")).toHaveLength(3);
	});

	it("refuses a callback whose state has no matching cookie, without contacting the provider", async () => {
		const { state } = await startLogin(provider, env, clientId, "google", new Map());
		const res = await call(provider, env, `/callback?code=c&state=${state}`, {}, new Map());
		expect(res.status).toBe(400);
		expect(upstreamCalls()).toHaveLength(0);
	});

	it("refuses the old forged state: the whole request, base64 JSON", async () => {
		const forged = btoa(
			JSON.stringify({
				clientId,
				provider: "google",
				authReqInfo: {
					clientId,
					redirectUri: "https://evil.example/cb",
					responseType: "code",
				},
			}),
		);
		const res = await call(
			provider,
			env,
			`/callback?code=c&state=${encodeURIComponent(forged)}`,
		);
		expect(res.status).toBe(400);
		expect(upstreamCalls()).toHaveLength(0);
	});

	it("accepts a callback once: a replay with the same state and cookie is refused", async () => {
		const jar: Jar = new Map();
		const { state } = await startLogin(provider, env, clientId, "google", jar);
		const cookie = jar.get(LOGIN_COOKIE);
		const first = await call(provider, env, `/callback?code=c&state=${state}`, {}, jar);
		expect(first.status).toBe(302);

		const replayJar: Jar = new Map([[LOGIN_COOKIE, cookie ?? ""]]);
		const replay = await call(provider, env, `/callback?code=c&state=${state}`, {}, replayJar);
		expect(replay.status).toBe(400);
	});

	it("clears the login cookie once the callback is used", async () => {
		const jar: Jar = new Map();
		const { state } = await startLogin(provider, env, clientId, "google", jar);
		expect(jar.has(LOGIN_COOKIE)).toBe(true);
		await call(provider, env, `/callback?code=c&state=${state}`, {}, jar);
		expect(jar.has(LOGIN_COOKIE)).toBe(false);
	});

	it("refuses a provider choice posted without the dialog's cookie (another site's form)", async () => {
		const page = await call(
			provider,
			env,
			`/authorize?${await authorizeQuery(clientId)}`,
			{},
			new Map(),
		);
		const state = dialogState(await page.text());
		const res = await call(provider, env, "/authorize", {
			method: "POST",
			body: new URLSearchParams({ provider: "google", state }),
		});
		expect(res.status).toBe(400);
		expect(res.headers.get("location")).toBeNull();
	});

	it("accepts a provider choice once", async () => {
		const jar: Jar = new Map();
		const page = await call(
			provider,
			env,
			`/authorize?${await authorizeQuery(clientId)}`,
			{},
			jar,
		);
		const state = dialogState(await page.text());
		const cookie = jar.get(AUTHORIZE_COOKIE) ?? "";
		const post = (j: Jar) =>
			call(
				provider,
				env,
				"/authorize",
				{ method: "POST", body: new URLSearchParams({ provider: "google", state }) },
				j,
			);
		expect((await post(jar)).status).toBe(302);
		expect((await post(new Map([[AUTHORIZE_COOKIE, cookie]]))).status).toBe(400);
	});

	it("refuses an unknown provider", async () => {
		const jar: Jar = new Map();
		const page = await call(
			provider,
			env,
			`/authorize?${await authorizeQuery(clientId)}`,
			{},
			jar,
		);
		const res = await call(
			provider,
			env,
			"/authorize",
			{
				method: "POST",
				body: new URLSearchParams({
					provider: "evil",
					state: dialogState(await page.text()),
				}),
			},
			jar,
		);
		expect(res.status).toBe(400);
	});

	it("sends only a random value to the provider as state", async () => {
		const { location, state } = await startLogin(provider, env, clientId, "google", new Map());
		expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(location.href).not.toContain(encodeURIComponent(REDIRECT));
		expect(location.href).not.toContain(clientId);
	});
});

describe("L1: the X PKCE verifier belongs to its own login", () => {
	it("lets two concurrent X logins through one client finish, each with its own verifier", async () => {
		const a: Jar = new Map();
		const b: Jar = new Map();
		const loginA = await startLogin(provider, env, clientId, "twitter", a);
		const loginB = await startLogin(provider, env, clientId, "twitter", b);
		const challengeA = loginA.location.searchParams.get("code_challenge") ?? "";
		const challengeB = loginB.location.searchParams.get("code_challenge") ?? "";
		expect(challengeA).not.toBe(challengeB);
		world.xChallenges.set("x-code-a", challengeA);
		world.xChallenges.set("x-code-b", challengeB);

		const resA = await call(
			provider,
			env,
			`/callback?code=x-code-a&state=${loginA.state}`,
			{},
			a,
		);
		const resB = await call(
			provider,
			env,
			`/callback?code=x-code-b&state=${loginB.state}`,
			{},
			b,
		);
		expect(resA.status).toBe(302);
		expect(resB.status).toBe(302);
	});

	it("no longer uses CODE_VERIFIER_KV", async () => {
		env.CODE_VERIFIER_KV = {
			get: vi.fn(),
			put: vi.fn(),
			delete: vi.fn(),
		};
		const jar: Jar = new Map();
		const login = await startLogin(provider, env, clientId, "twitter", jar);
		world.xChallenges.set("x-code", login.location.searchParams.get("code_challenge") ?? "");
		await call(provider, env, `/callback?code=x-code&state=${login.state}`, {}, jar);
		expect(env.CODE_VERIFIER_KV.put).not.toHaveBeenCalled();
		expect(env.CODE_VERIFIER_KV.get).not.toHaveBeenCalled();
	});
});

describe("L2: one Set-Cookie header per cookie", () => {
	it("sends the cleared dialog cookie and the login cookie as separate headers", async () => {
		const { res } = await startLogin(provider, env, clientId, "google", new Map());
		const cookies = res.headers.getSetCookie();
		expect(cookies).toHaveLength(2);
		expect(cookies.some((c) => c.startsWith(`${AUTHORIZE_COOKIE}=;`))).toBe(true);
		expect(
			cookies.some((c) => c.startsWith(`${LOGIN_COOKIE}=`) && c.includes("Max-Age=600")),
		).toBe(true);
	});
});

describe("C2: GET /authorize validates the request and never redirects an error", () => {
	async function authorize(params: Record<string, string>, drop: string[] = []) {
		const query = new URLSearchParams(await authorizeQuery(clientId, params));
		for (const name of drop) query.delete(name);
		return call(provider, env, `/authorize?${query}`);
	}

	const refused = async (res: Response, text: RegExp) => {
		expect(res.status).toBe(400);
		expect(res.headers.get("location")).toBeNull();
		expect(await res.text()).toMatch(text);
	};

	it("refuses a missing or unknown client", async () => {
		await refused(await authorize({}, ["client_id"]), /Missing client_id/);
		await refused(await authorize({ client_id: "nope" }), /Unknown client/);
	});

	it("refuses a redirect URI the client did not register (exact match)", async () => {
		await refused(
			await authorize({ redirect_uri: "https://evil.example/cb" }),
			/not registered/,
		);
		await refused(await authorize({ redirect_uri: `${REDIRECT}/` }), /not registered/);
		await refused(await authorize({ redirect_uri: `${REDIRECT}?x=1` }), /not registered/);
	});

	it("uses the only registered redirect URI when none is sent, and refuses that with two", async () => {
		const ok = await authorize({}, ["redirect_uri"]);
		expect(ok.status).toBe(200);

		const two = (await (
			await call(provider, env, "/register", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					redirect_uris: [REDIRECT, "https://client.example/other"],
					token_endpoint_auth_method: "none",
				}),
			})
		).json()) as { client_id: string };
		await refused(
			await authorize({ client_id: two.client_id }, ["redirect_uri"]),
			/Missing redirect_uri/,
		);
	});

	it("refuses a missing or unsupported response type, the implicit flow included", async () => {
		await refused(await authorize({}, ["response_type"]), /Missing response_type/);
		await refused(await authorize({ response_type: "token" }), /authorization code flow/);
		await refused(await authorize({ response_type: "id_token" }), /authorization code flow/);
	});

	it("D1: requires PKCE with S256 (a missing method means plain, RFC 7636 §4.3)", async () => {
		await refused(await authorize({}, ["code_challenge"]), /PKCE is required/);
		await refused(await authorize({ code_challenge_method: "plain" }), /only S256/);
		await refused(await authorize({}, ["code_challenge_method"]), /only S256/);
	});

	it("shows the dialog for a valid request, with a dialog cookie", async () => {
		const jar: Jar = new Map();
		const res = await call(
			provider,
			env,
			`/authorize?${await authorizeQuery(clientId)}`,
			{},
			jar,
		);
		expect(res.status).toBe(200);
		expect(jar.get(AUTHORIZE_COOKIE)).toBe(dialogState(await res.text()));
	});
});

describe("H2: the provider picker", () => {
	it("always shows, even with the old remembered-approval cookies, and clears them", async () => {
		const jar: Jar = new Map([
			["mcp-approved-clients", "sig.payload"],
			["mcp-provider-preference", "google"],
		]);
		const res = await call(
			provider,
			env,
			`/authorize?${await authorizeQuery(clientId)}`,
			{},
			jar,
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("location")).toBeNull();
		expect(jar.has("mcp-approved-clients")).toBe(false);
		expect(jar.has("mcp-provider-preference")).toBe(false);
	});

	it("is not cacheable and cannot be framed", async () => {
		const res = await call(provider, env, `/authorize?${await authorizeQuery(clientId)}`);
		expect(res.headers.get("Cache-Control")).toBe("no-store");
		expect(res.headers.get("X-Frame-Options")).toBe("DENY");
		expect(res.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
	});

	it("links only http(s) client pages: a stored javascript: URL is not rendered", async () => {
		// A client stored before registration checked its URLs
		await env.OAUTH_KV.put(
			"client:old-client",
			JSON.stringify({
				clientId: "old-client",
				redirectUris: [REDIRECT],
				clientName: "Old <b>Client</b>",
				tosUri: "javascript:alert(document.cookie)",
				clientUri: "data:text/html,<script>alert(1)</script>",
				policyUri: "https://client.example/privacy",
				tokenEndpointAuthMethod: "none",
			}),
		);
		const res = await call(provider, env, `/authorize?${await authorizeQuery("old-client")}`);
		const html = await res.text();
		expect(html).not.toContain("javascript:");
		expect(html).not.toContain("data:text/html");
		expect(html).toContain('href="https://client.example/privacy"');
		expect(html).toContain("Old &lt;b&gt;Client&lt;/b&gt;");
	});

	it("shows the client's own links only, where the user will be sent, and that the name is unverified", async () => {
		const res = await call(provider, env, `/authorize?${await authorizeQuery(clientId)}`);
		const html = await res.text();
		expect(html).not.toContain("http://goplausible.com/policy");
		expect(html).not.toContain('href="https://algorandmcp.goplausible.xyz"');
		expect(html).toContain("you will be sent to <strong>https://client.example</strong>");
		expect(html).toContain("has not verified it");
		expect(html).not.toContain("provider_preference");
	});
});

describe("M1: who the user is", () => {
	async function finish(upstream: string, code = "upstream-code") {
		const jar: Jar = new Map();
		const login = await startLogin(provider, env, clientId, upstream, jar);
		if (upstream === "twitter") {
			world.xChallenges.set(code, login.location.searchParams.get("code_challenge") ?? "");
		}
		return call(provider, env, `/callback?code=${code}&state=${login.state}`, {}, jar);
	}

	it("GitHub: refuses an account whose only addresses are unverified, even a public primary one", async () => {
		world.github.user.email = "public@example.com";
		world.github.emails = [
			{ email: "public@example.com", primary: true, verified: false },
			{ email: "other@example.com", primary: false, verified: false },
		];
		expect((await finish("github")).status).toBe(400);
	});

	it("GitHub: names the account by a verified address", async () => {
		world.github.emails = [
			{ email: "unverified@example.com", primary: true, verified: false },
			{ email: "verified@example.com", primary: false, verified: true },
		];
		expect((await finish("github")).status).toBe(302);
	});

	it("GitHub: picks the verified public address, else the verified primary, else any verified one", () => {
		const emails = [
			{ email: "a@example.com", primary: false, verified: true },
			{ email: "p@example.com", primary: true, verified: true },
			{ email: "pub@example.com", primary: false, verified: true },
			{ email: "u@example.com", primary: false, verified: false },
		];
		expect(pickVerifiedGitHubEmail(emails, "pub@example.com")).toBe("pub@example.com");
		expect(pickVerifiedGitHubEmail(emails, "u@example.com")).toBe("p@example.com");
		expect(pickVerifiedGitHubEmail(emails.slice(0, 1), null)).toBe("a@example.com");
		expect(pickVerifiedGitHubEmail([emails[3]], "u@example.com")).toBe("");
		expect(pickVerifiedGitHubEmail({ message: "Bad credentials" }, null)).toBe("");
	});

	it("Google: refuses verified_email: false", async () => {
		world.google.verified_email = false;
		expect((await finish("google")).status).toBe(400);
	});

	it("LinkedIn: refuses a missing email and email_verified: false", async () => {
		world.linkedin.email = undefined;
		expect((await finish("linkedin")).status).toBe(400);
		world.linkedin.email = "lin@example.com";
		world.linkedin.email_verified = false;
		expect((await finish("linkedin")).status).toBe(400);
		world.linkedin.email_verified = true;
		expect((await finish("linkedin")).status).toBe(302);
	});

	it("refuses a login without the provider's user ID", async () => {
		world.google.id = undefined;
		expect((await finish("google")).status).toBe(400);
		world.x.data.id = undefined;
		expect((await finish("twitter", "x-no-id")).status).toBe(400);
	});

	it("X: names the account by the username", async () => {
		expect((await finish("twitter", "x-ok")).status).toBe(302);
	});
});

describe("L4: no emails in the logs", () => {
	it("logs no address during a login", async () => {
		const lines: string[] = [];
		for (const level of ["log", "info", "warn", "error"] as const) {
			vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
				lines.push(
					args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "),
				);
			});
		}
		await loginForCode(provider, env, clientId);
		expect(lines.length).toBeGreaterThan(0);
		expect(lines.join("\n")).not.toContain("alice@example.com");
	});
});

it("computes S256 as RFC 7636 Appendix B does", async () => {
	expect(await s256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
		"E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
	);
});
