import { RouterClient } from "@txnlab/haystack-router";
import type { Env } from "../../../types";

// Memoized RouterClient instances per network
const routerClients = new Map<string, RouterClient>();

export function getRouterClient(env: Env): RouterClient {
	if (!env.HAYSTACK_API_KEY) {
		throw new Error(
			"HAYSTACK_API_KEY is not configured. Set it as a Worker secret (the free-tier key is listed in the @txnlab/haystack-router README).",
		);
	}
	const network = env.ALGORAND_NETWORK || "mainnet";
	let client = routerClients.get(network);
	if (!client) {
		const config: any = {
			apiKey: env.HAYSTACK_API_KEY,
			autoOptIn: true,
		};
		if (env.ALGORAND_ALGOD) {
			config.algodUri = env.ALGORAND_ALGOD;
		}
		client = new RouterClient(config);
		routerClients.set(network, client);
	}
	return client;
}
