import { describe, expect, it } from "vitest";
import type {
	AssetDetailsResponse,
	AssetVerificationResponse,
	EncodedSignedTransaction,
	EncodedTransaction,
	EntityCheckResponse,
	EntityResponse,
	Env,
	KeypairResponse,
	Props,
	PublicKeyResponse,
	SignatureResponse,
	State,
	VaultResponse,
	VerificationResponse,
} from "../src/types";

describe("Type Definitions", () => {
	it("should allow valid Env objects", () => {
		const env: Env = {
			AlgorandRemoteMCP: {} as any,
			ALGORAND_NETWORK: "mainnet",
			ALGORAND_ALGOD: "https://mainnet-api.algonode.cloud",
			ALGORAND_ALGOD_API: "https://mainnet-api.algonode.cloud/v2",
			VAULT_OIDC_ACCESSOR: "accessor",
		};
		expect(env.ALGORAND_NETWORK).toBe("mainnet");
		expect(env.HAYSTACK_API_KEY).toBeUndefined();
	});

	it("should allow Env with optional HAYSTACK_API_KEY", () => {
		const env: Env = {
			AlgorandRemoteMCP: {} as any,
			ALGORAND_NETWORK: "mainnet",
			ALGORAND_ALGOD: "https://mainnet-api.algonode.cloud",
			ALGORAND_ALGOD_API: "https://mainnet-api.algonode.cloud/v2",
			VAULT_OIDC_ACCESSOR: "accessor",
			HAYSTACK_API_KEY: "test-key",
		};
		expect(env.HAYSTACK_API_KEY).toBe("test-key");
	});

	it("should allow valid Props objects", () => {
		const props: Props = {
			name: "Test User",
			email: "test@example.com",
			accessToken: "token123",
			id: "user-id",
			clientId: "client-id",
			provider: "google",
		};
		expect(props.provider).toBe("google");
	});

	it("should allow valid State objects", () => {
		const state: State = {
			items_per_page: 10,
		};
		expect(state.items_per_page).toBe(10);
	});

	it("should allow valid KeypairResponse", () => {
		const success: KeypairResponse = { success: true, keyName: "test-key" };
		const failure: KeypairResponse = { success: false, keyName: "test-key", error: "Failed" };
		expect(success.success).toBe(true);
		expect(failure.error).toBe("Failed");
	});

	it("should allow valid PublicKeyResponse", () => {
		const response: PublicKeyResponse = { success: true, publicKey: "base64key" };
		expect(response.publicKey).toBe("base64key");
	});

	it("should allow valid SignatureResponse", () => {
		const response: SignatureResponse = { success: true, signature: "base64sig" };
		expect(response.signature).toBe("base64sig");
	});

	it("should allow valid VerificationResponse", () => {
		const response: VerificationResponse = { success: true, valid: true };
		expect(response.valid).toBe(true);
	});

	it("should allow valid EntityResponse", () => {
		const response: EntityResponse = {
			success: true,
			entityId: "entity-123",
			token: "token-456",
		};
		expect(response.entityId).toBe("entity-123");
	});

	it("should allow valid EntityCheckResponse", () => {
		const response: EntityCheckResponse = {
			success: true,
			exists: true,
			entityDetails: { name: "test" },
		};
		expect(response.exists).toBe(true);
	});

	it("should allow valid AssetVerificationResponse", () => {
		const response: AssetVerificationResponse = {
			asset_id: 31566704,
			verification_tier: "verified",
			explorer_url: "https://explorer.example.com",
		};
		expect(response.verification_tier).toBe("verified");
	});

	it("should allow valid AssetDetailsResponse", () => {
		const response: AssetDetailsResponse = {
			asset_id: 31566704,
			fraction_decimals: 6,
			total_supply: 10000000000,
			total_supply_as_str: "10000000000",
			creator_address: "ABCDEF...",
			verification_tier: "verified",
			is_collectible: false,
			circulating_supply: "5000000000",
			name: "USDC",
			unit_name: "USDC",
		};
		expect(response.name).toBe("USDC");
	});

	it("should allow valid EncodedTransaction", () => {
		const txn: EncodedTransaction = {
			lv: 2000,
			snd: Buffer.from("sender"),
			type: "pay",
			gen: "mainnet-v1.0",
			gh: Buffer.from("genesishash"),
		};
		expect(txn.type).toBe("pay");
	});

	it("should allow valid EncodedSignedTransaction", () => {
		const signedTxn: EncodedSignedTransaction = {
			txn: {
				lv: 2000,
				snd: Buffer.from("sender"),
				type: "pay",
				gen: "mainnet-v1.0",
				gh: Buffer.from("genesishash"),
			},
			sig: Buffer.from("signature"),
		};
		expect(signedTxn.sig).toBeDefined();
	});

	it("should allow EncodedSignedTransaction with sgnr field", () => {
		const signedTxn: EncodedSignedTransaction = {
			txn: {
				lv: 2000,
				snd: Buffer.from("sender"),
				type: "pay",
				gen: "mainnet-v1.0",
				gh: Buffer.from("genesishash"),
			},
			sig: Buffer.from("signature"),
			sgnr: Buffer.from("signer-public-key"),
		};
		expect(signedTxn.sgnr).toBeDefined();
	});
});
