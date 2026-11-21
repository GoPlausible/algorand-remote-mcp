// Part of the dOAuth login layer: master in doauth/client-worker/src, synced unchanged into
// algorand-remote-mcp and algorand-remote-mcp-lite by doauth's scripts/sync-oauth-provider.mjs.
import { DurableObject } from "cloudflare:workers";

/**
 * Holds one pending login step (an authorization request waiting for the provider picker, or a
 * login waiting for the provider's callback). One object per random value, named by
 * `<prefix><value>`, so each step has its own strongly consistent storage.
 *
 * `take` reads and deletes in one synchronous step, and an object runs one call at a time, so a
 * record is returned at most once: the strict single use RFC 6749 §10.12 and RFC 9700 §4.7.1 ask
 * of `state`. Workers KV can't give that, being eventually consistent across locations.
 *
 * Ported from doauth's client-worker/src/pending-logins.ts.
 */
export class PendingLogins extends DurableObject {
	/** Stores the record; it expires after `ttlSeconds` */
	async put(record: unknown, ttlSeconds: number): Promise<void> {
		const expiresAt = Date.now() + ttlSeconds * 1000;
		this.ctx.storage.kv.put("pending", { record, expiresAt });
		await this.ctx.storage.setAlarm(expiresAt);
	}

	/** Returns the record and deletes it, or null if there is none or it has expired */
	async take(): Promise<unknown | null> {
		// No await between reading and deleting: no other call can see the record in between
		const pending = this.ctx.storage.kv.get("pending") as
			| { record: unknown; expiresAt: number }
			| undefined;
		this.ctx.storage.kv.delete("pending");
		await this.ctx.storage.deleteAlarm();
		if (!pending || pending.expiresAt <= Date.now()) return null;
		return pending.record;
	}

	/** Expiry: the record was never taken */
	async alarm(): Promise<void> {
		this.ctx.storage.kv.delete("pending");
	}
}
