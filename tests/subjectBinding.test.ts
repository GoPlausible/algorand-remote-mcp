import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerWalletTools } from "../src/tools/walletManager";
import {
	checkSubjectBinding,
	ensureUserAccount,
	subjectBindingKey,
} from "../src/utils/vaultManager";
import { type FetchCall, defaultWorld, installUpstream, memoryKV } from "./oauthTestKit";

/**
 * M2 in .claude/notes/doauth-protocol-fixes.md: each Vault account is bound to the provider's
 * permanent user ID (VAULT_ENTITIES `sub:<provider>:<entityId>`, the protocol's key), so a
 * recycled email or X handle can't inherit a wallet. Also the wallet_logout tool, which now
 * revokes the session itself, by the same rules as /logout (C4).
 */

const EMAIL = "alice@example.com";
const SUBJECT = "google-user-1";

/** The Vault worker, as far as these calls need it: it records entities in VAULT_ENTITIES */
function vaultWorker(entities: ReturnType<typeof memoryKV>, newEntityId = "ent-new") {
	const publicKey = Buffer.alloc(32, 7).toString("base64");
	const requests: { method: string; url: string }[] = [];
	return {
		requests,
		async fetch(url: string, init: RequestInit = {}) {
			const method = init.method ?? "GET";
			requests.push({ method, url });
			const path = new URL(url).pathname;
			if (method === "POST" && path === "/google/v1/identity/entity") {
				await entities.put(`google--${EMAIL}`, newEntityId);
				await entities.put(`google--${newEntityId}`, `role-${newEntityId}`);
				return Response.json({ data: { id: newEntityId } });
			}
			if (method === "GET" && path === `/google/transit/publickey/${EMAIL}`) {
				return Response.json({ public_key: publicKey });
			}
			if (method === "POST" && path === "/google/transit/keypair") return Response.json({});
			if (method === "DELETE") return Response.json({});
			return new Response("not found", { status: 404 });
		},
	};
}

function vaultEnv() {
	const entities = memoryKV();
	return {
		entities,
		env: {
			VAULT_ENTITIES: entities,
			HCV_WORKER: vaultWorker(entities),
			HCV_WORKER_URL: "https://vault.test",
		} as any,
	};
}

describe("checkSubjectBinding", () => {
	it("uses the protocol's key", () => {
		expect(subjectBindingKey("google", "ent-1")).toBe("sub:google:ent-1");
	});

	it("lets a new user through without writing anything: the account doesn't exist yet", async () => {
		const { env, entities } = vaultEnv();
		expect(await checkSubjectBinding(env, "google", EMAIL, SUBJECT)).toBeNull();
		expect(entities.m.size).toBe(0);
	});

	it("binds an older account to its first user", async () => {
		const { env, entities } = vaultEnv();
		await entities.put(`google--${EMAIL}`, "ent-old");
		expect(await checkSubjectBinding(env, "google", EMAIL, SUBJECT)).toBeNull();
		expect(entities.m.get("sub:google:ent-old")).toBe(SUBJECT);
	});

	it("lets the bound user through", async () => {
		const { env, entities } = vaultEnv();
		await entities.put(`google--${EMAIL}`, "ent-old");
		await entities.put("sub:google:ent-old", SUBJECT);
		expect(await checkSubjectBinding(env, "google", EMAIL, SUBJECT)).toBeNull();
	});

	it("refuses another provider user with the same email: a recycled address", async () => {
		const { env, entities } = vaultEnv();
		await entities.put(`google--${EMAIL}`, "ent-old");
		await entities.put("sub:google:ent-old", SUBJECT);
		expect(await checkSubjectBinding(env, "google", EMAIL, "google-user-2")).toMatch(
			/different google user/,
		);
		expect(entities.m.get("sub:google:ent-old")).toBe(SUBJECT);
	});

	it("refuses a session without a user ID, or without the account store", async () => {
		const { env } = vaultEnv();
		expect(await checkSubjectBinding(env, "google", EMAIL, "")).toMatch(/user ID/);
		expect(await checkSubjectBinding({} as any, "google", EMAIL, SUBJECT)).toMatch(/store/);
	});
});

describe("ensureUserAccount", () => {
	it("binds a new account to the provider user when it creates it", async () => {
		const { env, entities } = vaultEnv();
		await ensureUserAccount(env, EMAIL, "google", SUBJECT);
		expect(entities.m.get(`google--${EMAIL}`)).toBe("ent-new");
		expect(entities.m.get("sub:google:ent-new")).toBe(SUBJECT);
		// and the same user passes the check from then on, another doesn't
		expect(await checkSubjectBinding(env, "google", EMAIL, SUBJECT)).toBeNull();
		expect(await checkSubjectBinding(env, "google", EMAIL, "google-user-2")).not.toBeNull();
	});
});

/** Registers the wallet tools on a stand-in server and returns their handlers */
async function walletTools(env: any, props: Record<string, unknown>) {
	const tools = new Map<string, (...args: unknown[]) => Promise<any>>();
	const server = {
		tool: (name: string, ...rest: unknown[]) => {
			tools.set(name, rest[rest.length - 1] as (...args: unknown[]) => Promise<any>);
		},
	};
	await registerWalletTools(server as any, env, props as any);
	return tools;
}

const props = {
	email: EMAIL,
	provider: "google",
	id: SUBJECT,
	clientId: "client-1",
	name: "Alice",
	accessToken: "google-access-token",
};

describe("wallet_reset_account", () => {
	it("moves the binding to the new account", async () => {
		const { env, entities } = vaultEnv();
		await entities.put(`google--${EMAIL}`, "ent-old");
		await entities.put("google--ent-old", "role-old");
		await entities.put("sub:google:ent-old", SUBJECT);

		const tools = await walletTools(env, props);
		const result = await tools.get("wallet_reset_account")?.({});
		expect(JSON.stringify(result)).not.toContain("Failed to reset");

		expect(entities.m.has("sub:google:ent-old")).toBe(false);
		expect(entities.m.get("sub:google:ent-new")).toBe(SUBJECT);
	});
});

describe("wallet_logout", () => {
	let calls: FetchCall[];

	beforeEach(() => {
		calls = installUpstream(defaultWorld());
	});

	afterEach(() => vi.unstubAllGlobals());

	it("revokes this user's grants for this client and the upstream token, without calling /logout", async () => {
		const kv = memoryKV();
		const grant = (id: string, clientId: string, userId = SUBJECT, provider = "google") =>
			kv.m.set(
				`grant:${userId}:${id}`,
				JSON.stringify({ id, clientId, userId, scope: [], metadata: { provider } }),
			);
		grant("g1", "client-1");
		grant("g2", "client-1");
		kv.m.set(`token:${SUBJECT}:g1:t1`, "{}");
		grant("g3", "client-2");
		grant("g4", "client-1", SUBJECT, "github");
		grant("g5", "client-1", `${SUBJECT}0`);

		const tools = await walletTools({ OAUTH_KV: kv } as any, props);
		const result = await tools.get("wallet_logout")?.({});
		expect(JSON.stringify(result)).toContain("Successfully logged out");

		const keys = [...kv.m.keys()];
		expect(keys).not.toContain(`grant:${SUBJECT}:g1`);
		expect(keys).not.toContain(`grant:${SUBJECT}:g2`);
		expect(keys).not.toContain(`token:${SUBJECT}:g1:t1`);
		expect(keys).toContain(`grant:${SUBJECT}:g3`);
		expect(keys).toContain(`grant:${SUBJECT}:g4`);
		expect(keys).toContain(`grant:${SUBJECT}0:g5`);

		expect(calls.some((c) => c.url.startsWith("https://oauth2.googleapis.com/revoke"))).toBe(
			true,
		);
		expect(calls.some((c) => c.url.includes("/logout"))).toBe(false);
	});
});
