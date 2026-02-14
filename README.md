# Algorand Remote MCP

A Model Context Protocol (MCP) server implementation that provides tools and resources for AI agents to interact with the Algorand blockchain.

## Overview

Algorand Remote MCP bridges the gap between AI agents and the Algorand blockchain ecosystem. It serves as a middleware layer that enables AI systems to interact with blockchain technology through a standardized interface, without requiring deep blockchain expertise.

The server is designed to run on Cloudflare Workers and provides a comprehensive set of tools and resources for blockchain operations, including wallet management, transaction creation and submission, API integration, and knowledge access. This is a remote MCP implementation only, focused on providing server-side functionality for AI agents to interact with the Algorand blockchain.

## Features

- **Secure Wallet Management**: Create, access, and manage Algorand wallets with automatic wallet creation for new users
- **HashiCorp Vault Integration**: 
  - Secure storage of sensitive wallet credentials using HashiCorp Vault
  - Ed25519 keypair operations for cryptographic functions
  - Policy that all new accounts use Ed25519 secure secrets engine.
- **Comprehensive Transaction Support**: Create, sign, and submit various transaction types (payments, assets, applications)
- **API Integration**: Access Algorand node, indexer, and NFD APIs through standardized interfaces
- **Knowledge Resources**: Access documentation and guides for Algorand development
- **Multi-Provider OAuth Authentication**: 
  - Secure user authentication through multiple providers (Google, GitHub, Twitter, LinkedIn)
  - Complete authentication lifecycle with login, session management, and logout
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
- **HashiCorp Vault Integration**: 
  - Secure storage of sensitive wallet credentials
  - Ed25519 keypair operations for cryptographic functions
  - Secure key management without exposing private keys
  - Policy that all new accounts use the secure Ed25519 secrets engine
- **Service Bindings**: Inter-worker communication for secure vault operations

## Available Tools

### Account Management
- `sdk_create_algorand_keypair`: Create a new Algorand account keypair
- `sdk_mnemonic_to_address`: View the address associated with a mnemonic
- `sdk_address_to_public_key`: Get the public key for an address
- `sdk_check_account_balance`: Check the balance of an Algorand account

### Wallet Management
- `wallet_get_address`: Get the address for the configured wallet
- `wallet_get_info`: Get account information for the configured wallet
- `wallet_get_assets`: Get assets owned by the configured wallet
- `wallet_get_publickey`: Get the public key for the configured wallet
- `wallet_reset_account`: Reset the wallet account for the configured user
- `wallet_logout`: Logout from the OAuth provider and clear authentication cookies

### Transaction Management
- `sdk_txn_payment_transaction`: Create a payment transaction
- `wallet_sign_transaction`: Sign a transaction with the wallet's credentials
- `sdk_sign_transaction`: Sign a transaction with a provided secret key
- `sdk_send_raw_transaction`: Submit signed transactions to the network
- `sdk_assign_group_id`: Assign a group ID to transactions for atomic execution
- `sdk_build_transactions`: Build transactions from encoded data
- `sdk_group_sign_transactions`: Sign a group of transactions
- `sdk_submit_transactions`: Submit signed transactions to the network
- `sdk_txn_asset_optin`: Create an asset opt-in transaction
- `sdk_txn_asset_transfer`: Create an asset transfer transaction
- `sdk_txn_asset_freeze`: Create an asset freeze transaction
- `sdk_txn_create_asset`: Create a new Algorand Standard Asset
- `sdk_txn_create_application`: Create a new smart contract application
- `sdk_txn_call_application`: Call a smart contract application
- `sdk_txn_update_application`: Update a smart contract application
- `sdk_txn_delete_application`: Delete a smart contract application
- `sdk_txn_opt_into_application`: Opt into an application
- `sdk_txn_close_out_application`: Close out from an application
- `sdk_txn_clear_application_state`: Clear application state

### DEX Integration
- `tinyman_fixed_input_swap`: Perform a fixed-input swap on Tinyman DEX
- `tinyman_fixed_output_swap`: Perform a fixed-output swap on Tinyman DEX

### API Integration
- `algod_get_account_info`: Get account details from Algorand node
- `algod_get_pending_txn_info`: Get pending transaction details
- `api_nfd_get_nfd`: Get NFD domain information
- `api_nfd_get_nfds_for_address`: Get NFD domains for an address

### Utility Tools
- `sdk_validate_address`: Validate an Algorand address
- `sdk_encode_address`: Encode a public key to an Algorand address
- `sdk_decode_address`: Decode an Algorand address to a public key
- `sdk_app_address_by_id`: Get the address for a given application ID
- `sdk_compile_teal`: Compile TEAL source code
- `sdk_disassemble_teal`: Disassemble TEAL bytecode
- `sdk_sign_bytes`: Sign bytes with a secret key
- `sdk_verify_bytes`: Verify a signature against bytes
- `algorand_mcp_guide`: Access comprehensive guide for using Algorand Remote MCP

### Other Tools
- `generate_algorand_uri`: Generate ARC-26 compliant URI
- `generate_algorand_qrcode`: Generate QR code for Algorand URI
- `generate_algorand_receipt`: Generate a transaction receipt
- `generate_ap2_mandate`: Generate an AP2 payment mandate

## Available Resources

### Wallet Resources
- `algorand://wallet/address`: Wallet account address
- `algorand://wallet/account`: Wallet account information
- `algorand://wallet/assets`: Wallet account assets
- `algorand://wallet/publickey`: Wallet account public key

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
- HashiCorp Vault worker for secure credential storage

### Environment Variables
```
ALGORAND_NETWORK=mainnet
ALGORAND_ALGOD=https://your-algod-node.com
ALGORAND_INDEXER=https://your-indexer-node.com
NFD_API_URL=https://api.nf.domains
ALGORAND_TOKEN=your-api-token
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
HCV_WORKER_URL=https://your-hashicorp-vault-worker.workers.dev
```

### Deployment
1. Clone the repository
2. Install dependencies: `npm install`
3. Configure environment variables in `wrangler.jsonc`
4. Deploy to Cloudflare Workers: `wrangler deploy`

## Usage

### Authentication Flow for users
1. User authenticates through their preferred OAuth provider (Google, GitHub, Twitter, LinkedIn)
2. Server creates or retrieves wallet credentials from HashiCorp Vault
3. User can now access tools and resources through the MCP interface
4. When finished, user can logout using the `wallet_logout` tool, which clears authentication cookies

### Transaction Flow for Agents

#### Individual Transactions
1. Create transaction using appropriate tool (e.g., `sdk_txn_payment_transaction`)
2. Sign transaction with wallet credentials using `wallet_sign_transaction`
3. Submit transaction to network using `sdk_send_raw_transaction`
4. Verify transaction success

#### Atomic Transaction Groups
1. Create multiple transactions and assign group ID using `sdk_assign_group_id`
2. Sign the transaction group using `sdk_group_sign_transactions`
3. Submit the signed group to the network using `sdk_submit_transactions`
4. Verify transaction success


## Project Structure

```
├── src/                          # Source code directory
│   ├── index.ts                  # Main entry point
│   ├── types.ts                  # Type definitions
│   ├── oauth-handler.ts          # OAuth authentication handler
│   ├── workers-oauth-utils.ts    # OAuth utilities
│   ├── resources/                # Resource providers
│   │   ├── guide/                # Guide resources
│   │   ├── knowledge/            # Knowledge resources
│   │   └── wallet/               # Wallet resources
│   ├── tools/                    # Tool managers
│   │   ├── accountManager.ts     # Account management tools
│   │   ├── algodManager.ts       # Algorand node tools
│   │   ├── arc26Manager.ts       # ARC-26 tools
│   │   ├── knowledgeManager.ts   # Knowledge tools
│   │   ├── utilityManager.ts     # Utility tools
│   │   ├── walletManager.ts      # Wallet management tools
│   │   ├── apiManager/           # API integration tools
│   │   └── transactionManager/   # Transaction tools
│   └── utils/                    # Utilities
│       ├── Guide.js              # Guide content
│       ├── algoClient.ts         # Shared Algorand client factory
│       ├── vaultManager.ts       # HashiCorp Vault utilities for secret storage and cryptographic operations
│       └── responseProcessor.ts  # Response formatting
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

### Utility and Cryptographic Tools
1. `sdk_validate_address` - Check if an Algorand address is valid
2. `sdk_encode_address` - Encode a public key to an Algorand address
3. `sdk_decode_address` - Decode an Algorand address to a public key
4. `sdk_app_address_by_id` - Get the address for a given application ID
5. `sdk_verify_bytes` - Verify a signature against bytes with an Algorand address
6. `sdk_sign_bytes` - Sign bytes with a secret key

### Account Management
7. `sdk_create_algorand_keypair` - Create a new Algorand account keypair
8. `sdk_mnemonic_to_address` - View the address associated with a mnemonic
9. `sdk_address_to_public_key` - Get the public key for an address
10. `sdk_check_account_balance` - Check the balance of an Algorand account

### Wallet Management
11. `wallet_get_publickey` - Get the public key for the configured wallet
12. `wallet_get_address` - Get the address for the configured wallet
13. `wallet_get_info` - Get the account information for the configured wallet
14. `wallet_get_assets` - Get the assets for the configured wallet
15. `wallet_reset_account` - Reset the wallet account for the configured user
16. `wallet_logout` - Logout from the OAuth provider and clear authentication cookies

### Transaction Operations
17. `sdk_txn_payment_transaction` - Create a payment transaction on Algorand
18. `wallet_sign_transaction` - Sign an Algorand transaction with your wallet account
19. `sdk_sign_transaction` - Sign a transaction with a provided secret key
20. `sdk_send_raw_transaction` - Submit signed transactions to the Algorand network
21. `sdk_assign_group_id` - Assign a group ID to a set of transactions for atomic execution
22. `sdk_build_transactions` - Build transactions from encoded data
23. `sdk_group_sign_transactions` - Sign a group of transactions
24. `sdk_submit_transactions` - Submit signed transactions to the network

### Asset Operations
25. `sdk_txn_create_asset` - Create a new Algorand Standard Asset (ASA)
26. `sdk_txn_asset_optin` - Opt-in to an Algorand Standard Asset (ASA)
27. `sdk_txn_asset_transfer` - Transfer an Algorand Standard Asset (ASA)
28. `sdk_txn_asset_freeze` - Freeze an Algorand Standard Asset (ASA)

### Application (Smart Contract) Operations
29. `sdk_txn_create_application` - Create a new smart contract application on Algorand
30. `sdk_txn_update_application` - Update an existing smart contract application
31. `sdk_txn_delete_application` - Delete an existing smart contract application
32. `sdk_txn_close_out_application` - Close out from an Algorand application
33. `sdk_txn_clear_application_state` - Clear state for an Algorand application
34. `sdk_txn_call_application` - Call a smart contract application on Algorand
35. `sdk_txn_opt_into_application` - Opt-in to an Algorand application

### TEAL Operations
36. `sdk_compile_teal` - Compile TEAL source code
37. `sdk_disassemble_teal` - Disassemble TEAL bytecode into source code

### URI and Receipt Generation
38. `generate_algorand_uri` - Generate a URI following the ARC-26 specification
39. `generate_algorand_qrcode` - Generate a QR code for an Algorand URI
40. `generate_algorand_receipt` - Generate a transaction receipt

### DEX Integration (Tinyman)
41. `tinyman_fixed_input_swap` - Perform a fixed-input swap on Tinyman DEX
42. `tinyman_fixed_output_swap` - Perform a fixed-output swap on Tinyman DEX

### AP2 Mandate
43. `generate_ap2_mandate` - Generate an AP2 payment mandate

### Algod API Access
44. `algod_get_account_info` - Get current account balance, assets, and auth address from algod
45. `algod_get_account_application_info` - Get account-specific application information
46. `algod_get_account_asset_info` - Get account-specific asset information
47. `algod_get_application_info` - Get application details from algod
48. `algod_get_application_box_value` - Get application box contents
49. `algod_get_application_boxes` - Get all application boxes
50. `algod_get_application_state` - Get application global state
51. `algod_get_asset_info` - Get asset details from algod
52. `algod_get_asset_holding` - Get asset holding information for an account
53. `pera_asset_verification_status` - Get the verification status of an Algorand asset from Pera Wallet
54. `pera_verified_asset_details` - Get detailed information about an Algorand asset from Pera Wallet
55. `pera_verified_asset_search` - Search verified Algorand assets by name, unit name, or creator address
56. `algod_get_pending_txn_info` - Get pending transaction details by transaction ID
57. `algod_get_pending_transactions` - Get pending transactions from algod mempool

### Indexer API Access
58. `indexer_lookup_account_assets` - Get account assets
59. `indexer_lookup_account_app_local_states` - Get account application local states
60. `indexer_lookup_account_created_apps` - Get applications created by an account
61. `indexer_search_for_accounts` - Search for accounts with various criteria
62. `indexer_lookup_application_logs` - Get application log messages
63. `indexer_search_for_applications` - Search for applications with various criteria
64. `indexer_lookup_asset_balances` - Get accounts that hold a specific asset
65. `indexer_search_for_assets` - Search for assets with various criteria
66. `indexer_lookup_transaction_by_id` - Get transaction details from indexer
67. `indexer_lookup_account_transactions` - Get transactions related to an account
68. `indexer_search_for_transactions` - Search for transactions with various criteria

### NFD (Algorand Name Service) Operations
69. `api_nfd_get_nfd` - Get NFD domain information by name
70. `api_nfd_get_nfds_for_address` - Get all NFD domains owned by an address

### Knowledge and Documentation
71. `algorand_mcp_guide` - Access comprehensive guide for using Algorand Remote MCP
72. `get_knowledge_doc` - Get markdown content for specified knowledge documents
73. `list_knowledge_docs` - List available knowledge documents by category
74. `fetch` - Fetch content from a URL
75. `search` - Search for information

## Resources full index

### Algorand Wallet Resources
1. `algorand://wallet/publickey` - Wallet Account Public Key
2. `algorand://wallet/address` - Wallet Account Address
3. `algorand://wallet/account` - Wallet Account Information
4. `algorand://wallet/assets` - Wallet Account Assets
### Algorand Knowledge Resources
5. `algorand://knowledge/taxonomy` - Algorand Knowledge Full Taxonomy
6. `algorand://knowledge/taxonomy/arcs` - Algorand Request for Comments
7. `algorand://knowledge/taxonomy/sdks` - Software Development Kits
8. `algorand://knowledge/taxonomy/algokit` - AlgoKit
9. `algorand://knowledge/taxonomy/algokit-utils` - AlgoKit Utils
10. `algorand://knowledge/taxonomy/tealscript` - TEALScript
11. `algorand://knowledge/taxonomy/puya` - Puya
12. `algorand://knowledge/taxonomy/liquid-auth` - Liquid Auth
13. `algorand://knowledge/taxonomy/python` - Python Development
14. `algorand://knowledge/taxonomy/developers` - Developer Documentation
15. `algorand://knowledge/taxonomy/clis` - CLI Tools
16. `algorand://knowledge/taxonomy/nodes` - Node Management
17. `algorand://knowledge/taxonomy/details` - Developer Details
### Algorand Remote MCP Guide
18. `algorand://remote-mcp-guide` - Algorand MCP Guide
