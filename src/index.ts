import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { OauthHandler } from "./oauth-handler";
import OAuthProvider from "./oauth-provider";
import { registerKnowledgeResources, registerSkillResource } from "./resources";
// import algosdk from 'algosdk';
import {
	registerAccountTools,
	registerAlgodTools,
	registerAlphaArcadeTools,
	registerAp2Tools,
	registerApiTools,
	registerAppTransactionTools,
	registerArc90Tools,
	registerAssetTransactionTools,
	registerGeneralTransactionTools,
	registerGroupTransactionTools,
	registerKnowledgeTools,
	registerReceiptTools,
	registerTinymanTools,
	registerUtilityTools,
	registerWalletTools,
	registerX402Tools,
} from "./tools";
import { type Env, type Props, type State, VaultResponse } from "./types";
import { ResponseProcessor } from "./utils";
import { checkSubjectBinding, ensureUserAccount } from "./utils/vaultManager";

// The Durable Object class behind PENDING_LOGINS must be exported from the main module
export { PendingLogins } from "./pending-logins";

/**
 * Grants created before this time are refused at refresh and deleted (H1 in
 * .claude/notes/doauth-protocol-fixes.md). One cutoff for the whole protocol (decision D3): the same
 * date in all three servers that share the token store, just after this server's login fix went
 * live (ae36536, deployed 2026-11-20 16:34:26 UTC), with half a minute for the rollout. Not
 * exported: named exports of the main module must be classes or handlers.
 */
const GRANTS_ISSUED_BEFORE = Math.floor(Date.parse("2026-11-20T16:35:00Z") / 1000);

// Define our MCP agent with tools
export class AlgorandRemoteMCP extends McpAgent<Env, State, Props> {
	server = new McpServer({
		name: "Algorand Remote MCP",
		version: "1.9.5",
		description:
			"Algorand Remote MCP for interacting with the Algorand blockchain. Use algorand_mcp_skill tool at start of each session to learn how to interact and operate Algorand Remote MCP.",
		websiteUrl: "https://goplausible.com",
		icons: [
			{
				src: "https://goplausible.com/favicon.ico",
				mimeType: "image/x-icon",
				sizes: ["64x64"],
			},
		],
	});

	// Initialize state with default values
	initialState: State = {
		items_per_page: 10,
	};

	// Initialization function that sets up tools and resources
	async init() {
		// Configure ResponseProcessor with pagination settings
		console.log("Initializing Algorand Remote MCP...");
		console.log("Current state:", this.state);
		console.log("Props:", {
			provider: this.props?.provider,
			userId: this.props?.id,
			clientId: this.props?.clientId,
			hasEmail: !!this.props?.email,
		});
		// Set default page size or use from state if available
		const itemsPerPage = this.state?.items_per_page || 10;
		ResponseProcessor.setItemsPerPage(itemsPerPage);
		// Ensure user has a vault-based account
		try {
			if (!this.props.email || !this.props.provider) {
				throw new Error("Email and provider must be provided in props");
			}
			// Every tool uses the account named by these props, and none is registered until this
			// check passes: the account must belong to this provider user (a recycled email or X
			// handle must not inherit someone else's wallet)
			const subjectProblem = await checkSubjectBinding(
				this.env,
				this.props.provider,
				this.props.email,
				this.props.id,
			);
			if (subjectProblem) {
				throw new Error(subjectProblem);
			}
			const accType = await ensureUserAccount(
				this.env,
				this.props.email,
				this.props.provider,
				this.props.id,
			);
			console.log(
				`User ${this.props.id} has a ${accType}-based account on ${this.props.provider} provider`,
			);
		} catch (error: any) {
			throw new Error(`Failed to ensure user account: ${error.message || "Unknown error"}`);
		}

		// Register resources
		this.registerKnowledgeResources();
		this.registerSkillResources();

		// Register tools by category
		await this.registerWalletTools();
		await this.registerAp2Tools();
		this.registerKnowledgeTools();
		this.registerArc90Tools();
		this.registerReceiptTools();
		this.registerAlgodTools();
		this.registerApiTools();
		this.registerAccountTools();
		await this.registerTransactionTools();
		this.registerBasicUtilityTools();
		await this.registerTinymanTools();
		this.registerAlphaArcadeTools();
		await this.registerX402Tools();
		// Additional tool categories will be added here
	}

	/**
	 * Register knowledge resources
	 */
	private registerKnowledgeResources() {
		// Register knowledge resources for documentation access
		// Pass environment for R2 bucket access
		registerKnowledgeResources(this.server, this.env, this.props);
	}

	/**
	 * Register skill resources
	 */
	private registerSkillResources() {
		// Register skill resources for agent usage
		registerSkillResource(this.server, this.env, this.props);
	}

	/**
	 * Register basic utility tools
	 */
	private registerBasicUtilityTools() {
		// Register Algorand utility tools
		registerUtilityTools(this.server, this.env, this.props);
	}

	/**
	 * Register account management tools
	 */
	private registerAccountTools() {
		// Register all account-related tools
		registerAccountTools(this.server, this.env, this.props);
	}

	/**
	 * Register transaction management tools
	 */
	private async registerTransactionTools() {
		// Register payment transaction tools
		await registerGeneralTransactionTools(this.server, this.env, this.props);

		// Register asset transaction tools
		registerAssetTransactionTools(this.server, this.env, this.props);

		// Register application transaction tools
		registerAppTransactionTools(this.server, this.env, this.props);

		// Register group transaction tools
		registerGroupTransactionTools(this.server, this.env, this.props);
	}

	/**
	 * Register Algorand node interaction tools
	 */
	private registerAlgodTools() {
		// Register algod tools for TEAL compilation and simulation
		registerAlgodTools(this.server, this.env, this.props);
	}

	/**
	 * Register ARC-90 URI generation tools
	 */
	private registerArc90Tools() {
		// Register ARC-90 URI generation tools
		registerArc90Tools(this.server, this.env, this.props);
	}
	/**
	 * Register Receipt URI generation tools
	 */
	private registerReceiptTools() {
		// Register receipt tools
		registerReceiptTools(this.server, this.env, this.props);
	}

	/**
	 * Register API integration tools
	 */
	private registerApiTools() {
		// Register external API integration tools
		registerApiTools(this.server, this.env, this.props);
	}

	/**
	 * Register Knowledge tools for documentation access
	 */
	private registerKnowledgeTools() {
		// Register knowledge documentation tools
		registerKnowledgeTools(this.server, this.env, this.props);
	}

	/**
	 * Register Wallet tools for wallet information access
	 */
	private async registerWalletTools() {
		// Register wallet management tools
		await registerWalletTools(this.server, this.env, this.props);
	}
	/**
	 * Register AP2 tools
	 */
	private async registerAp2Tools() {
		// Register AP2 mandate tools
		await registerAp2Tools(this.server, this.env, this.props);
	}
	/**
	 * Register Wallet tools for wallet information access
	 */
	private async registerTinymanTools() {
		// Register wallet management tools
		await registerTinymanTools(this.server, this.env, this.props);
	}
	/**
	 * Register Alpha Arcade prediction market tools
	 */
	private registerAlphaArcadeTools() {
		registerAlphaArcadeTools(this.server, this.env, this.props);
	}
	/**
	 * Register x402 payment protocol tools
	 */
	private async registerX402Tools() {
		// Register x402 discovery, paid request and Bazaar tools
		await registerX402Tools(this.server, this.env, this.props);
	}
	onStateUpdate(state: State) {
		// console.log({ stateUpdate: state });
	}
}
// export default AlgorandRemoteMCP.mount("/sse", {
//   binding: "AlgorandRemoteMCP",
// });

// export default {
// 	 fetch(request: Request, env: Env, ctx: ExecutionContext) {
// 		const url = new URL(request.url);
// 		console.log("Request URL:", url.pathname);
// 		if (url.pathname === "/sse" || url.pathname === "/sse/message") {
// 			console.log("Serving SSE endpoint");

// 			return AlgorandRemoteMCP.serveSSE("/sse", {
// 				binding: "AlgorandRemoteMCP",
// 				// corsOptions: {
// 				// 	origin: "*",
// 				// 	methods: "GET, POST, OPTIONS",
// 				// 	headers: "Content-Type, Authorization",
// 				// 	maxAge: 3600,
// 				// },
// 			}).fetch(request, env, ctx); // Use our custom environment
// 		}

// 		if (url.pathname === "/mcp") {
// 			console.log("Serving MCP endpoint");

// 			return AlgorandRemoteMCP.serve("/mcp", {
// 				binding: "AlgorandRemoteMCP"
// 			}).fetch(request, env, ctx); // Use our custom environment
// 		}

// 		return new Response("Not found", { status: 404 });
// 	},
// };

export default new OAuthProvider({
	apiHandler: AlgorandRemoteMCP.mount("/sse", {
		binding: "AlgorandRemoteMCP",
	}) as any,
	apiRoute: "/sse",
	authorizeEndpoint: "/authorize",
	clientRegistrationEndpoint: "/register",
	defaultHandler: OauthHandler as any,
	tokenEndpoint: "/token",
	grantsIssuedBefore: GRANTS_ISSUED_BEFORE,
	// This server has always added the client ID to the client redirect when a state is present
	clientRedirectParams: (_props, request) => ({
		client: request.state ? request.clientId : undefined,
	}),
});
