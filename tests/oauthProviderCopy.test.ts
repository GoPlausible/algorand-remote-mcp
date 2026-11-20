import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * src/oauth-provider.ts is a synced copy of the dOAuth protocol's master
 * (doauth/client-worker/src/oauth-provider.ts, decision D2). Every server on the shared token store
 * runs the same bytes, so the copy must never be edited here.
 */
describe("oauth-provider.ts copy", () => {
	it("matches the hash recorded when it was synced from doauth's master", () => {
		const copy = readFileSync(new URL("../src/oauth-provider.ts", import.meta.url));
		const recorded = readFileSync(
			new URL("../src/oauth-provider.sha256", import.meta.url),
			"utf8",
		).trim();
		const actual = createHash("sha256").update(copy).digest("hex");
		expect(
			actual,
			"src/oauth-provider.ts was edited locally: edit doauth/client-worker/src/oauth-provider.ts instead, then run node scripts/sync-oauth-provider.mjs in doauth",
		).toBe(recorded);
	});
});
