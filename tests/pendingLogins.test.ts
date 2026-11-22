import { afterEach, describe, expect, it, vi } from "vitest";
import { PendingLogins } from "../src/pending-logins";
import {
	AUTHORIZE_COOKIE,
	AUTHORIZE_KEY_PREFIX,
	clearPendingCookie,
	generatePendingValue,
	pendingCookie,
	pendingCookieName,
	storePendingRecord,
	takePendingRecord,
} from "../src/workers-oauth-utils";
import { objectStorage, pendingLoginsNamespace } from "./oauthTestKit";

/**
 * C1 in .claude/notes/doauth-protocol-fixes.md: a login step's record is kept on the server, is
 * taken at most once, only with the matching cookie, and only for 10 minutes.
 */

function object() {
	const storage = objectStorage();
	return { storage, logins: new PendingLogins({ storage } as any, {} as any) };
}

afterEach(() => vi.restoreAllMocks());

describe("PendingLogins", () => {
	it("returns a stored record once, then null", async () => {
		const { logins, storage } = object();
		await logins.put({ clientId: "c1" }, 600);
		expect(storage.alarm).not.toBeNull();
		expect(await logins.take()).toEqual({ clientId: "c1" });
		expect(await logins.take()).toBeNull();
		expect(storage.alarm).toBeNull();
	});

	it("returns null for an expired record, and deletes it", async () => {
		const { logins, storage } = object();
		const now = Date.now();
		await logins.put({ clientId: "c1" }, 600);
		vi.spyOn(Date, "now").mockReturnValue(now + 600_001);
		expect(await logins.take()).toBeNull();
		expect(storage.data.size).toBe(0);
	});

	it("deletes a record that was never taken when its alarm fires", async () => {
		const { logins, storage } = object();
		await logins.put({ clientId: "c1" }, 600);
		await logins.alarm();
		expect(storage.data.size).toBe(0);
		expect(await logins.take()).toBeNull();
	});
});

describe("takePendingRecord", () => {
	const request = (cookie?: string) =>
		new Request("https://algorandmcp.goplausible.xyz/authorize", {
			headers: cookie ? { Cookie: cookie } : {},
		});

	it("needs the matching cookie, and works once", async () => {
		const ns = pendingLoginsNamespace() as any;
		const value = generatePendingValue();
		await storePendingRecord(ns, AUTHORIZE_KEY_PREFIX, value, { clientId: "c1" });

		const name = await pendingCookieName(AUTHORIZE_COOKIE, value);
		const cookie = `${name}=${value}`;
		expect(
			await takePendingRecord(ns, request(), AUTHORIZE_COOKIE, AUTHORIZE_KEY_PREFIX, value),
		).toBeNull();
		// Another value under this value's cookie name, and the single cookie name used before
		for (const wrong of [`${name}=${generatePendingValue()}`, `${AUTHORIZE_COOKIE}=${value}`]) {
			expect(
				await takePendingRecord(
					ns,
					request(wrong),
					AUTHORIZE_COOKIE,
					AUTHORIZE_KEY_PREFIX,
					value,
				),
			).toBeNull();
		}
		expect(
			await takePendingRecord(
				ns,
				request(cookie),
				AUTHORIZE_COOKIE,
				AUTHORIZE_KEY_PREFIX,
				value,
			),
		).toEqual({ clientId: "c1" });
		expect(
			await takePendingRecord(
				ns,
				request(cookie),
				AUTHORIZE_COOKIE,
				AUTHORIZE_KEY_PREFIX,
				value,
			),
		).toBeNull();
	});

	it("refuses malformed values without touching the store", async () => {
		const ns = pendingLoginsNamespace() as any;
		// The old format: the whole request, base64 JSON, in state
		const forged = btoa(JSON.stringify({ clientId: "c1", provider: "google" }));
		for (const value of [forged, "", "short", undefined, 42]) {
			expect(
				await takePendingRecord(
					ns,
					request(`${AUTHORIZE_COOKIE}=${String(value)}`),
					AUTHORIZE_COOKIE,
					AUTHORIZE_KEY_PREFIX,
					value,
				),
			).toBeNull();
		}
		expect(ns.objects.size).toBe(0);
	});

	it("keeps each record's cookie apart: taking one leaves the others usable", async () => {
		const ns = pendingLoginsNamespace() as any;
		const a = generatePendingValue();
		const b = generatePendingValue();
		await storePendingRecord(ns, AUTHORIZE_KEY_PREFIX, a, { clientId: "a" });
		await storePendingRecord(ns, AUTHORIZE_KEY_PREFIX, b, { clientId: "b" });
		const both = request(
			`${await pendingCookieName(AUTHORIZE_COOKIE, a)}=${a}; ${await pendingCookieName(AUTHORIZE_COOKIE, b)}=${b}`,
		);
		expect(
			await takePendingRecord(ns, both, AUTHORIZE_COOKIE, AUTHORIZE_KEY_PREFIX, b),
		).toEqual({ clientId: "b" });
		expect(
			await takePendingRecord(ns, both, AUTHORIZE_COOKIE, AUTHORIZE_KEY_PREFIX, a),
		).toEqual({ clientId: "a" });
	});
});

describe("pending values and cookies", () => {
	it("are 32 random bytes, base64url", () => {
		const a = generatePendingValue();
		expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(generatePendingValue()).not.toBe(a);
	});

	it("are __Host- cookies: HttpOnly, Secure, Path=/, SameSite=Lax, 10 minutes", async () => {
		expect(AUTHORIZE_COOKIE.startsWith("__Host-")).toBe(true);
		const value = generatePendingValue();
		const cookie = await pendingCookie(AUTHORIZE_COOKIE, value);
		expect(
			cookie.startsWith(`${await pendingCookieName(AUTHORIZE_COOKIE, value)}=${value};`),
		).toBe(true);
		for (const part of ["HttpOnly", "Secure", "Path=/", "SameSite=Lax", "Max-Age=600"]) {
			expect(cookie).toContain(part);
		}
		expect(cookie).not.toContain("Domain");
		const cleared = await clearPendingCookie(AUTHORIZE_COOKIE, value);
		expect(cleared.startsWith(`${await pendingCookieName(AUTHORIZE_COOKIE, value)}=;`)).toBe(
			true,
		);
		expect(cleared).toContain("Max-Age=0");
	});

	it("are named per value: the base, then 16 characters of the value's SHA-256, base64url", async () => {
		const value = generatePendingValue();
		const digest = new Uint8Array(
			await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
		);
		const tag = btoa(String.fromCharCode(...digest))
			.replace(/\+/g, "-")
			.replace(/\//g, "_")
			.slice(0, 16);
		const name = await pendingCookieName(AUTHORIZE_COOKIE, value);
		expect(name).toBe(`${AUTHORIZE_COOKIE}-${tag}`);
		expect(name).not.toContain(value.slice(0, 8));
		expect(await pendingCookieName(AUTHORIZE_COOKIE, generatePendingValue())).not.toBe(name);
	});
});
