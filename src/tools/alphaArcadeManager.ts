/**
 * Alpha Arcade Manager for Algorand Remote MCP
 * Prediction market tools using @alpha-arcade/sdk with vault-based signing
 */

import { AlphaClient } from "@alpha-arcade/sdk";
import * as algosdk from "algosdk";
import { z } from "zod";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Env, Props } from "../types";
import { getPublicKey, signWithTransit } from "../utils/vaultManager";

// ============================================
// Formatting helpers (microunits → human)
// ============================================

const formatPrice = (microunits: number): string => `$${(microunits / 1e6).toFixed(2)}`;
const formatQty = (microunits: number): string => `${(microunits / 1e6).toFixed(2)} shares`;
// yesProb / noProb from API are already in microunits (0–1000000)
const formatPriceFromProb = (microunits: number): string => `$${(microunits / 1e6).toFixed(2)}`;

// ============================================
// Alpha Arcade config
// ============================================

const MATCHER_APP_ID = 3078581851;
const USDC_ASSET_ID = 31566704;
const API_BASE_URL = "https://platform.alphaarcade.com/api";

const textResult = (text: string) => ({
	content: [{ type: "text" as const, text }],
});

// ============================================
// Client factories
// ============================================

function ConcatArrays(...arrs: ArrayLike<number>[]) {
	const size = arrs.reduce((sum, arr) => sum + arr.length, 0);
	const c = new Uint8Array(size);
	let offset = 0;
	for (let i = 0; i < arrs.length; i++) {
		c.set(arrs[i], offset);
		offset += arrs[i].length;
	}
	return c;
}

/**
 * Create a vault-backed TransactionSigner compatible with algosdk.TransactionSigner
 * Signs transactions using the user's vault key instead of a raw mnemonic
 */
function makeVaultSigner(env: Env, props: Props): algosdk.TransactionSigner {
	return async (
		txnGroup: algosdk.Transaction[],
		indexesToSign: number[],
	): Promise<Uint8Array[]> => {
		const signedTxns: Uint8Array[] = [];

		for (const idx of indexesToSign) {
			const txn = txnGroup[idx];
			const encodedTxn = algosdk.encodeUnsignedTransaction(txn);
			const TAG = Buffer.from("TX");
			const taggedTxn = ConcatArrays(TAG, encodedTxn);
			const taggedTxnBase64 = Buffer.from(taggedTxn).toString("base64");

			const signatureResult = await signWithTransit(
				env,
				taggedTxnBase64,
				props.email!,
				props.provider!,
			);
			if (!signatureResult.success || !signatureResult.signature) {
				throw new Error(`Failed to sign transaction at index ${idx} with vault`);
			}

			const signature = Buffer.from(signatureResult.signature, "base64");
			const stxn = new algosdk.SignedTransaction({ txn, sig: new Uint8Array(signature) });
			signedTxns.push(algosdk.encodeMsgpack(stxn));
		}

		return signedTxns;
	};
}

function createReadOnlyClient(env: Env): AlphaClient {
	const apiBase = env.ALPHA_API_BASE_URL || API_BASE_URL;
	const hasApiKey = !!env.ALPHA_API_KEY;
	console.log(
		`[Alpha] Creating read-only client — apiBaseUrl=${apiBase}, hasApiKey=${hasApiKey}`,
	);
	const algodClient = new algosdk.Algodv2(
		env.ALGORAND_TOKEN || "",
		env.ALGORAND_ALGOD || "https://mainnet-api.algonode.cloud",
		"",
	);
	const indexerClient = new algosdk.Indexer(
		"",
		env.ALGORAND_INDEXER || "https://mainnet-idx.algonode.cloud",
		"",
	);
	const dummySigner: algosdk.TransactionSigner = async () => [];
	return new AlphaClient({
		algodClient,
		indexerClient,
		signer: dummySigner,
		activeAddress: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ",
		matcherAppId: MATCHER_APP_ID,
		usdcAssetId: USDC_ASSET_ID,
		apiBaseUrl: apiBase,
		apiKey: env.ALPHA_API_KEY || undefined,
	});
}

async function createTradingClient(env: Env, props: Props): Promise<AlphaClient> {
	if (!props.email || !props.provider) {
		throw new Error("Wallet authentication required for trading operations.");
	}

	const publicKeyResult = await getPublicKey(env, props.email, props.provider);
	if (!publicKeyResult.success || !publicKeyResult.publicKey) {
		throw new Error("Failed to get wallet public key from vault");
	}

	const pubKeyBytes = Buffer.from(publicKeyResult.publicKey, "base64");
	const activeAddress = algosdk.encodeAddress(new Uint8Array(pubKeyBytes));

	const algodClient = new algosdk.Algodv2(
		env.ALGORAND_TOKEN || "",
		env.ALGORAND_ALGOD || "https://mainnet-api.algonode.cloud",
		"",
	);
	const indexerClient = new algosdk.Indexer(
		"",
		env.ALGORAND_INDEXER || "https://mainnet-idx.algonode.cloud",
		"",
	);

	return new AlphaClient({
		algodClient,
		indexerClient,
		signer: makeVaultSigner(env, props),
		activeAddress,
		matcherAppId: MATCHER_APP_ID,
		usdcAssetId: USDC_ASSET_ID,
		apiBaseUrl: env.ALPHA_API_BASE_URL || API_BASE_URL,
		apiKey: env.ALPHA_API_KEY || undefined,
	});
}

async function resolveWalletAddress(
	env: Env,
	props: Props,
	walletAddress?: string,
): Promise<string> {
	if (walletAddress) return walletAddress;
	if (!props.email || !props.provider) {
		throw new Error("No wallet address provided and no wallet configured.");
	}
	const publicKeyResult = await getPublicKey(env, props.email, props.provider);
	if (!publicKeyResult.success || !publicKeyResult.publicKey) {
		throw new Error("Failed to get wallet address from vault");
	}
	const pubKeyBytes = Buffer.from(publicKeyResult.publicKey, "base64");
	return algosdk.encodeAddress(new Uint8Array(pubKeyBytes));
}

// ============================================
// Friendly error messages for common blockchain errors
// ============================================

function friendlyTradeError(msg: string): string {
	const m = msg || "Unknown error";

	const isUsdcError = m.includes(String(USDC_ASSET_ID)) || /usdc/i.test(m);

	const overspendAlgo = m.match(/overspend.*?MicroAlgos:\{Raw:(\d+)\}.*?tried to spend \{(\d+)\}/i);
	if (overspendAlgo) {
		const have = (Number.parseInt(overspendAlgo[1], 10) / 1e6).toFixed(2);
		const need = (Number.parseInt(overspendAlgo[2], 10) / 1e6).toFixed(2);
		return `Insufficient ALGO balance. You have ~${have} ALGO but need ~${need} ALGO (escrow collateral + fees). Please fund your wallet with more ALGO.`;
	}
	const overspendAsset = m.match(/overspend.*?asset.*?(\d+).*?holding:\{Amount:(\d+)\}.*?tried to spend \{(\d+)\}/i);
	if (overspendAsset) {
		const assetId = overspendAsset[1];
		const have = (Number.parseInt(overspendAsset[2], 10) / 1e6).toFixed(2);
		const need = (Number.parseInt(overspendAsset[3], 10) / 1e6).toFixed(2);
		const label = assetId === String(USDC_ASSET_ID) ? "USDC" : `asset ${assetId}`;
		return `Insufficient ${label} balance. You have ~$${have} but need ~$${need}. Please add more ${label} to your wallet.`;
	}
	if (/overspend/i.test(m)) {
		const label = isUsdcError ? "USDC" : "ALGO";
		return `Insufficient ${label} balance to cover this transaction. Please add more ${label} to your wallet.`;
	}
	if (/underflow/i.test(m)) {
		const label = isUsdcError ? "USDC" : "token";
		return `Insufficient ${label} balance for this operation. Make sure you hold enough ${label} before trading.`;
	}
	if (/asset \d+ missing/i.test(m) || /not opted in/i.test(m)) {
		if (isUsdcError) {
			return "Your account hasn't opted in to USDC. Please opt in to USDC (asset 31566704) first.";
		}
		return "Your account hasn't opted in to a required asset. Please opt in first.";
	}
	if (/below min/i.test(m) || /min balance/i.test(m)) {
		return "This transaction would drop your account below the minimum ALGO balance. Please add more ALGO.";
	}
	if (/account.*has been closed/i.test(m) || /dead account/i.test(m)) {
		return "The target account has been closed and cannot receive transactions.";
	}
	if (/group size/i.test(m)) {
		return "Transaction group error. Please try again.";
	}
	if (/logic eval error/i.test(m) || /rejected by logic/i.test(m)) {
		return "The smart contract rejected this transaction. The order parameters may be invalid or the market conditions have changed. Please try again.";
	}
	if (/timeout/i.test(m) || /network/i.test(m) || /ECONNREFUSED/i.test(m)) {
		return "Network error reaching the Algorand node. Please try again in a moment.";
	}
	return m;
}

// ============================================
// Register tools
// ============================================

export function registerAlphaArcadeTools(
	server: McpServer,
	env: Env,
	props: Props,
): void {
	// ------------------------------------------
	// Read-only tools
	// ------------------------------------------

	server.tool(
		"alpha_get_live_markets",
		"Fetch all live Alpha Arcade prediction markets. Returns summary: id, title, marketAppId, prices, volume. Multi-choice markets have an options[] array — use options[].marketAppId for trading.",
		{},
		async () => {
			try {
				console.log("[Alpha] alpha_get_live_markets — starting");
				const client = createReadOnlyClient(env);
				let markets: any[];
				try {
					console.log("[Alpha] alpha_get_live_markets — calling getLiveMarkets()");
					markets = await client.getLiveMarkets();
					console.log(
						`[Alpha] alpha_get_live_markets — getLiveMarkets() returned ${markets.length} markets`,
					);
				} catch (apiErr: any) {
					console.warn(
						`[Alpha] alpha_get_live_markets — getLiveMarkets() failed: ${apiErr.message}`,
					);
					if (env.ALPHA_API_KEY) {
						console.log(
							"[Alpha] alpha_get_live_markets — falling back to getMarketsOnChain()",
						);
						markets = await client.getMarketsOnChain();
						console.log(
							`[Alpha] alpha_get_live_markets — getMarketsOnChain() returned ${markets.length} markets`,
						);
					} else {
						throw apiErr;
					}
				}
				const summary = markets.map((m) => {
					const vol =
						typeof m.volume === "number"
							? m.volume
							: Number.parseFloat(String(m.volume ?? ""));
					const entry: Record<string, unknown> = {
						id: m.id,
						title: m.title || `Market ${m.marketAppId}`,
						marketAppId: m.marketAppId,
						image: m.image,
						yesAssetId: m.yesAssetId || undefined,
						noAssetId: m.noAssetId || undefined,
						yesPrice: m.yesProb != null ? formatPriceFromProb(m.yesProb) : undefined,
						noPrice: m.noProb != null ? formatPriceFromProb(m.noProb) : undefined,
						volume: !Number.isNaN(vol) ? `$${vol.toFixed(2)}` : undefined,
						endsAt: m.endTs ? new Date(m.endTs * 1000).toISOString() : undefined,
						isResolved: m.isResolved ?? false,
						source: m.source ?? "unknown",
					};
					if (m.categories?.length) entry.categories = m.categories;
					if (m.feeBase != null) entry.feeBase = m.feeBase;
					if (m.options?.length)
						entry.options = m.options.map((o: any) => ({
							title: o.title || `Option ${o.marketAppId}`,
							marketAppId: o.marketAppId,
							yesAssetId: o.yesAssetId,
							noAssetId: o.noAssetId,
						}));
					return entry;
				});
				console.log(`[Alpha] alpha_get_live_markets — returning ${summary.length} markets`);
				return textResult(JSON.stringify(summary, null, 2));
			} catch (error: any) {
				console.error(
					`[Alpha] alpha_get_live_markets — error: ${error.message}`,
					error.stack,
				);
				return textResult(
					`Error fetching live markets: ${error.message || "Unknown error"}`,
				);
			}
		},
	);

	server.tool(
		"alpha_get_reward_markets",
		"Fetch Alpha Arcade markets with liquidity rewards (totalRewards, rewardsPaidOut, etc.). Same shape as alpha_get_live_markets but includes reward info.",
		{},
		async () => {
			try {
				console.log("[Alpha] alpha_get_reward_markets — starting");
				if (!env.ALPHA_API_KEY) {
					console.warn(
						"[Alpha] alpha_get_reward_markets — no API key, reward markets require API access",
					);
					return textResult(
						"Reward markets require an ALPHA_API_KEY. Set it in your environment to access reward market data.",
					);
				}
				const client = createReadOnlyClient(env);
				console.log("[Alpha] alpha_get_reward_markets — calling getRewardMarkets()");
				const markets = await client.getRewardMarkets();
				console.log(
					`[Alpha] alpha_get_reward_markets — returned ${markets.length} markets`,
				);
				const summary = markets.map((m) => {
					const vol =
						typeof m.volume === "number"
							? m.volume
							: Number.parseFloat(String(m.volume ?? ""));
					const entry: Record<string, unknown> = {
						id: m.id,
						title: m.title || `Market ${m.marketAppId}`,
						marketAppId: m.marketAppId,
						image: m.image,
						yesAssetId: m.yesAssetId || undefined,
						noAssetId: m.noAssetId || undefined,
						yesPrice: m.yesProb != null ? formatPriceFromProb(m.yesProb) : undefined,
						noPrice: m.noProb != null ? formatPriceFromProb(m.noProb) : undefined,
						volume: !Number.isNaN(vol) ? `$${vol.toFixed(2)}` : undefined,
						endsAt: m.endTs ? new Date(m.endTs * 1000).toISOString() : undefined,
						isResolved: m.isResolved ?? false,
						source: m.source ?? "unknown",
					};
					if (m.categories?.length) entry.categories = m.categories;
					if (m.feeBase != null) entry.feeBase = m.feeBase;
					if (m.totalRewards != null) entry.totalRewards = m.totalRewards;
					if (m.rewardsPaidOut != null) entry.rewardsPaidOut = m.rewardsPaidOut;
					if (m.rewardsSpreadDistance != null)
						entry.rewardsSpreadDistance = m.rewardsSpreadDistance;
					if (m.rewardsMinContracts != null)
						entry.rewardsMinContracts = m.rewardsMinContracts;
					if (m.lastRewardAmount != null) entry.lastRewardAmount = m.lastRewardAmount;
					if (m.lastRewardTs != null)
						entry.lastRewardTs = new Date(m.lastRewardTs).toISOString();
					if (m.options?.length)
						entry.options = m.options.map((o: any) => ({
							title: o.title || `Option ${o.marketAppId}`,
							marketAppId: o.marketAppId,
							yesAssetId: o.yesAssetId,
							noAssetId: o.noAssetId,
						}));
					return entry;
				});
				return textResult(JSON.stringify(summary, null, 2));
			} catch (error: any) {
				console.error(
					`[Alpha] alpha_get_reward_markets — error: ${error.message}`,
					error.stack,
				);
				return textResult(
					`Error fetching reward markets: ${error.message || "Unknown error"}`,
				);
			}
		},
	);

	server.tool(
		"alpha_get_market",
		"Fetch full details for a single Alpha Arcade prediction market. Pass marketAppId (numeric, always required) and optionally marketId (UUID) for richer API data.",
		{
			marketAppId: z
				.number()
				.describe("The market application ID (numeric, always required)"),
			marketId: z
				.string()
				.optional()
				.describe(
					"The market UUID (optional, used for API mode when ALPHA_API_KEY is set)",
				),
		},
		async ({ marketAppId, marketId }) => {
			try {
				console.log(
					`[Alpha] alpha_get_market — starting, marketAppId=${marketAppId}, marketId=${marketId ?? "(none)"}, hasApiKey=${!!env.ALPHA_API_KEY}`,
				);
				const client = createReadOnlyClient(env);
				let market: any = null;

				if (env.ALPHA_API_KEY && marketId) {
					try {
						console.log(
							`[Alpha] alpha_get_market — trying API with UUID "${marketId}"`,
						);
						market = await client.getMarketFromApi(marketId);
						console.log(
							`[Alpha] alpha_get_market — API returned: ${market ? "data" : "null"}`,
						);
					} catch (err: any) {
						console.warn(`[Alpha] alpha_get_market — API failed: ${err.message}`);
					}
				}

				if (!market) {
					console.log(
						`[Alpha] alpha_get_market — fetching on-chain with appId=${marketAppId}`,
					);
					market = await client.getMarketOnChain(marketAppId).catch((e: any) => {
						console.error(
							`[Alpha] alpha_get_market — getMarketOnChain() failed: ${e.message}`,
						);
						return null;
					});
				}

				if (!market) {
					return textResult(`Market ${marketAppId} not found.`);
				}
				return textResult(JSON.stringify(market, null, 2));
			} catch (error: any) {
				console.error(`[Alpha] alpha_get_market — error: ${error.message}`, error.stack);
				return textResult(`Error fetching market: ${error.message || "Unknown error"}`);
			}
		},
	);

	server.tool(
		"alpha_get_orderbook",
		"Fetch the on-chain orderbook as a unified YES-perspective view. Merges all 4 sides (YES bids/asks + NO bids/asks). Includes spread calculation.",
		{
			marketAppId: z.number().describe("The market app ID"),
		},
		async ({ marketAppId }) => {
			try {
				console.log(`[Alpha] alpha_get_orderbook — marketAppId=${marketAppId}`);
				const client = createReadOnlyClient(env);
				const book = await client.getOrderbook(marketAppId);
				console.log(
					`[Alpha] alpha_get_orderbook — got orderbook: YES bids=${book.yes.bids.length}, YES asks=${book.yes.asks.length}, NO bids=${book.no.bids.length}, NO asks=${book.no.asks.length}`,
				);

				type RawEntry = {
					price: number;
					quantity: number;
					escrowAppId: number;
					owner: string;
				};
				type UnifiedEntry = {
					price: string;
					priceRaw: number;
					shares: string;
					total: string;
					escrowAppId: number;
					owner: string;
					source: string;
				};

				const toUnified = (
					e: RawEntry,
					source: string,
					priceOverride?: number,
				): UnifiedEntry => {
					const p = priceOverride ?? e.price;
					const priceCents = p / 1_000_000;
					const shares = e.quantity / 1_000_000;
					return {
						price: `${(priceCents * 100).toFixed(2)}¢`,
						priceRaw: p,
						shares: `${shares.toFixed(2)}`,
						total: `$${(priceCents * shares).toFixed(2)}`,
						escrowAppId: e.escrowAppId,
						owner: e.owner,
						source,
					};
				};

				const asks: UnifiedEntry[] = [
					...book.yes.asks.map((e: RawEntry) => toUnified(e, "YES ask")),
					...book.no.bids.map((e: RawEntry) =>
						toUnified(e, "NO bid (= YES ask)", 1_000_000 - e.price),
					),
				].sort((a, b) => a.priceRaw - b.priceRaw);

				const bids: UnifiedEntry[] = [
					...book.yes.bids.map((e: RawEntry) => toUnified(e, "YES bid")),
					...book.no.asks.map((e: RawEntry) =>
						toUnified(e, "NO ask (= YES bid)", 1_000_000 - e.price),
					),
				].sort((a, b) => b.priceRaw - a.priceRaw);

				const bestAsk = asks.length > 0 ? asks[0].priceRaw : null;
				const bestBid = bids.length > 0 ? bids[0].priceRaw : null;
				const spread =
					bestAsk != null && bestBid != null
						? `${((bestAsk - bestBid) / 10_000).toFixed(2)}¢`
						: "N/A";

				const totalOrders =
					book.yes.bids.length +
					book.yes.asks.length +
					book.no.bids.length +
					book.no.asks.length;

				const orderbookResult = { unified: { asks, bids, spread }, totalOrders };
				return textResult(JSON.stringify(orderbookResult, null, 2));
			} catch (error: any) {
				console.error(`[Alpha] alpha_get_orderbook — error: ${error.message}`, error.stack);
				return textResult(`Error fetching orderbook: ${error.message || "Unknown error"}`);
			}
		},
	);

	server.tool(
		"alpha_get_open_orders",
		"Fetch all open orders for a wallet on a specific Alpha Arcade market. Uses your MCP wallet if walletAddress is not provided.",
		{
			marketAppId: z.number().describe("The market app ID"),
			walletAddress: z
				.string()
				.optional()
				.describe("Algorand wallet address (uses MCP wallet if omitted)"),
		},
		async ({ marketAppId, walletAddress }) => {
			try {
				console.log(
					`[Alpha] alpha_get_open_orders — marketAppId=${marketAppId}, walletAddress=${walletAddress || "(from vault)"}`,
				);
				const address = await resolveWalletAddress(env, props, walletAddress);
				console.log(`[Alpha] alpha_get_open_orders — resolved address=${address}`);
				const client = createReadOnlyClient(env);
				const orders = await client.getOpenOrders(marketAppId, address);
				console.log(`[Alpha] alpha_get_open_orders — returned ${orders.length} orders`);
				const formatted = orders.map((o) => ({
					escrowAppId: o.escrowAppId,
					position: o.position === 1 ? "YES" : "NO",
					side: o.side === 1 ? "BUY" : "SELL",
					price: formatPrice(o.price),
					quantity: formatQty(o.quantity),
					filled: formatQty(o.quantityFilled),
					remaining: formatQty(o.quantity - o.quantityFilled),
				}));
				const text =
					formatted.length > 0
						? JSON.stringify(formatted, null, 2)
						: "No open orders found for this wallet on this market.";
				return textResult(text);
			} catch (error: any) {
				console.error(
					`[Alpha] alpha_get_open_orders — error: ${error.message}`,
					error.stack,
				);
				return textResult(
					`Error fetching open orders: ${error.message || "Unknown error"}`,
				);
			}
		},
	);

	server.tool(
		"alpha_get_positions",
		"Fetch all YES/NO token positions for a wallet across all Alpha Arcade markets. Uses your MCP wallet if walletAddress is not provided.",
		{
			walletAddress: z
				.string()
				.optional()
				.describe("Algorand wallet address (uses MCP wallet if omitted)"),
		},
		async ({ walletAddress }) => {
			try {
				console.log(
					`[Alpha] alpha_get_positions — walletAddress=${walletAddress || "(from vault)"}`,
				);
				const address = await resolveWalletAddress(env, props, walletAddress);
				const client = createReadOnlyClient(env);
				const positions = await client.getPositions(address);
				console.log(`[Alpha] alpha_get_positions — returned ${positions.length} positions`);
				const formatted = positions.map((p) => ({
					marketAppId: p.marketAppId,
					title: p.title || `Market ${p.marketAppId}`,
					yesBalance: formatQty(p.yesBalance),
					noBalance: formatQty(p.noBalance),
					yesAssetId: p.yesAssetId,
					noAssetId: p.noAssetId,
				}));
				const text =
					formatted.length > 0
						? JSON.stringify(formatted, null, 2)
						: "No positions found for this wallet.";
				return textResult(text);
			} catch (error: any) {
				console.error(`[Alpha] alpha_get_positions — error: ${error.message}`, error.stack);
				return textResult(`Error fetching positions: ${error.message || "Unknown error"}`);
			}
		},
	);

	// ------------------------------------------
	// Write tools (require vault wallet)
	// ------------------------------------------

	server.tool(
		"alpha_create_limit_order",
		"Place a limit order on an Alpha Arcade prediction market. Price and quantity in microunits (500000 = $0.50, 1000000 = 1 share). Locks ~0.957 ALGO collateral. Returns escrowAppId — save it for cancel_order.",
		{
			marketAppId: z.number().describe("The market app ID"),
			position: z.union([z.literal(0), z.literal(1)]).describe("1 = Yes, 0 = No"),
			price: z.number().describe("Price in microunits (e.g. 500000 = $0.50)"),
			quantity: z.number().describe("Quantity in microunits (e.g. 1000000 = 1 share)"),
			isBuying: z.boolean().describe("true = buy order, false = sell order"),
		},
		async ({ marketAppId, position, price, quantity, isBuying }) => {
			try {
				const safePrice = Math.max(0, Math.round(price));
				const safeQty = Math.max(0, Math.round(quantity));
				console.log(
					`[Alpha] alpha_create_limit_order — market=${marketAppId}, pos=${position}, price=${safePrice}, qty=${safeQty}, buying=${isBuying} (raw: price=${price}, qty=${quantity})`,
				);
				if (safePrice <= 0 || safePrice > 1_000_000) {
					return textResult(
						`Invalid price: ${price}. Price must be between 1 and 1000000 microunits ($0.000001–$1.00).`,
					);
				}
				if (safeQty <= 0 || safeQty > 1_000_000_000_000) {
					return textResult(
						`Invalid quantity: ${quantity}. Quantity must be positive and reasonable.`,
					);
				}
				const client = await createTradingClient(env, props);
				const result = await client.createLimitOrder({
					marketAppId,
					position: position as 0 | 1,
					price: safePrice,
					quantity: safeQty,
					isBuying,
				});
				const posLabel = position === 1 ? "YES" : "NO";
				const sideLabel = isBuying ? "BUY" : "SELL";
				return textResult(
					`Limit order created.\n  Market App ID: ${marketAppId}\n  Escrow App ID: ${result.escrowAppId}\n  Position: ${posLabel}\n  Side: ${sideLabel}\n  Price: ${formatPrice(price)}\n  Quantity: ${formatQty(quantity)}\n  Tx IDs: ${result.txIds.join(", ")}\n  Confirmed round: ${result.confirmedRound}`,
				);
			} catch (error: any) {
				console.error(
					`[Alpha] alpha_create_limit_order — error: ${error.message}`,
					error.stack,
				);
				return textResult(
					`Error creating limit order: ${friendlyTradeError(error.message)}`,
				);
			}
		},
	);

	server.tool(
		"alpha_create_market_order",
		"Place a market order with auto-matching on Alpha Arcade. Price, quantity, and slippage in microunits. Returns escrowAppId, matched quantity, and actual fill price.",
		{
			marketAppId: z.number().describe("The market app ID"),
			position: z.union([z.literal(0), z.literal(1)]).describe("1 = Yes, 0 = No"),
			price: z.number().describe("Price in microunits (e.g. 500000 = $0.50)"),
			quantity: z.number().describe("Quantity in microunits (e.g. 1000000 = 1 share)"),
			isBuying: z.boolean().describe("true = buy order, false = sell order"),
			slippage: z
				.number()
				.describe("Slippage tolerance in microunits (e.g. 50000 = $0.05)"),
		},
		async ({ marketAppId, position, price, quantity, isBuying, slippage }) => {
			try {
				const safePrice = Math.max(0, Math.round(price));
				const safeQty = Math.max(0, Math.round(quantity));
				const safeSlip = Math.max(0, Math.round(slippage));
				console.log(
					`[Alpha] alpha_create_market_order — market=${marketAppId}, pos=${position}, price=${safePrice}, qty=${safeQty}, buying=${isBuying}, slippage=${safeSlip} (raw: price=${price}, qty=${quantity}, slip=${slippage})`,
				);
				if (safePrice <= 0 || safePrice > 1_000_000) {
					return textResult(
						`Invalid price: ${price}. Price must be between 1 and 1000000 microunits ($0.000001–$1.00).`,
					);
				}
				if (safeQty <= 0 || safeQty > 1_000_000_000_000) {
					return textResult(
						`Invalid quantity: ${quantity}. Quantity must be positive and reasonable.`,
					);
				}
				const estFund = Math.floor((safeQty * (safePrice + safeSlip)) / 1_000_000);
				if (estFund < 0 || estFund > Number.MAX_SAFE_INTEGER) {
					return textResult(
						`Computed fund amount (${estFund}) would overflow. Reduce your trade amount.`,
					);
				}
				const client = await createTradingClient(env, props);
				const result = await client.createMarketOrder({
					marketAppId,
					position: position as 0 | 1,
					price: safePrice,
					quantity: safeQty,
					isBuying,
					slippage: safeSlip,
				});
				const posLabel = position === 1 ? "YES" : "NO";
				const sideLabel = isBuying ? "BUY" : "SELL";
				return textResult(
					`Market order created and matched.\n  Market App ID: ${marketAppId}\n  Escrow App ID: ${result.escrowAppId}\n  Position: ${posLabel}\n  Side: ${sideLabel}\n  Submitted Price: ${formatPrice(price)}\n  Fill Price: ${formatPrice(result.matchedPrice ?? 0)}\n  Quantity: ${formatQty(quantity)}\n  Matched: ${formatQty(result.matchedQuantity ?? 0)}\n  Tx IDs: ${result.txIds.join(", ")}\n  Confirmed round: ${result.confirmedRound}`,
				);
			} catch (error: any) {
				console.error(
					`[Alpha] alpha_create_market_order — error: ${error.message}`,
					error.stack,
				);
				return textResult(
					`Error creating market order: ${friendlyTradeError(error.message)}`,
				);
			}
		},
	);

	server.tool(
		"alpha_cancel_order",
		"Cancel an open Alpha Arcade order. Requires escrowAppId and orderOwner. Refunds USDC/tokens and ~0.957 ALGO collateral.",
		{
			marketAppId: z.number().describe("The market app ID"),
			escrowAppId: z.number().describe("The escrow app ID of the order to cancel"),
			orderOwner: z.string().describe("The Algorand address that owns the order"),
		},
		async ({ marketAppId, escrowAppId, orderOwner }) => {
			try {
				console.log(
					`[Alpha] alpha_cancel_order — market=${marketAppId}, escrow=${escrowAppId}, owner=${orderOwner}`,
				);
				const client = await createTradingClient(env, props);
				const result = await client.cancelOrder({ marketAppId, escrowAppId, orderOwner });
				console.log(
					`[Alpha] alpha_cancel_order — result: txIds=${result.txIds?.join(",")}, round=${result.confirmedRound}`,
				);
				const success = result.success !== false;
				return textResult(
					success
						? `Order cancelled successfully.\n  Market App ID: ${marketAppId}\n  Escrow App ID: ${escrowAppId}\n  Tx IDs: ${result.txIds.join(", ")}\n  Confirmed round: ${result.confirmedRound}`
						: `Failed to cancel order ${escrowAppId}.`,
				);
			} catch (error: any) {
				console.error(`[Alpha] alpha_cancel_order — error: ${error.message}`, error.stack);
				return textResult(`Error cancelling order: ${friendlyTradeError(error.message)}`);
			}
		},
	);

	server.tool(
		"alpha_amend_order",
		"Edit an existing unfilled Alpha Arcade order in-place (change price, quantity, or slippage). Faster than cancel + recreate.",
		{
			marketAppId: z.number().describe("The market app ID"),
			escrowAppId: z.number().describe("The escrow app ID of the order to amend"),
			price: z.number().describe("New price in microunits"),
			quantity: z.number().describe("New quantity in microunits"),
			slippage: z.number().optional().describe("New slippage in microunits (default 0)"),
		},
		async ({ marketAppId, escrowAppId, price, quantity, slippage }) => {
			try {
				console.log(
					`[Alpha] alpha_amend_order — market=${marketAppId}, escrow=${escrowAppId}, price=${price}, qty=${quantity}, slippage=${slippage}`,
				);
				const client = await createTradingClient(env, props);
				const result = await client.amendOrder({
					marketAppId,
					escrowAppId,
					price,
					quantity,
					slippage,
				});
				const success = result.success !== false;
				return textResult(
					success
						? `Order amended successfully.\n  Market App ID: ${marketAppId}\n  Escrow App ID: ${escrowAppId}\n  New Price: ${formatPrice(price)}\n  New Quantity: ${formatQty(quantity)}\n  Tx IDs: ${result.txIds.join(", ")}\n  Confirmed round: ${result.confirmedRound}`
						: `Failed to amend order ${escrowAppId}.`,
				);
			} catch (error: any) {
				console.error(`[Alpha] alpha_amend_order — error: ${error.message}`, error.stack);
				return textResult(`Error amending order: ${friendlyTradeError(error.message)}`);
			}
		},
	);

	server.tool(
		"alpha_propose_match",
		"Propose a match between an existing maker order and your wallet as taker on Alpha Arcade.",
		{
			marketAppId: z.number().describe("The market app ID"),
			makerEscrowAppId: z.number().describe("The escrow app ID of the maker order"),
			makerAddress: z.string().describe("The Algorand address of the maker"),
			quantityMatched: z.number().describe("Quantity to match in microunits"),
		},
		async ({ marketAppId, makerEscrowAppId, makerAddress, quantityMatched }) => {
			try {
				console.log(
					`[Alpha] alpha_propose_match — market=${marketAppId}, makerEscrow=${makerEscrowAppId}, maker=${makerAddress}, qty=${quantityMatched}`,
				);
				const client = await createTradingClient(env, props);
				const result = await client.proposeMatch({
					marketAppId,
					makerEscrowAppId,
					makerAddress,
					quantityMatched,
				});
				const success = result.success !== false;
				return textResult(
					success
						? `Match proposed successfully.\n  Market App ID: ${marketAppId}\n  Maker Escrow: ${makerEscrowAppId}\n  Quantity: ${formatQty(quantityMatched)}\n  Tx IDs: ${result.txIds.join(", ")}\n  Confirmed round: ${result.confirmedRound}`
						: `Failed to propose match with escrow ${makerEscrowAppId}.`,
				);
			} catch (error: any) {
				console.error(`[Alpha] alpha_propose_match — error: ${error.message}`, error.stack);
				return textResult(`Error proposing match: ${error.message || "Unknown error"}`);
			}
		},
	);

	server.tool(
		"alpha_split_shares",
		"Split USDC into equal YES and NO outcome tokens on Alpha Arcade. 1 USDC (1000000 microunits) = 1 YES + 1 NO.",
		{
			marketAppId: z.number().describe("The market app ID"),
			amount: z
				.number()
				.describe("Amount to split in microunits (e.g. 1000000 = $1.00 USDC)"),
		},
		async ({ marketAppId, amount }) => {
			try {
				console.log(`[Alpha] alpha_split_shares — market=${marketAppId}, amount=${amount}`);
				const client = await createTradingClient(env, props);
				const result = await client.splitShares({ marketAppId, amount });
				return textResult(
					`Split ${formatPrice(amount)} USDC into YES + NO tokens.\n  Market App ID: ${marketAppId}\n  Amount: ${formatQty(amount)} each of YES and NO\n  Tx IDs: ${result.txIds.join(", ")}\n  Confirmed round: ${result.confirmedRound}`,
				);
			} catch (error: any) {
				console.error(`[Alpha] alpha_split_shares — error: ${error.message}`, error.stack);
				return textResult(`Error splitting shares: ${friendlyTradeError(error.message)}`);
			}
		},
	);

	server.tool(
		"alpha_merge_shares",
		"Merge equal YES and NO outcome tokens back into USDC on Alpha Arcade. 1 YES + 1 NO = 1 USDC.",
		{
			marketAppId: z.number().describe("The market app ID"),
			amount: z.number().describe("Amount to merge in microunits"),
		},
		async ({ marketAppId, amount }) => {
			try {
				console.log(`[Alpha] alpha_merge_shares — market=${marketAppId}, amount=${amount}`);
				const client = await createTradingClient(env, props);
				const result = await client.mergeShares({ marketAppId, amount });
				return textResult(
					`Merged YES + NO tokens back into ${formatPrice(amount)} USDC.\n  Market App ID: ${marketAppId}\n  Amount: ${formatQty(amount)} each of YES and NO\n  Tx IDs: ${result.txIds.join(", ")}\n  Confirmed round: ${result.confirmedRound}`,
				);
			} catch (error: any) {
				console.error(`[Alpha] alpha_merge_shares — error: ${error.message}`, error.stack);
				return textResult(`Error merging shares: ${friendlyTradeError(error.message)}`);
			}
		},
	);

	server.tool(
		"alpha_claim",
		"Claim USDC from a resolved Alpha Arcade market by redeeming outcome tokens. Winning = 1:1 USDC.",
		{
			marketAppId: z.number().describe("The market app ID"),
			assetId: z.number().describe("The outcome token ASA ID to redeem"),
			amount: z
				.number()
				.optional()
				.describe("Amount to claim in microunits (omit to claim entire balance)"),
		},
		async ({ marketAppId, assetId, amount }) => {
			try {
				console.log(
					`[Alpha] alpha_claim — market=${marketAppId}, asset=${assetId}, amount=${amount ?? "full"}`,
				);
				const client = await createTradingClient(env, props);
				const result = await client.claim({ marketAppId, assetId, amount });
				return textResult(
					`Claim successful.\n  Market App ID: ${marketAppId}\n  Asset ID: ${assetId}\n  Amount claimed: ${formatQty(result.amountClaimed)}\n  Tx IDs: ${result.txIds.join(", ")}\n  Confirmed round: ${result.confirmedRound}`,
				);
			} catch (error: any) {
				console.error(`[Alpha] alpha_claim — error: ${error.message}`, error.stack);
				return textResult(`Error claiming: ${friendlyTradeError(error.message)}`);
			}
		},
	);
}
