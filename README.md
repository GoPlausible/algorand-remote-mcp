# Algorand Remote MCP

A Model Context Protocol (MCP) server that provides tools and resources for AI agents to interact with the Algorand blockchain. Built on Cloudflare Workers with HashiCorp Vault-based wallet management and multi-provider OAuth authentication.

## Overview

Algorand Remote MCP bridges AI agents and the Algorand blockchain ecosystem through a standardized MCP interface. It enables AI systems to manage wallets, create and submit transactions, swap tokens via DEX aggregators, and access blockchain data — all without requiring deep blockchain expertise.

This is a **remote MCP** implementation running on Cloudflare Workers with:

- **HashiCorp Vault** for secure Ed25519 key storage and transaction signing
- **Multi-provider OAuth** (Google, GitHub, Twitter, LinkedIn) for user authentication
- **algosdk v3.5.2** for Algorand SDK operations
- **Haystack Router** for best-price DEX aggregation across Tinyman, Pact, Folks, and LST protocols
- **Tinyman SDK** for direct DEX swap operations

## Quick Start

**Prerequisites:** Node.js v16+, an OAuth account (Google, GitHub, Twitter, or LinkedIn)

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "algorand-remote-mcp": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://algorandmcp.goplausible.xyz/sse"
      ]
    }
  }
}
```

Restart your LLM agent and prompt:
```
Read Algorand MCP skill.
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              AI Agents / LLM Clients                       │
│                    (Claude, GPT, Cursor, Windsurf, etc.)                    │
└─────────────────────────────┬───────────────────────────────────────────────┘
                              │ MCP Protocol (SSE / Streamable HTTP)
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     Cloudflare Workers — Edge Runtime                       │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                        OAuthProvider Layer                            │  │
│  │          Google · GitHub · Twitter · LinkedIn (Multi-provider)        │  │
│  └───────────────────────────┬───────────────────────────────────────────┘  │
│                              ▼                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │              AlgorandRemoteMCP (McpAgent / McpServer)                 │  │
│  │                                                                       │  │
│  │  ┌─────────────── Tool Managers ───────────────────────────────────┐  │  │
│  │  │                                                                 │  │  │
│  │  │  walletManager ─── accountManager ─── utilityManager            │  │  │
│  │  │  transactionManager/                                            │  │  │
│  │  │    ├── generalTransaction   (pay, sign, submit, keyreg)         │  │  │
│  │  │    ├── assetTransactions    (ASA create, optin, transfer)       │  │  │
│  │  │    ├── appTransactions      (create, update, delete, call)      │  │  │
│  │  │    └── groupTransactions    (atomic groups)                     │  │  │
│  │  │  algodManager ─── knowledgeManager                              │  │  │
│  │  │  arc26Manager ─── receiptManager ─── ap2Manager                 │  │  │
│  │  │  tinymanManager                                                 │  │  │
│  │  │  apiManager/                                                    │  │  │
│  │  │    ├── algod/       (account, application, asset, txn queries)  │  │  │
│  │  │    ├── indexer/     (search & lookup across all data types)     │  │  │
│  │  │    ├── hayrouter/   (DEX aggregator — quote, swap, optin)      │  │  │
│  │  │    └── nfd/         (Algorand Name Service lookups)            │  │  │
│  │  └─────────────────────────────────────────────────────────────────┘  │  │
│  │                                                                       │  │
│  │  ┌─────────────── Resources ───────────────────────────────────────┐  │  │
│  │  │  algorand://remote-mcp-skill         (Skill definition)        │  │  │
│  │  │  algorand://knowledge/taxonomy       (Knowledge base)          │  │  │
│  │  │  algorand://knowledge/taxonomy/{cat} (Category docs)           │  │  │
│  │  └─────────────────────────────────────────────────────────────────┘  │  │
│  │                                                                       │  │
│  │  ┌─────────────── Utils ───────────────────────────────────────────┐  │  │
│  │  │  ResponseProcessor (pagination, BigInt-safe JSON)               │  │  │
│  │  │  vaultManager (Vault API client)                                │  │  │
│  │  │  Skill.js (skill content)                                       │  │  │
│  │  └─────────────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌─────────────── Cloudflare Bindings ────────────────────────────────────┐ │
│  │  Durable Objects (session state)  ·  KV (OAuth tokens, client reg)    │ │
│  │  R2 Bucket (knowledge documents)  ·  Service Bindings (Vault worker)  │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└──────────┬──────────────────┬──────────────────┬──────────────────┬─────────┘
           │                  │                  │                  │
           ▼                  ▼                  ▼                  ▼
┌──────────────────┐ ┌────────────────┐ ┌────────────────┐ ┌───────────────┐
│  HashiCorp Vault │ │  Algorand Node │ │  DEX Protocols │ │  External APIs│
│  (CF Worker)     │ │  (Algod +      │ │                │ │               │
│                  │ │   Indexer)     │ │  Haystack      │ │  NFD API      │
│  Ed25519 keypair │ │                │ │  Router        │ │  Pera API     │
│  generation      │ │  Nodely.io /   │ │  ┌──────────┐  │ │               │
│  Transit engine  │ │  AlgoNode      │ │  │ Tinyman  │  │ │               │
│  signing         │ │                │ │  │ Pact     │  │ │               │
│  No private key  │ │  MainNet /     │ │  │ Folks    │  │ │               │
│  exposure        │ │  TestNet       │ │  │ LST      │  │ │               │
│                  │ │                │ │  └──────────┘  │ │               │
└──────────────────┘ └────────────────┘ │                │ └───────────────┘
                                        │  Tinyman SDK   │
                                        │  (direct)      │
                                        └────────────────┘
```

### Component Summary

- **AlgorandRemoteMCP**: Main MCP agent extending McpAgent on Cloudflare Workers
- **OAuthProvider**: Multi-provider authentication layer (Google, GitHub, Twitter, LinkedIn)
- **Tool Managers**: 14 specialized managers covering accounts, wallets, transactions, assets, applications, APIs, DEX operations, ARC-26 URIs, receipts, AP2 protocol, and knowledge
- **Resource Providers**: URI-based access to skill definition and knowledge base via R2
- **ResponseProcessor**: Standardized response formatting with pagination and BigInt-safe serialization
- **HashiCorp Vault**: Ed25519 keypair generation and secure signing via Transit engine — no private key exposure
- **Cloudflare Bindings**: Durable Objects for session state, KV for OAuth, R2 for knowledge docs, Service Bindings for Vault worker

## Tools

### Account Management
| Tool | Description |
|------|-------------|
| `sdk_create_algorand_keypair` | Create a new Algorand keypair (not wallet-linked) |
| `sdk_mnemonic_to_address_and_secretkey` | Get address and secret key from a mnemonic |
| `sdk_address_to_public_key` | Get the public key for an Algorand address |
| `sdk_check_account_balance` | Check account balance in ALGO |

### Wallet Management
| Tool | Description |
|------|-------------|
| `wallet_get_info` | Get account information including address, publicKey, balance, and assets (replaces `wallet_get_address` and `wallet_get_publickey`) |
| `wallet_get_role` | Get the role UUID for the configured wallet to be used to login into Hashicorp Vault with OIDC |
| `wallet_get_assets` | Get assets held by the wallet |
| `wallet_reset_account` | Reset wallet and generate new keys (destructive) |
| `wallet_logout` | Logout from OAuth provider |

### Transaction Operations
| Tool | Description |
|------|-------------|
| `sdk_txn_payment_transaction` | Create a payment transaction |
| `wallet_sign_transaction` | Sign a transaction using vault keys |
| `sdk_sign_transaction` | Sign a transaction using a mnemonic |
| `sdk_submit_transaction` | Submit a signed transaction to the network |
| `sdk_txn_key_registration_transaction` | Create a key registration transaction |
| `sdk_assign_group_id` | Assign group ID for atomic execution |
| `sdk_create_atomic_group` | Create an atomic transaction group (pay, axfer, acfg, appl, afrz, keyreg) |
| `wallet_sign_atomic_group` | Sign an atomic group using vault keys |
| `sdk_sign_atomic_group` | Sign an atomic group using a mnemonic |
| `sdk_submit_atomic_group` | Submit a signed atomic group |
| `sdk_send_raw_transaction` | Submit raw signed transactions |

### Asset Operations
| Tool | Description |
|------|-------------|
| `sdk_txn_create_asset` | Create a new Algorand Standard Asset (ASA) |
| `sdk_txn_asset_optin` | Opt-in to an ASA |
| `wallet_usdc_optin` | Opt-in agent wallet to USDC (vault-signed) |
| `sdk_txn_transfer_asset` | Transfer an ASA |

### Application (Smart Contract) Operations
| Tool | Description |
|------|-------------|
| `sdk_txn_create_application` | Create a new smart contract |
| `sdk_txn_update_application` | Update an existing smart contract |
| `sdk_txn_delete_application` | Delete a smart contract |
| `sdk_txn_closeout_application` | Close out from an application |
| `sdk_txn_clear_application` | Clear application state |
| `sdk_txn_call_application` | Call a smart contract (noop, optin, closeout, clear, delete) |
| `sdk_optin_application` | Opt-in to an application |

### DEX — Haystack Router (DEX Aggregator)
| Tool | Description |
|------|-------------|
| `haystack_get_swap_quote` | Get best-price swap quote across multiple DEXes and LST protocols |
| `haystack_execute_swap` | Execute an optimized swap: quote, vault-sign, submit, confirm |
| `haystack_needs_optin` | Check if an address needs to opt-in to an asset before swapping |

### DEX — Tinyman
| Tool | Description |
|------|-------------|
| `tinyman_fixed_input_swap` | Execute a swap with a fixed input amount |
| `tinyman_fixed_output_swap` | Execute a swap with a fixed output amount |

### Algod API
| Tool | Description |
|------|-------------|
| `algod_get_account_info` | Get account balance, assets, and auth address |
| `algod_get_account_application_info` | Get account-specific application info |
| `algod_get_account_asset_info` | Get account-specific asset info |
| `algod_get_application_info` | Get application details |
| `algod_get_application_box_value` | Get application box contents |
| `algod_get_application_boxes` | List application boxes |
| `algod_get_application_state` | Get application global state |
| `algod_get_asset_info` | Get asset details |
| `algod_get_asset_holding` | Get asset holding for an account |
| `algod_get_pending_txn_info` | Get pending transaction details |
| `algod_get_pending_transactions` | Get pending transactions from mempool |

### Pera Wallet Asset Verification
| Tool | Description |
|------|-------------|
| `pera_asset_verification_status` | Get verification status of an asset |
| `pera_verified_asset_details` | Get detailed asset information from Pera |
| `pera_verified_asset_search` | Search verified assets by name, unit name, or creator |

### Indexer API
| Tool | Description |
|------|-------------|
| `indexer_lookup_account_assets` | Get account assets |
| `indexer_lookup_account_app_local_states` | Get account app local states |
| `indexer_lookup_account_created_apps` | Get applications created by an account |
| `indexer_lookup_account_transactions` | Get transactions for an account |
| `indexer_search_for_accounts` | Search accounts with filters |
| `indexer_lookup_application_logs` | Get application log messages |
| `indexer_search_for_applications` | Search applications |
| `indexer_lookup_asset_balances` | Get holders of a specific asset |
| `indexer_search_for_assets` | Search assets |
| `indexer_lookup_transaction_by_id` | Get transaction details |
| `indexer_search_for_transactions` | Search transactions |

### NFD (Algorand Name Service)
| Tool | Description |
|------|-------------|
| `api_nfd_get_nfd` | Get NFD domain information by name |
| `api_nfd_get_nfds_for_address` | Get all NFD domains owned by an address |

### TEAL Operations
| Tool | Description |
|------|-------------|
| `sdk_compile_teal` | Compile TEAL source code |
| `sdk_disassemble_teal` | Disassemble TEAL bytecode |

### Utility Tools
| Tool | Description |
|------|-------------|
| `sdk_validate_address` | Check if an Algorand address is valid |
| `sdk_encode_address` | Encode a public key to an address |
| `sdk_decode_address` | Decode an address to a public key |
| `sdk_app_address_by_id` | Get the address for an application ID |
| `sdk_verify_bytes` | Verify a signature against bytes |
| `sdk_sign_bytes` | Sign bytes with a secret key |
| `algorand_mcp_skill` | Access comprehensive Algorand MCP skill |

### ARC-26 URI & Receipts
| Tool | Description |
|------|-------------|
| `generate_algorand_uri` | Generate an ARC-26 compliant URI |
| `generate_algorand_qrcode` | Generate a QR code for an Algorand URI |
| `generate_algorand_receipt` | Generate a transaction receipt |

### AP2 Protocol
| Tool | Description |
|------|-------------|
| `generate_ap2_mandate` | Create an AP2 intent, cart, or payment mandate with verifiable credentials |

### Knowledge Base
| Tool | Description |
|------|-------------|
| `get_knowledge_doc` | Get markdown content for knowledge documents |
| `list_knowledge_docs` | List available knowledge documents by category |

## Resources

### Knowledge Resources
| URI | Description |
|-----|-------------|
| `algorand://knowledge/taxonomy` | Full taxonomy of knowledge resources |
| `algorand://knowledge/taxonomy/{category}` | Category-specific resources (arcs, sdks, algokit, puya, etc.) |

### Skill
| URI | Description |
|-----|-------------|
| `algorand://remote-mcp-skill` | Comprehensive Algorand MCP skill |

## Development

### Prerequisites
- Node.js v16+
- Cloudflare Workers account
- Algorand node access (e.g., Nodely.io / AlgoNode)
- OAuth credentials (Google, GitHub, Twitter, and/or LinkedIn)
- HashiCorp Vault worker for secure key management

### Environment Variables
```
ALGORAND_NETWORK=mainnet
ALGORAND_ALGOD=https://your-algod-node.com
ALGORAND_INDEXER=https://your-indexer-node.com
ALGORAND_TOKEN=your-api-token
NFD_API_URL=https://api.nf.domains
HAYSTACK_API_KEY=your-haystack-api-key
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
HCV_WORKER_URL=https://your-hashicorp-vault-worker.workers.dev
```

### Scripts
```bash
npm run dev          # Start local development server
npm run type-check   # Run TypeScript type checking
npm run deploy       # Deploy to Cloudflare Workers
npm run format       # Format code with Biome
npm run lint:fix     # Lint and auto-fix with Biome
```

### Deployment
1. Clone the repository
2. Install dependencies: `npm install`
3. Configure environment variables in `wrangler.toml`
4. Deploy: `npm run deploy`

## Usage Flows

### Authentication
1. User authenticates via OAuth (Google, GitHub, Twitter, or LinkedIn)
2. Server creates or retrieves wallet credentials from HashiCorp Vault
3. User accesses tools and resources through the MCP interface
4. User can logout using `wallet_logout`

### Individual Transactions
1. Create transaction (e.g., `sdk_txn_payment_transaction`)
2. Sign with vault (`wallet_sign_transaction`) or mnemonic (`sdk_sign_transaction`)
3. Submit to network (`sdk_submit_transaction`)

### Atomic Transaction Groups
1. Create group (`sdk_create_atomic_group`)
2. Sign group (`wallet_sign_atomic_group` or `sdk_sign_atomic_group`)
3. Submit group (`sdk_submit_atomic_group`)

### DEX Swaps via Haystack Router
1. Get best-price quote (`haystack_get_swap_quote`)
2. Execute swap — quotes, vault-signs, submits, and confirms in one call (`haystack_execute_swap`)

### DEX Swaps via Tinyman
1. Execute fixed-input or fixed-output swap (`tinyman_fixed_input_swap` / `tinyman_fixed_output_swap`)

## Project Structure

```
src/
├── index.ts                      # Main entry point
├── types.ts                      # Type definitions
├── oauth-handler.ts              # OAuth authentication handler
├── workers-oauth-utils.ts        # OAuth utilities
├── resources/
│   ├── skill/                    # Skill resource
│   └── knowledge/                # Knowledge base resources
├── tools/
│   ├── accountManager.ts         # Account management
│   ├── algodManager.ts           # Algorand node tools
│   ├── ap2Manager.ts             # AP2 protocol tools
│   ├── arc26Manager.ts           # ARC-26 URI and QR tools
│   ├── knowledgeManager.ts       # Knowledge base tools
│   ├── receiptManager.ts         # Transaction receipt tools
│   ├── tinymanManager.ts         # Tinyman DEX tools
│   ├── utilityManager.ts         # Utility tools
│   ├── walletManager.ts          # Wallet management tools
│   ├── apiManager/
│   │   ├── algod/                # Algod API tools (account, application, asset, transaction)
│   │   ├── hayrouter/            # Haystack Router DEX aggregator tools
│   │   ├── indexer/              # Indexer API tools (account, application, asset, transaction)
│   │   └── nfd/                  # NFD name service tools
│   └── transactionManager/
│       ├── generalTransaction.ts # Payment, signing, submission, key registration
│       ├── appTransactions.ts    # Application (smart contract) transactions
│       ├── assetTransactions.ts  # Asset create, optin, transfer
│       └── groupTransactions.ts  # Atomic transaction groups
└── utils/
    ├── Skill.js                  # Skill content
    ├── vaultManager.ts           # HashiCorp Vault integration
    └── responseProcessor.ts      # Response formatting and pagination
```

## Key Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `algosdk` | ^3.5.2 | Algorand JavaScript SDK |
| `@txnlab/haystack-router` | ^2.0.5 | DEX aggregator for best-price swaps |
| `@tinymanorg/tinyman-js-sdk` | ^5.1.2 | Tinyman DEX SDK |
| `@modelcontextprotocol/sdk` | ^1.12.1 | MCP protocol SDK |
| `agents` | ^0.0.95 | Cloudflare Agents SDK |
| `algo-msgpack-with-bigint` | ^2.1.1 | MessagePack with BigInt support |

## Contributing

1. Fork the repository
2. Create your feature branch: `git checkout -b feature/my-new-feature`
3. Commit your changes: `git commit -am 'Add some feature'`
4. Push to the branch: `git push origin feature/my-new-feature`
5. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.
