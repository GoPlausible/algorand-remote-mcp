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

### Authentication Flow for users
1. User authenticates through Google OAuth
2. Server creates or retrieves wallet credentials for the user
3. User can now access tools and resources through the MCP interface

### Transaction Flow for Agents
1. Create transaction using appropriate tool
2. Sign transaction with wallet credentials
3. Submit transaction to network
4. Verify transaction success

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


# Algorand Remote MCP Tools and Resources

## MCP Server Information
- Server Name: `algorand-remote-mcp`
- Connection: `npx mcp-remote https://algorand-remote-mcp.emg110.workers.dev/sse`

## Tools full index

### Cryptographic and Encoding Tools
1. `validate_address` - Check if an Algorand address is valid
2. `encode_address` - Encode a public key to an Algorand address
3. `decode_address` - Decode an Algorand address to a public key
4. `get_application_address` - Get the address for a given application ID
5. `bytes_to_bigint` - Convert bytes to a BigInt
6. `bigint_to_bytes` - Convert a BigInt to bytes
7. `encode_uint64` - Encode a uint64 to bytes
8. `decode_uint64` - Decode bytes to a uint64
9. `verify_bytes` - Verify a signature against bytes with an Algorand address
10. `sign_bytes` - Sign bytes with a secret key
11. `encode_obj` - Encode an object to msgpack format
12. `decode_obj` - Decode msgpack bytes to an object

### Account Management
13. `create_account` - Create a new Algorand account
14. `recover_account` - Recover an Algorand account from mnemonic
15. `check_balance` - Check the balance of an Algorand account
16. `get_wallet_secretkey` - Get the secret key for the configured wallet
17. `get_wallet_publickey` - Get the public key for the configured wallet
18. `get_wallet_mnemonic` - Get the mnemonic for the configured wallet
19. `get_wallet_address` - Get the address for the configured wallet
20. `get_wallet_account` - Get the account information for the configured wallet
21. `get_wallet_assets` - Get the assets for the configured wallet
22. `reset-wallet_account` - Reset the wallet account for the configured user

### Transaction Operations
23. `create_payment_transaction` - Create a payment transaction on Algorand
24. `sign_transaction` - Sign an Algorand transaction with your agent account
25. `submit_transaction` - Submit a signed transaction to the Algorand network
26. `create_key_registration_transaction` - Create a key registration transaction
27. `assign_group_id` - Assign a group ID to a set of transactions for atomic execution
28. `create_atomic_group` - Create an atomic transaction group from multiple transactions
29. `send_atomic_group` - Sign and submit an atomic transaction group in one operation
30. `send_raw_transaction` - Submit signed transactions to the Algorand network
31. `simulate_raw_transactions` - Simulate raw transactions
32. `simulate_transactions` - Simulate encoded transactions

### Asset Operations
33. `create_asset` - Create a new Algorand Standard Asset (ASA)
34. `asset_optin` - Opt-in to an Algorand Standard Asset (ASA)
35. `transfer_asset` - Transfer an Algorand Standard Asset (ASA)

### Application (Smart Contract) Operations
36. `create_application` - Create a new smart contract application on Algorand
37. `update_application` - Update an existing smart contract application
38. `delete_application` - Delete an existing smart contract application
39. `closeout_application` - Close out from an Algorand application
40. `clear_application` - Clear state for an Algorand application
41. `call_application` - Call a smart contract application on Algorand
42. `optin_application` - Opt-in to an Algorand application

### TEAL Operations
43. `compile_teal` - Compile TEAL source code
44. `disassemble_teal` - Disassemble TEAL bytecode into source code

### URI Generation
45. `generate_algorand_uri` - Generate a URI following the ARC-26 specification
46. `generate_payment_uri` - Generate a payment URI following the ARC-26 specification
47. `generate_asset_transfer_uri` - Generate an asset transfer URI following the ARC-26 specification

### API Access
48. `api_algod_get_account_info` - Get current account balance, assets, and auth address from algod
49. `api_algod_get_account_application_info` - Get account-specific application information
50. `api_algod_get_account_asset_info` - Get account-specific asset information
51. `api_algod_get_application_info` - Get application details from algod
52. `api_algod_get_application_box_value` - Get application box contents
53. `api_algod_get_application_boxes` - Get all application boxes
54. `api_algod_get_application_state` - Get application global state
55. `api_algod_get_asset_info` - Get asset details from algod
56. `api_algod_get_asset_holding` - Get asset holding information for an account
57. `api_algod_get_transaction_info` - Get transaction details by transaction ID
58. `api_algod_get_pending_transactions` - Get pending transactions from algod mempool

### Indexer API Access
59. `api_indexer_lookup_account_by_id` - Get account information from indexer
60. `api_indexer_lookup_account_assets` - Get account assets
61. `api_indexer_lookup_account_app_local_states` - Get account application local states
62. `api_indexer_lookup_account_created_applications` - Get applications created by an account
63. `api_indexer_search_for_accounts` - Search for accounts with various criteria
64. `api_indexer_lookup_applications` - Get application information from indexer
65. `api_indexer_lookup_application_logs` - Get application log messages
66. `api_indexer_search_for_applications` - Search for applications with various criteria
67. `api_indexer_lookup_application_box` - Get application box by name
68. `api_indexer_lookup_application_boxes` - Get all application boxes
69. `api_indexer_lookup_asset_by_id` - Get asset information from indexer
70. `api_indexer_lookup_asset_balances` - Get accounts that hold a specific asset
71. `api_indexer_search_for_assets` - Search for assets with various criteria
72. `api_indexer_lookup_transaction_by_id` - Get transaction details from indexer
73. `api_indexer_lookup_account_transactions` - Get transactions related to an account
74. `api_indexer_search_for_transactions` - Search for transactions with various criteria
75. `api_indexer_search` - Search the Algorand indexer for accounts, transactions, assets, or applications

### NFD (Algorand Name Service) Operations
76. `api_nfd_get_nfd` - Get NFD domain information by name
77. `api_nfd_get_nfds_for_address` - Get all NFD domains owned by an address
78. `api_nfd_get_nfd_activity` - Get activity for an NFD domain
79. `api_nfd_get_nfd_analytics` - Get analytics for an NFD domain
80. `api_nfd_browse_nfds` - Browse NFD domains with filtering options
81. `api_nfd_search_nfds` - Search for NFD domains

### General API and Documentation
82. `api_request` - Make a request to an external API
83. `algorand_mcp_guide` - Access comprehensive guide for using Algorand Remote MCP
84. `get_knowledge_doc` - Get markdown content for specified knowledge documents
85. `list_knowledge_docs` - List available knowledge documents by category

## Resources full index

### Algorand Wallet Resources
1. `algorand://wallet/secretkey` - Wallet Account Secret Key
2. `algorand://wallet/publickey` - Wallet Account Public Key
3. `algorand://wallet/mnemonic` - Wallet Account Mnemonic
4. `algorand://wallet/address` - Wallet Account Address
5. `algorand://wallet/account` - Wallet Account Information
6. `algorand://wallet/assets` - Wallet Account Assets
### Algorand Knowledge Resources
7. `algorand://knowledge/taxonomy` - Algorand Knowledge Full Taxonomy
8. `algorand://knowledge/taxonomy/arcs` - Algorand Request for Comments
9. `algorand://knowledge/taxonomy/sdks` - Software Development Kits
10. `algorand://knowledge/taxonomy/algokit` - AlgoKit
11. `algorand://knowledge/taxonomy/algokit-utils` - AlgoKit Utils
12. `algorand://knowledge/taxonomy/tealscript` - TEALScript
13. `algorand://knowledge/taxonomy/puya` - Puya
14. `algorand://knowledge/taxonomy/liquid-auth` - Liquid Auth
15. `algorand://knowledge/taxonomy/python` - Python Development
16. `algorand://knowledge/taxonomy/developers` - Developer Documentation
17. `algorand://knowledge/taxonomy/clis` - CLI Tools
18. `algorand://knowledge/taxonomy/nodes` - Node Management
19. `algorand://knowledge/taxonomy/details` - Developer Details
### Algorand Remote MCP Guide
20. `algorand://remote-mcp-guide` - Algorand MCP Guide
