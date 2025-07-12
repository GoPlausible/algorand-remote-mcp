# Algorand Remote MCP

A Model Context Protocol (MCP) server implementation that provides tools and resources for AI agents to interact with the Algorand blockchain.

## Overview

Algorand Remote MCP bridges the gap between AI agents and the Algorand blockchain ecosystem. It serves as a middleware layer that enables AI systems to interact with blockchain technology through a standardized interface, without requiring deep blockchain expertise.

The server is designed to run on Cloudflare Workers and provides a comprehensive set of tools and resources for blockchain operations, including wallet management, transaction creation and submission, API integration, and knowledge access.

## Features

- **Secure Wallet Management**: Create, access, and manage Algorand wallets with automatic wallet creation for new users
- **Comprehensive Transaction Support**: Create, sign, and submit various transaction types (payments, assets, applications)
- **API Integration**: Access Algorand node, indexer, and NFD APIs through standardized interfaces
- **Knowledge Resources**: Access documentation and guides for Algorand development
- **Google OAuth Authentication**: Secure user authentication through Google OAuth
- **Pagination Support**: Handle large datasets with built-in pagination
- **Standardized Response Formatting**: Consistent response formatting for AI agent consumption
- **Wallet Reset Capability**: Users can reset their wallet and generate a new one if needed

## Installation
Make sure you have these:
- Node.js v16+ installed
- A Google account for OAuth authentication

Add this to your MCP servers:

```json
{
  "mcpServers": {
    "algorand-remote-mcp": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://algorand-remote-mcp.your-account.workers.dev/sse"  // or http://localhost:8787/sse for local development
      ]
    }
  }
}

```

And then restart your LLM Agent and prompt to it: 
```
Read Algorand Remote MCP guide.
```

## Architecture

Algorand Remote MCP is built on the Model Context Protocol (MCP), which provides a standardized way for AI agents to interact with external systems. The server is implemented as a Cloudflare Worker with the following components:

- **AlgorandRemoteMCP Class**: Main MCP agent implementation that extends McpAgent
- **Tool Managers**: Specialized managers for different operation types
- **Resource Providers**: URI-based access to data and documentation
- **ResponseProcessor**: Standardized response formatting with pagination support
- **OAuth Integration**: Secure user authentication and authorization

## Available Tools

### Account Management
- `create_account`: Create a new Algorand account
- `recover_account`: Recover an account from a mnemonic
- `check_balance`: Check the balance of an Algorand account

### Wallet Management
- `get_wallet_address`: Get the address for the configured wallet
- `get_wallet_account`: Get account information for the configured wallet
- `get_wallet_assets`: Get assets owned by the configured wallet
- `get_wallet_mnemonic`: Get the mnemonic for the configured wallet
- `get_wallet_publickey`: Get the public key for the configured wallet
- `get_wallet_secretkey`: Get the secret key for the configured wallet
- `reset-wallet_account`: Reset the wallet account for the configured user

### Transaction Management
- `create_payment_transaction`: Create a payment transaction
- `sign_transaction`: Sign a transaction with the wallet's credentials
- `submit_transaction`: Submit a signed transaction to the network
- `asset_optin`: Create an asset opt-in transaction
- `transfer_asset`: Create an asset transfer transaction
- `create_asset`: Create a new Algorand Standard Asset
- `create_application`: Create a new smart contract application
- `call_application`: Call a smart contract application

### API Integration
- `api_algod_get_account_info`: Get account details from Algorand node
- `api_algod_get_transaction_info`: Get transaction details from Algorand node
- `api_indexer_lookup_account_by_id`: Get account details from indexer
- `api_nfd_get_nfd`: Get NFD address information

### Utility Tools
- `validate_address`: Validate an Algorand address
- `encode_obj`: Encode an object to msgpack format
- `decode_obj`: Decode msgpack bytes to an object
- `compile_teal`: Compile TEAL source code
- `algorand_mcp_guide`: Access comprehensive guide for using Algorand Remote MCP

## Available Resources

### Wallet Resources
- `algorand://wallet/address`: Wallet account address
- `algorand://wallet/account`: Wallet account information
- `algorand://wallet/assets`: Wallet account assets

### Knowledge Resources
- `algorand://knowledge/taxonomy`: Full taxonomy of knowledge resources
- `algorand://knowledge/taxonomy/{category}`: Category-specific knowledge resources

### Guide Resources
- `algorand://remote-mcp-guide`: Comprehensive guide for using Algorand Remote MCP

## Installation and Setup

### Development Prerequisites
- Node.js v16+
- Cloudflare Workers account
- Algorand node access (or use a service like Nodely.io aka AlgoNode)
- Google OAuth credentials

### Environment Variables
```
ALGORAND_NETWORK=mainnet
ALGORAND_ALGOD=https://your-algod-node.com
ALGORAND_INDEXER=https://your-indexer-node.com
NFD_API_URL=https://api.nf.domains
ALGORAND_TOKEN=your-api-token
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
```

### Deployment
1. Clone the repository
2. Install dependencies: `npm install`
3. Configure environment variables in `wrangler.toml`
4. Deploy to Cloudflare Workers: `wrangler deploy`

## Usage

### Authentication Flow
1. User authenticates through Google OAuth
2. Server creates or retrieves wallet credentials for the user
3. User can now access tools and resources through the MCP interface

### Transaction Flow
1. Create transaction using appropriate tool
2. Sign transaction with wallet credentials
3. Submit transaction to network
4. Verify transaction success

### Example: Send Payment
```typescript
// 1. Get wallet information
const walletInfo = await agent.useToolWithRetry("get_wallet_account", {});

// 2. Create payment transaction
const txnResult = await agent.useToolWithRetry("create_payment_transaction", {
  from: walletInfo.data.accounts[0].address,
  to: "RECEIVER_ADDRESS",
  amount: 1000000 // 1 ALGO
});

// 3. Sign transaction
const signedTxn = await agent.useToolWithRetry("sign_transaction", {
  encodedTxn: txnResult.data.encodedTxn
});

// 4. Submit transaction
const result = await agent.useToolWithRetry("submit_transaction", {
  signedTxn: signedTxn.data.signedTxn
});
```

### Example: Asset Opt-In
```typescript
// 1. Get wallet information
const walletInfo = await agent.useToolWithRetry("get_wallet_account", {});

// 2. Create asset opt-in transaction
const txnResult = await agent.useToolWithRetry("asset_optin", {
  address: walletInfo.data.accounts[0].address,
  assetID: 31566704 // USDC on Algorand Mainnet
});

// 3. Sign transaction
const signedTxn = await agent.useToolWithRetry("sign_transaction", {
  encodedTxn: txnResult.data.encodedTxn
});

// 4. Submit transaction
const result = await agent.useToolWithRetry("submit_transaction", {
  signedTxn: signedTxn.data.signedTxn
});
```

## Project Structure

```
packages/
├── server-sse/
│   ├── src/
│   │   ├── index.ts                # Main entry point
│   │   ├── types.ts                # Type definitions
│   │   ├── oauth-handler.ts        # OAuth authentication handler
│   │   ├── workers-oauth-utils.ts  # OAuth utilities
│   │   ├── resources/              # Resource providers
│   │   │   ├── guide/              # Guide resources
│   │   │   ├── knowledge/          # Knowledge resources
│   │   │   └── wallet/             # Wallet resources
│   │   ├── tools/                  # Tool managers
│   │   │   ├── accountManager.ts   # Account management tools
│   │   │   ├── algodManager.ts     # Algorand node tools
│   │   │   ├── arc26Manager.ts     # ARC-26 tools
│   │   │   ├── knowledgeManager.ts # Knowledge tools
│   │   │   ├── utilityManager.ts   # Utility tools
│   │   │   ├── walletManager.ts    # Wallet management tools
│   │   │   ├── apiManager/         # API integration tools
│   │   │   └── transactionManager/ # Transaction tools
│   │   └── utils/                  # Utilities
│   │       ├── Guide.js            # Guide content
│   │       ├── oauth-utils.ts      # OAuth utilities
│   │       └── responseProcessor.ts # Response formatting
└── client-sse/                     # Client implementation
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch: `git checkout -b feature/my-new-feature`
3. Commit your changes: `git commit -am 'Add some feature'`
4. Push to the branch: `git push origin feature/my-new-feature`
5. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.
