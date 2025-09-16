import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Env, State, Props, VaultResponse } from './types';
import { ResponseProcessor } from './utils';
import OAuthProvider from "./oauth-provider";
import { OauthHandler } from "./oauth-handler";
import {
  ensureUserAccount,
} from './utils/vaultManager';
// import algosdk from 'algosdk';
import {
	registerAccountTools,
	registerGeneralTransactionTools,
	registerAssetTransactionTools,
	registerAppTransactionTools,
	registerGroupTransactionTools,
	registerUtilityTools,
	registerAlgodTools,
	registerArc26Tools,
	registerApiTools,
	registerKnowledgeTools,
	registerWalletTools,
	registerTinymanTools
} from './tools';
import { registerWalletResources, registerKnowledgeResources, registerGuideResource } from './resources';



// Define our MCP agent with tools
export class AlgorandRemoteMCP extends McpAgent<Env, State, Props> {
	server = new McpServer({
		name: "Algorand Remote MCP",
		version: "1.2.0",
	});

	// Initialize state with default values
	initialState: State = {
		items_per_page: 10

	};

	// Initialization function that sets up tools and resources
	async init() {
		// Configure ResponseProcessor with pagination settings
		console.log("Initializing Algorand Remote MCP...");
		console.log('COOKIE_ENCRYPTION_KEY: ',this.env.COOKIE_ENCRYPTION_KEY)
		console.log("Current state:", this.state);
		console.log("Props name:", this.props?.name);
		console.log("Props email:", this.props?.email);
		// Set provider in state if available in props
	
		console.log("Props User ID:", this.props?.id);
		console.log("Props clientId:", this.props?.clientId);
		// Set default page size or use from state if available
		const itemsPerPage = this.state?.items_per_page || 10;
		ResponseProcessor.setItemsPerPage(itemsPerPage);
		// Ensure user has a vault-based account 
		try {
			if (!this.props.email || !this.props.provider) {
				throw new Error('Email and provider must be provided in props');
			}
			console.log(`Ensuring user account for ${this.props.email} with provider ${this.props.provider}`);
			const accType = await ensureUserAccount(this.env, this.props.email, this.props.provider);
			console.log(`User ${this.props.email} has a ${accType}-based account on ${this.props.provider} provider`);
		} catch (error: any) {
			throw new Error(`Failed to ensure user account: ${error.message || 'Unknown error'}`);
		}


		// Register resources
		await this.registerWalletResources();
		this.registerKnowledgeResources();
		this.registerGuideResources();

		// Register tools by category
		await this.registerWalletTools();
		this.registerKnowledgeTools();
		this.registerArc26Tools();
		this.registerAlgodTools();
		this.registerApiTools();
		this.registerAccountTools();
		await this.registerTransactionTools();
		this.registerBasicUtilityTools();
		await this.registerTinymanTools()
		// Additional tool categories will be added here
	}


	/**
	 * Register wallet resources
	 */
	private async registerWalletResources() {
		// Register all wallet-related resources
		// Since this might contain parameters from env, we pass env to the function
		await registerWalletResources(this.server, this.env, this.props);
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
	 * Register guide resources
	 */
	private registerGuideResources() {
		// Register guide resources for agent usage guidance
		registerGuideResource(this.server, this.env, this.props);
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
	 * Register ARC-26 URI generation tools
	 */
	private registerArc26Tools() {
		// Register ARC-26 URI generation tools
		registerArc26Tools(this.server, this.env, this.props);
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
	 * Register Wallet tools for wallet information access
	 */
	private async registerTinymanTools() {
		// Register wallet management tools
		await registerTinymanTools(this.server, this.env, this.props);
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
		binding: "AlgorandRemoteMCP"
	}) as any,
	apiRoute: "/sse",
	authorizeEndpoint: "/authorize",
	clientRegistrationEndpoint: "/register",
	defaultHandler: OauthHandler as any,
	tokenEndpoint: "/token",
});

