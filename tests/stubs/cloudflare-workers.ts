/**
 * Stand-in for the Workers runtime module `cloudflare:workers`, which Node lacks. vitest.config.ts
 * aliases the module here, so source files that import it load under Node.
 */

export class WorkerEntrypoint {
	ctx: unknown;
	env: unknown;

	constructor(ctx?: unknown, env?: unknown) {
		this.ctx = ctx;
		this.env = env;
	}
}

/** Keeps `ctx` and `env` as the runtime's base class does; tests pass a fake `ctx.storage` */
export class DurableObject<Env = unknown> {
	ctx: any;
	env: Env;

	constructor(ctx: any, env: Env) {
		this.ctx = ctx;
		this.env = env;
	}
}
