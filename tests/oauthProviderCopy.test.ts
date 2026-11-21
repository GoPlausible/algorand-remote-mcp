import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * These files are synced copies of masters in doauth/client-worker/src, never edited here: the
 * protocol's OAuth provider (decision D2, 2026-11-20) and the login layer, the same on all three
 * dOAuth servers (2026-11-21). doauth's scripts/sync-oauth-provider.mjs copies them and records each
 * hash beside the copy. This repo is still the master of utils/vaultManager.ts, which lite copies.
 */
const SYNCED = [
	"oauth-provider.ts",
	"oauth-handler.ts",
	"workers-oauth-utils.ts",
	"pending-logins.ts",
] as const;

describe("synced dOAuth files", () => {
	it.each(SYNCED)("%s matches the hash recorded when it was synced", (file) => {
		const copy = readFileSync(new URL(`../src/${file}`, import.meta.url));
		const recorded = readFileSync(
			new URL(`../src/${file.replace(/\.ts$/, ".sha256")}`, import.meta.url),
			"utf8",
		).trim();
		const actual = createHash("sha256").update(copy).digest("hex");
		expect(
			actual,
			`src/${file} was edited locally: edit doauth/client-worker/src/${file} instead, then run node scripts/sync-oauth-provider.mjs in doauth`,
		).toBe(recorded);
	});
});
