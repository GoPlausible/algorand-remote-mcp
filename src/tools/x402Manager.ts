/**
 * x402 Manager for Algorand Remote MCP
 * Provides x402 payment-protocol tools: payment-requirement discovery, paid
 * HTTP requests (payment leg signed with the user's vault-held key) and
 * Bazaar (facilitator discovery directory) browsing and search.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as msgpack from "algo-msgpack-with-bigint";
import * as algosdk from "algosdk";
import { z } from "zod";
import type { Env, Props } from "../types";
import { getPublicKey, signWithTransit } from "../utils/vaultManager";

// ── CAIP-2 ↔ MCP network mapping ─────────────────────────────────────────────

type NetworkId = "mainnet" | "testnet" | "localnet";

const CAIP2_GENESIS_TO_NETWORK: Record<string, NetworkId> = {
	"wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=": "mainnet",
	"SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=": "testnet",
};

const NETWORK_TO_CAIP2: Record<NetworkId, string> = {
	mainnet: "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=",
	testnet: "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=",
	localnet: "algorand:localnet",
};

function caip2ToNetwork(caip2: string): NetworkId | null {
	if (!caip2.startsWith("algorand:")) return null;
	const hash = caip2.slice("algorand:".length);
	return CAIP2_GENESIS_TO_NETWORK[hash] ?? null;
}

/**
 * The network this deployment's algod endpoint serves (from ALGORAND_NETWORK).
 * Payments can only be built and settled on this network.
 */
function configuredNetwork(env: Env): NetworkId {
	const network = (env.ALGORAND_NETWORK || "mainnet").toLowerCase();
	return network === "testnet" || network === "localnet" ? network : "mainnet";
}

// ── Bazaar / facilitator config ──────────────────────────────────────────────

/**
 * Fee-payer address of the GoPlausible facilitator. Sponsors the network fees
 * for the atomic payment group (the wallet's payment leg carries zero fee).
 * Used when a payment requirement does not advertise its own `extra.feePayer`.
 */
const FACILITATOR_FEE_PAYER = "ZMFK2OI7ZBD2U27ISERZC4S6LKM6WMFJPZQ4MYNJDZ2VNBNMBA67RA22AA";

function bazaarBaseUrl(env: Env): string {
	return env.BAZAAR_BASE_URL || "https://facilitator.goplausible.xyz";
}

/**
 * Friendly network name → CAIP-2 identifier expected by the Bazaar API.
 * Anything starting with a known chain prefix (algorand:, eip155:, solana:) is
 * passed through unchanged. Anything else is left as-is so the agent can
 * still forward arbitrary upstream-supported network strings.
 */
function friendlyToCaip2Network(input: string): string {
	if (!input) return input;
	if (
		input.startsWith("algorand:") ||
		input.startsWith("eip155:") ||
		input.startsWith("solana:")
	) {
		return input;
	}
	// Algorand friendly aliases.
	if (input === "algorand-mainnet" || input === "mainnet") return NETWORK_TO_CAIP2.mainnet;
	if (input === "algorand-testnet" || input === "testnet") return NETWORK_TO_CAIP2.testnet;
	if (input === "algorand-localnet" || input === "localnet") return NETWORK_TO_CAIP2.localnet;
	// Pass through for non-Algorand short names — the Bazaar may or may not
	// recognize them; if not, it returns an empty items[] which is fine.
	return input;
}

// ── x402 protocol types ──────────────────────────────────────────────────────

interface PaymentRequirement {
	scheme: string;
	network: string;
	// V2 canonical field name; V1 used `maxAmountRequired`. We accept either and
	// read it via getRequirementAmount(). At least one must be present.
	amount?: string;
	maxAmountRequired?: string;
	payTo: string;
	asset: string;
	resource?: string;
	description?: string;
	mimeType?: string;
	outputSchema?: unknown;
	maxTimeoutSeconds?: number;
	extra?: {
		name?: string;
		decimals?: number;
		feePayer?: string;
		[key: string]: unknown;
	};
}

interface PaymentRequiredResponse {
	x402Version: number;
	accepts: PaymentRequirement[];
	error?: string;
	resource?: unknown;
	extensions?: Record<string, unknown>;
}

const ATOMIC_UNITS_NOTE =
	"USDC amounts are expressed in atomic units. 1,000,000 atomic units = $1.00 USDC (USDC has 6 decimals).";

const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

// ── Algod / signing helpers ──────────────────────────────────────────────────

/**
 * Create and validate an Algorand client
 */
function createAlgoClient(algodUrl: string, token: string): algosdk.Algodv2 | null {
	if (!algodUrl) {
		console.error("Algorand node URL not configured");
		return null;
	}

	return new algosdk.Algodv2(token, algodUrl, "");
}

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
 * Sign an unsigned transaction with the user's vault-held key and return the
 * encoded signed transaction bytes. Same TAG + transit flow as
 * wallet_sign_transaction; the sender is always the vault wallet itself so no
 * `sgnr` field is needed.
 */
async function signTransactionWithVault(
	env: Env,
	props: Props,
	txn: algosdk.Transaction,
): Promise<Uint8Array> {
	const encodedTxn = algosdk.encodeUnsignedTransaction(txn);
	const tagged = ConcatArrays(Buffer.from("TX"), encodedTxn);
	const signatureResult = await signWithTransit(
		env,
		Buffer.from(tagged).toString("base64"),
		props.email,
		props.provider,
	);

	if (!signatureResult.success || !signatureResult.signature) {
		throw new Error("Failed to get signature from vault");
	}

	const signedTxn = {
		txn: msgpack.decode(encodedTxn),
		sig: Buffer.from(signatureResult.signature, "base64"),
	};
	return new Uint8Array(msgpack.encode(signedTxn, { sortKeys: true, ignoreUndefined: true }));
}

/**
 * Get the vault wallet's Algorand address for the current user
 */
async function getVaultAddress(env: Env, props: Props): Promise<string> {
	const publicKeyResult = await getPublicKey(env, props.email, props.provider);
	if (!publicKeyResult.success || !publicKeyResult.publicKey) {
		throw new Error("Failed to get public key from vault — no active agent wallet configured");
	}
	return algosdk.encodeAddress(Buffer.from(publicKeyResult.publicKey, "base64"));
}

// ── Response helpers ─────────────────────────────────────────────────────────

function textResponse(payload: Record<string, unknown>) {
	return {
		content: [
			{
				type: "text" as const,
				text: JSON.stringify({ ...payload, _atomicUnitsNote: ATOMIC_UNITS_NOTE }, null, 2),
			},
		],
	};
}

function errorResponse(message: string) {
	return {
		content: [
			{
				type: "text" as const,
				text: message,
			},
		],
	};
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────

async function httpRequest(opts: {
	baseURL: string;
	path: string;
	method: HttpMethod;
	queryParams?: Record<string, string>;
	body?: unknown;
	headers?: Record<string, string>;
}): Promise<{ status: number; bodyText: string; headers: Record<string, string> }> {
	const url = buildUrl(opts.baseURL, opts.path, opts.queryParams);
	const init: RequestInit = { method: opts.method, headers: { ...(opts.headers ?? {}) } };

	if (opts.body !== undefined && opts.method !== "GET") {
		if (typeof opts.body === "string") {
			init.body = opts.body;
		} else {
			init.body = JSON.stringify(opts.body);
			(init.headers as Record<string, string>)["content-type"] ??= "application/json";
		}
	}

	const response = await fetch(url, init);
	const bodyText = await response.text();
	const headers: Record<string, string> = {};
	response.headers.forEach((value, key) => {
		headers[key.toLowerCase()] = value;
	});
	return { status: response.status, bodyText, headers };
}

function buildUrl(baseURL: string, path: string, queryParams?: Record<string, string>): string {
	const base = baseURL.endsWith("/") ? baseURL.slice(0, -1) : baseURL;
	const tail = path.startsWith("/") ? path : `/${path}`;
	const url = new URL(base + tail);
	if (queryParams) {
		for (const [k, v] of Object.entries(queryParams)) url.searchParams.set(k, String(v));
	}
	return url.toString();
}

// ── Misc helpers ─────────────────────────────────────────────────────────────

function tryParseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

function decodeBase64Json(b64: string): unknown {
	try {
		return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
	} catch {
		return b64;
	}
}

function snippet(text: string, max = 300): string {
	return text.length <= max ? text : `${text.slice(0, max)}…`;
}

// ── x402 protocol helpers ────────────────────────────────────────────────────

/**
 * Returns the amount field from a PaymentRequirement, supporting both x402
 * spec versions:
 *   - V2 (current): `amount`
 *   - V1 (legacy):  `maxAmountRequired`
 * Prefers V2 if both are set (V2 deployments may include both for compat).
 */
function getRequirementAmount(req: PaymentRequirement): string | undefined {
	return req.amount ?? req.maxAmountRequired;
}

function isValidPaymentRequiredResponse(v: unknown): v is PaymentRequiredResponse {
	return (
		!!v &&
		typeof v === "object" &&
		typeof (v as PaymentRequiredResponse).x402Version === "number" &&
		Array.isArray((v as PaymentRequiredResponse).accepts)
	);
}

async function discover(opts: {
	baseURL: string;
	path: string;
	method: HttpMethod;
	queryParams?: Record<string, string>;
	body?: unknown;
}): Promise<{
	status: number;
	x402: boolean;
	accepts?: PaymentRequirement[];
	x402Version?: number;
	rawBody?: unknown;
}> {
	const response = await httpRequest(opts);

	// 1. Canonical Algorand x402 V2 transport: requirements arrive in the
	//    `payment-required` HTTP header as base64-encoded JSON. The body is
	//    usually empty (`{}`). Check this first.
	const headerPayload = response.headers["payment-required"];
	if (headerPayload) {
		const decoded = decodeBase64Json(headerPayload);
		if (isValidPaymentRequiredResponse(decoded)) {
			return {
				status: response.status,
				x402: true,
				accepts: decoded.accepts,
				x402Version: decoded.x402Version,
			};
		}
	}

	// 2. Fallback transport (some x402 servers put requirements in the 402 body).
	if (response.status === 402) {
		const parsed = tryParseJson(response.bodyText);
		if (isValidPaymentRequiredResponse(parsed)) {
			return {
				status: 402,
				x402: true,
				accepts: parsed.accepts,
				x402Version: parsed.x402Version,
			};
		}
		return { status: 402, x402: false, rawBody: parsed ?? response.bodyText };
	}

	// 3. Not an x402-protected response at all.
	return {
		status: response.status,
		x402: false,
		rawBody: tryParseJson(response.bodyText) ?? response.bodyText,
	};
}

function selectRequirement(
	accepts: PaymentRequirement[],
	network: NetworkId,
	preferredNetwork: NetworkId | undefined,
	maxAmountPerRequest: number | undefined,
): { requirement: PaymentRequirement; mcpNetwork: NetworkId } {
	// Map each accepts entry to its MCP network (or null if non-Algorand).
	const ranked = accepts
		.map((req) => ({ req, mcpNetwork: caip2ToNetwork(req.network) }))
		.filter(
			(e): e is { req: PaymentRequirement; mcpNetwork: NetworkId } => e.mcpNetwork !== null,
		);

	if (ranked.length === 0) {
		throw new Error(
			`No payment requirement is satisfiable on Algorand. Endpoint accepts networks: [${accepts.map((r) => r.network).join(", ")}]`,
		);
	}

	// This deployment has a single algod endpoint (ALGORAND_ALGOD), so only
	// requirements on the configured network can be built and settled.
	const usable = ranked.filter((e) => e.mcpNetwork === network);
	if (usable.length === 0) {
		throw new Error(
			`Endpoint is payable on [${ranked.map((e) => e.mcpNetwork).join(", ")}] but this MCP is configured for ${network} (ALGORAND_NETWORK).`,
		);
	}

	const amountOf = (req: PaymentRequirement): number => Number(getRequirementAmount(req));
	const inBudget = (req: PaymentRequirement) =>
		maxAmountPerRequest === undefined || amountOf(req) <= maxAmountPerRequest;

	const affordable = usable.filter((e) => inBudget(e.req));
	if (affordable.length === 0) {
		throw new Error(
			`All Algorand payment requirements exceed maxAmountPerRequest=${maxAmountPerRequest}. Cheapest: ${Math.min(...usable.map((e) => amountOf(e.req)))}.`,
		);
	}

	if (preferredNetwork) {
		const preferred = affordable.find((e) => e.mcpNetwork === preferredNetwork);
		if (preferred) return { requirement: preferred.req, mcpNetwork: preferred.mcpNetwork };
	}

	// No preference (or preference not matched): pick the cheapest affordable.
	const chosen = affordable.reduce((a, b) => (amountOf(a.req) <= amountOf(b.req) ? a : b));
	return { requirement: chosen.req, mcpNetwork: chosen.mcpNetwork };
}

/**
 * Build the base64 PAYMENT-SIGNATURE header: an atomic 2-transaction group
 * (facilitator fee-payer + wallet payment) with the payment leg signed by the
 * user's vault-held key.
 */
async function buildPaymentHeader(
	env: Env,
	props: Props,
	requirement: PaymentRequirement,
): Promise<string> {
	const feePayer =
		typeof requirement.extra?.feePayer === "string" && requirement.extra.feePayer
			? requirement.extra.feePayer
			: FACILITATOR_FEE_PAYER;

	const amountStr = getRequirementAmount(requirement);
	const amount = Number(amountStr);
	if (!Number.isFinite(amount) || amount < 0) {
		throw new Error(
			`Invalid payment amount: ${amountStr ?? "(missing `amount` / `maxAmountRequired` field)"}`,
		);
	}

	const senderAddress = await getVaultAddress(env, props);

	const algodClient = createAlgoClient(env.ALGORAND_ALGOD, env.ALGORAND_TOKEN || "");
	if (!algodClient) {
		throw new Error("Failed to create Algorand client");
	}
	const suggestedParams = await algodClient.getTransactionParams().do();

	// Fee payer covers fees for both txns in the group.
	const feePayerParams: algosdk.SuggestedParams = {
		...suggestedParams,
		fee: BigInt(2000),
		flatFee: true,
	};
	const innerParams: algosdk.SuggestedParams = {
		...suggestedParams,
		fee: BigInt(0),
		flatFee: true,
	};

	const feePayerTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
		sender: feePayer,
		receiver: feePayer,
		amount: 0,
		suggestedParams: feePayerParams,
	});

	const isAlgo = requirement.asset === "0" || requirement.asset === "";
	const paymentTxn = isAlgo
		? algosdk.makePaymentTxnWithSuggestedParamsFromObject({
				sender: senderAddress,
				receiver: requirement.payTo,
				amount,
				suggestedParams: innerParams,
			})
		: algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
				sender: senderAddress,
				receiver: requirement.payTo,
				assetIndex: Number(requirement.asset),
				amount,
				suggestedParams: innerParams,
			});

	const grouped = algosdk.assignGroupID([feePayerTxn, paymentTxn]);
	const groupedFeePayer = grouped[0];
	const groupedPayment = grouped[1];

	const signedPaymentBlob = await signTransactionWithVault(env, props, groupedPayment);
	const unsignedFeePayer = algosdk.encodeUnsignedTransaction(groupedFeePayer);

	const headerBody = {
		x402Version: 2,
		scheme: requirement.scheme,
		network: requirement.network,
		payload: {
			paymentGroup: [
				Buffer.from(unsignedFeePayer).toString("base64"),
				Buffer.from(signedPaymentBlob).toString("base64"),
			],
			paymentIndex: 1,
		},
		// Echo the fee payer actually used so the facilitator validates against it
		// even when the requirement did not advertise `extra.feePayer`.
		accepted: { ...requirement, extra: { ...requirement.extra, feePayer } },
	};

	return Buffer.from(JSON.stringify(headerBody), "utf8").toString("base64");
}

// ── Bazaar helpers ───────────────────────────────────────────────────────────

async function bazaarRequest(
	env: Env,
	path: string,
	query: Record<string, string>,
): Promise<unknown> {
	const baseUrl = bazaarBaseUrl(env);
	const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
	const tail = path.startsWith("/") ? path : `/${path}`;
	const url = new URL(base + tail);
	for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);

	const response = await fetch(url.toString(), {
		method: "GET",
		headers: { accept: "application/json" },
	});
	const text = await response.text();
	if (!response.ok) {
		throw new Error(
			`Bazaar request failed (${response.status} ${response.statusText}) for ${url.pathname}${url.search}: ${snippet(text)}`,
		);
	}
	const parsed = tryParseJson(text);
	if (parsed === null) {
		throw new Error(`Bazaar returned non-JSON body: ${snippet(text)}`);
	}
	return parsed;
}

function summarizeBazaarItem(item: any): Record<string, unknown> {
	const accepts: any[] = Array.isArray(item?.accepts) ? item.accepts : [];
	const algorandAccepts = accepts
		.filter((a) => typeof a?.network === "string" && a.network.startsWith("algorand:"))
		.map((a) => ({
			network: a.network,
			mcpNetwork: caip2ToNetwork(a.network) ?? null,
			scheme: a.scheme,
			amount: a.amount ?? a.maxAmountRequired,
			asset: a.asset,
			payTo: a.payTo,
			usdPrice: usdPriceOfAccept(a),
		}));

	return {
		resourceUrl: item?.resourceUrl,
		method: item?.method,
		description: item?.description,
		merchantId: item?.merchantId,
		algorandPayable: algorandAccepts.length > 0,
		algorandAccepts,
		totalAcceptedNetworks: accepts.length,
		otherNetworks: accepts
			.filter((a) => !algorandAccepts.find((ao) => ao.network === a.network))
			.map((a) => a?.network)
			.filter(Boolean),
		hasDiscoveryInfo: !!item?.discoveryInfo,
		popularity: { verifyCount: item?.verifyCount ?? 0, settleCount: item?.settleCount ?? 0 },
		firstSeen: item?.firstSeen,
		lastSeen: item?.lastSeen,
		id: item?.id,
	};
}

/** USDC has 6 decimals; assume non-USDC assets are USDC-like for ballpark filtering. */
function usdPriceOfAccept(accept: any): number | null {
	const amountStr = accept?.amount ?? accept?.maxAmountRequired;
	const decimals = typeof accept?.extra?.decimals === "number" ? accept.extra.decimals : 6;
	const n = Number(amountStr);
	if (!Number.isFinite(n)) return null;
	return n / 10 ** decimals;
}

function cheapestUsdPrice(accepts: any): number | null {
	if (!Array.isArray(accepts) || accepts.length === 0) return null;
	const prices = accepts.map((a) => usdPriceOfAccept(a)).filter((p): p is number => p !== null);
	if (prices.length === 0) return null;
	return Math.min(...prices);
}

function isTestnetNetwork(caip2: unknown): boolean {
	if (typeof caip2 !== "string") return false;
	if (caip2 === NETWORK_TO_CAIP2.testnet) return true;
	return /sepolia|devnet|testnet/i.test(caip2);
}

// ── Tool registration ────────────────────────────────────────────────────────

/**
 * Register x402 payment protocol tools to the MCP server
 */
export async function registerX402Tools(server: McpServer, env: Env, props: Props): Promise<void> {
	// Ensure user has a vault-based account
	if (!props.email || !props.provider) {
		throw new Error("Email and provider must be provided in props");
	}

	// Discover payment requirements without paying
	server.tool(
		"x402_discover_payment_requirements",
		"Probe an x402-protected HTTP endpoint and return its payment requirements (the `accepts` array from the 402 response) without paying. Use this to inspect cost and supported networks/assets before calling `make_http_request_with_x402`.",
		{
			baseURL: z
				.string()
				.describe(
					"Base URL of the x402-protected endpoint, e.g. https://example.x402.goplausible.xyz",
				),
			path: z.string().describe("Path under baseURL, e.g. /weather"),
			method: z.enum(HTTP_METHODS).describe("HTTP method to probe"),
			queryParams: z
				.record(z.string())
				.optional()
				.describe("Optional query string parameters"),
			body: z
				.any()
				.optional()
				.describe(
					"Optional request body. Strings are sent verbatim; objects are JSON-encoded.",
				),
		},
		async ({ baseURL, path, method, queryParams, body }) => {
			try {
				const result = await discover({ baseURL, path, method, queryParams, body });
				return textResponse({ result });
			} catch (error: any) {
				return errorResponse(`x402 discovery failed: ${error.message || "Unknown error"}`);
			}
		},
	);

	// Make a paid HTTP request with automatic x402 payment
	server.tool(
		"make_http_request_with_x402",
		"Call an x402-protected HTTP endpoint with automatic USDC/ALGO payment from the active wallet. If `paymentRequirements` is not supplied, this tool runs discovery internally (one extra request). Builds an atomic 2-transaction group (facilitator fee-payer + wallet payment), signs the payment leg with the wallet, and resends with the `PAYMENT-SIGNATURE` header.",
		{
			baseURL: z.string().describe("Base URL of the x402-protected endpoint"),
			path: z.string().describe("Path under baseURL"),
			method: z.enum(HTTP_METHODS).describe("HTTP method"),
			queryParams: z
				.record(z.string())
				.optional()
				.describe("Optional query string parameters"),
			body: z
				.any()
				.optional()
				.describe(
					"Optional request body. Strings are sent verbatim; objects are JSON-encoded.",
				),
			headers: z
				.record(z.string())
				.optional()
				.describe("Optional additional request headers"),
			correlationId: z
				.string()
				.optional()
				.describe("Optional correlation id; forwarded as X-Correlation-ID header"),
			maxAmountPerRequest: z
				.number()
				.int()
				.optional()
				.describe(
					"Maximum payment in USDC atomic units (1,000,000 = $1.00). If a payment requirement exceeds this, the call is refused.",
				),
			paymentRequirements: z
				.array(
					z
						.object({
							scheme: z.string(),
							network: z
								.string()
								.describe(
									'CAIP-2 network identifier, e.g. "algorand:SGO1…" for testnet.',
								),
							amount: z
								.string()
								.optional()
								.describe(
									"x402 V2 canonical amount field (atomic units as decimal string).",
								),
							maxAmountRequired: z
								.string()
								.optional()
								.describe(
									"x402 V1 legacy amount field. Either `amount` or `maxAmountRequired` must be present.",
								),
							payTo: z.string(),
							asset: z.string(),
							maxTimeoutSeconds: z.number().int().optional(),
							extra: z.object({}).passthrough().optional(),
						})
						.passthrough(),
				)
				.optional()
				.describe(
					"Pre-fetched accepts[] array from a prior x402_discover_payment_requirements call. If omitted, this tool discovers internally. Each element must be an OBJECT with at least { scheme, network, payTo, asset, amount }. Common mistake: passing `preferredNetwork` or `maxAmountPerRequest` as array elements instead of sibling top-level fields.",
				),
			preferredNetwork: z
				.enum(["mainnet", "testnet", "localnet"])
				.optional()
				.describe(
					"TOP-LEVEL sibling of paymentRequirements (NOT an array element). Preferred Algorand network when multiple accepts entries match. If omitted, the cheapest affordable Algorand entry is chosen.",
				),
			extensions: z
				.object({})
				.passthrough()
				.optional()
				.describe(
					"Optional pre-fetched PaymentRequired extensions (e.g. Bazaar resource details). Passed through to the response under `extensions`.",
				),
		},
		async ({
			baseURL,
			path,
			method,
			queryParams,
			body,
			headers,
			correlationId,
			maxAmountPerRequest,
			paymentRequirements,
			preferredNetwork,
			extensions,
		}) => {
			if (!env.ALGORAND_ALGOD) {
				return errorResponse("Algorand node URL not configured");
			}

			try {
				let accepts = paymentRequirements as unknown as PaymentRequirement[] | undefined;

				// Zod enforces entry shape; still require an amount field (x402 V2
				// `amount` or V1 `maxAmountRequired`) on every supplied entry.
				if (accepts) {
					for (let i = 0; i < accepts.length; i++) {
						const entry = accepts[i];
						if (
							typeof entry.amount !== "string" &&
							typeof entry.maxAmountRequired !== "string"
						) {
							throw new Error(
								`paymentRequirements[${i}] is missing required field \`amount\` (or legacy \`maxAmountRequired\`). Pass the accepts[] entry verbatim from x402_discover_payment_requirements.`,
							);
						}
					}
				}

				// Discover if needed
				if (!accepts || accepts.length === 0) {
					const discovered = await discover({ baseURL, path, method, queryParams, body });
					if (
						!discovered.x402 ||
						!Array.isArray(discovered.accepts) ||
						discovered.accepts.length === 0
					) {
						throw new Error(
							`Endpoint did not return an x402 payment requirement (status ${discovered.status}). Use a non-x402 HTTP tool, or pass paymentRequirements explicitly.`,
						);
					}
					accepts = discovered.accepts;
				}

				// Select a requirement we can satisfy on the configured network
				const { requirement, mcpNetwork } = selectRequirement(
					accepts,
					configuredNetwork(env),
					preferredNetwork,
					maxAmountPerRequest,
				);

				// Build and sign the payment group with the vault-held key
				const paymentHeader = await buildPaymentHeader(env, props, requirement);

				// Retry with PAYMENT-SIGNATURE
				const paidHeaders: Record<string, string> = {
					...(headers ?? {}),
					"PAYMENT-SIGNATURE": paymentHeader,
				};
				if (correlationId) paidHeaders["X-Correlation-ID"] = correlationId;

				const response = await httpRequest({
					baseURL,
					path,
					method,
					queryParams,
					body,
					headers: paidHeaders,
				});

				if (response.status === 402) {
					// Surface the server's rejection rather than retrying.
					throw new Error(`Payment rejected by server: ${snippet(response.bodyText)}`);
				}

				const result = tryParseJson(response.bodyText) ?? response.bodyText;
				// Algorand x402 V2 uses lowercase `payment-response`; older deployments
				// may use Coinbase's `x-payment-response`. Accept either.
				const paymentResponseHeader =
					response.headers["payment-response"] ?? response.headers["x-payment-response"];
				return textResponse({
					result,
					status: response.status,
					paymentResponse: paymentResponseHeader
						? decodeBase64Json(paymentResponseHeader)
						: undefined,
					paid: {
						network: mcpNetwork,
						asset: requirement.asset,
						amount: getRequirementAmount(requirement),
						payTo: requirement.payTo,
					},
					extensions,
				});
			} catch (error: any) {
				return errorResponse(
					`x402 paid request failed: ${error.message || "Unknown error"}`,
				);
			}
		},
	);

	// Browse Bazaar-cataloged paid API resources
	server.tool(
		"bazaar_list",
		"Browse paid API resources cataloged in the Bazaar (the discovery directory hosted by the configured facilitator). Returns a compact summary per resource by default; pass `full: true` for the verbatim facilitator response. Supports filtering by `network`, `method`, `merchantId`, plus standard `limit`/`offset` pagination.",
		{
			network: z
				.string()
				.optional()
				.describe(
					'Filter by network. Accepts friendly names ("algorand-mainnet", "algorand-testnet", "algorand-localnet", or bare "mainnet"/"testnet"/"localnet") or raw CAIP-2 strings ("algorand:wGHE2Pw…", "eip155:84532", "solana:EtWT…"). Friendly names are translated to CAIP-2 before the request.',
				),
			method: z.enum(HTTP_METHODS).optional().describe("Filter by HTTP method."),
			merchantId: z.string().optional().describe("Filter by merchant id."),
			limit: z.number().int().optional().describe("Results per page (default 50, max 100)."),
			offset: z.number().int().optional().describe("Pagination offset."),
			full: z
				.boolean()
				.optional()
				.describe(
					"If true, returns each item verbatim from the facilitator (large — includes full accepts[] and discoveryInfo). If false or omitted, returns a compact summary per item (URL, method, description, popularity counters, and just the Algorand-payable accepts).",
				),
		},
		async ({ network, method, merchantId, limit, offset, full }) => {
			try {
				const params: Record<string, string> = {};
				if (network) params.network = friendlyToCaip2Network(network);
				if (method) params.method = method;
				if (merchantId) params.merchantId = merchantId;
				if (limit !== undefined) params.limit = String(limit);
				if (offset !== undefined) params.offset = String(offset);

				const responseBody = await bazaarRequest(env, "/discovery/resources", params);
				const items = Array.isArray((responseBody as any)?.items)
					? (responseBody as any).items
					: [];
				const pagination = (responseBody as any)?.pagination;

				return textResponse({
					source: bazaarBaseUrl(env),
					pagination,
					count: items.length,
					items: full === true ? items : items.map((it: any) => summarizeBazaarItem(it)),
				});
			} catch (error: any) {
				return errorResponse(`Bazaar list failed: ${error.message || "Unknown error"}`);
			}
		},
	);

	// Search Bazaar paid API resources by keyword
	server.tool(
		"bazaar_search",
		"Search Bazaar paid API resources by keyword. Hits the same /discovery/resources endpoint as bazaar_list but with the `search` query forwarded to the facilitator. Additional filters (`scheme`, `maxUsdPrice`, `asset`, `payTo`, `extensions`, `includeTestnets`) are applied client-side after the response. Defaults to mainnet-only.",
		{
			query: z
				.string()
				.min(1)
				.describe("Keyword to match in resource URL and description (minimum 1 char)."),
			limit: z
				.number()
				.int()
				.min(1)
				.max(20)
				.optional()
				.describe("Max results to return (1–20, default 10)."),
			network: z
				.string()
				.optional()
				.describe(
					"Filter by network (friendly name or CAIP-2). See bazaar_list for accepted values.",
				),
			includeTestnets: z
				.boolean()
				.optional()
				.describe(
					"If true, include testnet/devnet networks in the results. Default false (mainnet-only).",
				),
			scheme: z
				.enum(["exact", "upto"])
				.optional()
				.describe(
					"Client-side filter — only return resources whose accepts[] includes this payment scheme.",
				),
			maxUsdPrice: z
				.number()
				.positive()
				.optional()
				.describe(
					"Client-side filter — exclude resources whose cheapest accepts entry exceeds this USD price (computed from amount + asset decimals). Assumes USDC pricing.",
				),
			asset: z
				.string()
				.optional()
				.describe(
					"Client-side filter — only return resources whose accepts[] includes this asset id.",
				),
			payTo: z
				.string()
				.optional()
				.describe(
					"Client-side filter — only return resources whose accepts[] includes this recipient address.",
				),
			extensions: z
				.string()
				.optional()
				.describe(
					'Client-side filter — only return resources whose discoveryInfo / extensions object contains this key (e.g. "bazaar", "outputSchema").',
				),
		},
		async ({
			query,
			limit,
			network,
			includeTestnets,
			scheme,
			maxUsdPrice,
			asset,
			payTo,
			extensions,
		}) => {
			try {
				const maxResults = limit ?? 10;
				const caip2Network = network ? friendlyToCaip2Network(network) : undefined;

				// Server-side params we can forward.
				const params: Record<string, string> = {
					search: query,
					limit: String(Math.min(100, Math.max(maxResults * 5, 50))),
				};
				if (caip2Network) params.network = caip2Network;

				const responseBody = await bazaarRequest(env, "/discovery/resources", params);
				let items: any[] = Array.isArray((responseBody as any)?.items)
					? (responseBody as any).items
					: [];

				// Client-side filters not supported by the server.
				if (!includeTestnets) {
					items = items.filter(
						(it: any) =>
							Array.isArray(it?.accepts) &&
							it.accepts.some((a: any) => !isTestnetNetwork(a?.network)),
					);
				}
				if (scheme) {
					items = items.filter(
						(it: any) =>
							Array.isArray(it?.accepts) &&
							it.accepts.some((a: any) => a?.scheme === scheme),
					);
				}
				if (asset) {
					items = items.filter(
						(it: any) =>
							Array.isArray(it?.accepts) &&
							it.accepts.some((a: any) => String(a?.asset) === asset),
					);
				}
				if (payTo) {
					items = items.filter(
						(it: any) =>
							Array.isArray(it?.accepts) &&
							it.accepts.some((a: any) => a?.payTo === payTo),
					);
				}
				if (maxUsdPrice !== undefined) {
					items = items.filter((it: any) => {
						const cheapest = cheapestUsdPrice(it?.accepts);
						return cheapest !== null && cheapest <= maxUsdPrice;
					});
				}
				if (extensions) {
					items = items.filter((it: any) => {
						const info = it?.discoveryInfo;
						if (extensions === "bazaar") return !!info;
						if (info && typeof info === "object" && extensions in info) return true;
						return false;
					});
				}

				items = items.slice(0, maxResults);

				return textResponse({
					source: bazaarBaseUrl(env),
					query,
					filtersApplied: {
						network: caip2Network,
						includeTestnets: includeTestnets === true,
						scheme,
						maxUsdPrice,
						asset,
						payTo,
						extensions,
					},
					count: items.length,
					items: items.map((it: any) => summarizeBazaarItem(it)),
				});
			} catch (error: any) {
				return errorResponse(`Bazaar search failed: ${error.message || "Unknown error"}`);
			}
		},
	);

	// Fetch full details for a single Bazaar resource
	server.tool(
		"bazaar_get_resource_details",
		"Fetch full details for a single Bazaar resource by its exact `resource` URL. Internally calls /discovery/resources?search=<url> and exact-matches against resourceUrl. Returns the verbatim resource record (accepts[], discoveryInfo / extensions, popularity counters) or an error if no match is found.",
		{
			resource: z
				.string()
				.describe(
					"Exact resource URL to fetch details for (must match the resourceUrl as registered in the Bazaar).",
				),
		},
		async ({ resource }) => {
			try {
				try {
					new URL(resource);
				} catch {
					throw new Error(`\`resource\` is not a valid URL: ${resource}`);
				}

				// The facilitator API has no GET-by-id endpoint; we search by URL substring
				// and exact-match on resourceUrl client-side.
				const responseBody = await bazaarRequest(env, "/discovery/resources", {
					search: resource,
					limit: "100",
				});
				const items: any[] = Array.isArray((responseBody as any)?.items)
					? (responseBody as any).items
					: [];
				const exact = items.find((it: any) => it?.resourceUrl === resource);
				if (!exact) {
					throw new Error(
						`No Bazaar resource found with resourceUrl=${resource}. The facilitator returned ${items.length} partial match(es) for the substring search.`,
					);
				}
				return textResponse({ source: bazaarBaseUrl(env), resource: exact });
			} catch (error: any) {
				return errorResponse(
					`Bazaar resource lookup failed: ${error.message || "Unknown error"}`,
				);
			}
		},
	);
}
