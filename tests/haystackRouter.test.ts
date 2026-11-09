import { RouterClient } from "@txnlab/haystack-router";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/types";

// Test the router client factory logic
import { getRouterClient } from "../src/tools/apiManager/hayrouter/routerClient";

const MISSING_KEY_ERROR =
	"HAYSTACK_API_KEY is not configured. Set it as a Worker secret (the free-tier key is listed in the @txnlab/haystack-router README).";

// getRouterClient memoizes one RouterClient per ALGORAND_NETWORK for the life of the module.
// Tests that inspect a newly built client use a network name no other test uses, so the
// result does not depend on test order.

// Minimal env for testing
const testEnv: Env = {
	AlgorandRemoteMCP: {} as any,
	ALGORAND_NETWORK: "mainnet",
	ALGORAND_ALGOD: "https://mainnet-api.algonode.cloud",
	ALGORAND_ALGOD_API: "https://mainnet-api.algonode.cloud/v2",
	VAULT_OIDC_ACCESSOR: "test",
	HAYSTACK_API_KEY: "test-haystack-api-key",
};

// RouterClient keeps its resolved config in a field that is private in its type declarations
// (@txnlab/haystack-router 2.0.5); read it to check what getRouterClient passed in.
type RouterConfig = { apiKey: string; algodUri: string; autoOptIn: boolean };
function routerConfig(client: RouterClient): RouterConfig {
	return (client as unknown as { config: RouterConfig }).config;
}

describe("Haystack Router Client", () => {
	it("should create a RouterClient instance", () => {
		const client = getRouterClient(testEnv);
		expect(client).toBeDefined();
		expect(client).toBeInstanceOf(RouterClient);
	});

	it("should return the same instance for the same network (memoization)", () => {
		const client1 = getRouterClient(testEnv);
		const client2 = getRouterClient(testEnv);
		expect(client1).toBe(client2);
	});

	it("should use custom API key when provided", () => {
		const envWithKey: Env = {
			...testEnv,
			HAYSTACK_API_KEY: "custom-api-key-12345",
			ALGORAND_NETWORK: "testnet-haystack", // different network to avoid memoization
		};
		const client = getRouterClient(envWithKey);
		expect(client).toBeDefined();
		expect(routerConfig(client).apiKey).toBe("custom-api-key-12345");
		expect(routerConfig(client).autoOptIn).toBe(true);
	});

	it("should use custom algod URI when provided", () => {
		const envWithAlgod: Env = {
			...testEnv,
			ALGORAND_ALGOD: "https://custom-algod.example.com",
			ALGORAND_NETWORK: "custom-net", // different network to avoid memoization
		};
		const client = getRouterClient(envWithAlgod);
		expect(client).toBeDefined();
		expect(routerConfig(client).algodUri).toBe("https://custom-algod.example.com");
	});

	it("should throw when HAYSTACK_API_KEY is missing or empty", () => {
		const { HAYSTACK_API_KEY: _omitted, ...rest } = testEnv;
		const envWithoutKey: Env = { ...rest, ALGORAND_NETWORK: "no-key-net" };
		expect(() => getRouterClient(envWithoutKey)).toThrow(MISSING_KEY_ERROR);
		expect(() => getRouterClient({ ...envWithoutKey, HAYSTACK_API_KEY: "" })).toThrow(
			MISSING_KEY_ERROR,
		);
	});

	it("should throw without HAYSTACK_API_KEY even when a client is memoized for the network", () => {
		const network = "memoized-then-no-key-net";
		const client = getRouterClient({ ...testEnv, ALGORAND_NETWORK: network });
		expect(client).toBeInstanceOf(RouterClient);
		expect(() =>
			getRouterClient({ ...testEnv, ALGORAND_NETWORK: network, HAYSTACK_API_KEY: undefined }),
		).toThrow(MISSING_KEY_ERROR);
	});
});
