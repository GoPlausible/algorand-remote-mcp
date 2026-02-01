/**
 * Guide content for Algorand Remote MCP
 * This file contains the full markdown documentation used by AI agents
 */

export const guide = `# Algorand Remote MCP Guide for Agents

> **🌐 NETWORK CONFIGURATION**: This system is configured for **Algorand Mainnet**. All examples and asset IDs reference mainnet assets (e.g., USDC ASA ID: 31566704).
> **🌐 SIGNING TRANSACTIONS**: This system is set to sign transactions on MCP server side not by LLM or agent therefore there is no need to get sensitive data like private key or mnemonic unless explicitly asked by user to use the tools to get those or summoned through an MCP Resource.

## Pre-Transaction Validation Checklist:

1- Account Minimum Balance Requirement (MBR):

An Algorand wallet must always keep 0.1 ALGO to stay active. Use 

Each asset opt-in or app opt-in increases the MBR by another 0.1 ALGO.

Always include these MBR requirements when calculating how much the user needs before approving a transaction.

2- **Verify Asset Opt-In**:
   - For asset-related transactions, ensure the wallet has opted into the asset using the algod_get_account_asset_info tool.
   - If not opted in, use the sdk_txn_asset_optin tool to opt in before proceeding.

3- Transaction Fees:

Every transaction costs 1000 microAlgos (0.001 ALGO).

When you calculate required funds, you must add this fee on top of the MBR and transfer amount.

If sending multiple transactions, add 1000 µAlgos per transaction to your total calculation.

4- Balance Check Before Sending:

Always fetch the most recent wallet balance before attempting to sign or send.

5- Tip-Jar top up QR Code Generation:
If Algo balance or asset balance is insufficient, use the generate_algorand_qrcode tool to provide a “tip-jar” top up QR code so the user can top up immediately.
This only happens for Algo and Asset top-ups. Give the generated QRCode links to user to scan with PeraWallet (important) and top up.

When generating a QR code for funding, use the generate_algorand_qrcode tool with parameters:
   - address: Wallet address
   - amount: Total required amount (including MBR and fees)
   - assetId: (optional) Asset ID if funding an ASA
   - note: Optional note like "Top-up for transaction"

6- Execution Order:

If both Algo and Asset top-ups are required, always handle ALGO funding first, then process asset transactions one by one.

## 🚨 CRITICAL: FIRST STEPS FOR EVERY NEW SESSION

⚠️ **AGENTS MUST INFORM USERS THAT AGENT WALLETS ARE IN OPEN BETA SO BETTER TO BE USED FOR PUBLIC BETA TESTING ON MAINNET PURPOSES ONLY, AT THE START OF EACH SESSION WITH ALGORAND-REMOTE-MCP:**

⚠️ **AGENTS MUST PERFORM THESE ACTIONS AT THE START OF EACH SESSION WITH ALGORAND-REMOTE-MCP:**

**Check Wallet Configuration:**
   - Tool: \`wallet_get_info\`
   - Purpose: Verify wallet exists and is correctly configured
   - Action Required: Use this tool FIRST in EVERY session
   \`\`\`

   proceed to perform blockchain operations:
   - If no wallet or error response:
     * Inform user that wallet configuration is missing.
     * Check wallet again to verify.

⚠️ **ALWAYS verify wallet configuration at the start of EVERY session before attempting any blockchain operations!**

## 📋 Session Workflow Quick Reference

| Step | Action | Tool | Purpose |
|------|--------|------|---------|
| 1 | Check wallet | \`wallet_get_info\` | Verify wallet configuration |
| 2 | Get blockchain data | API query tools | Retrieve necessary information |
| 3 | Create transactions | Transaction tools | Prepare blockchain operations |
| 4 | Sign transaction/s | \`wallet_sign_transaction\` or \`wallet_sign_atomic_group\` | Authorize operations |
| 5 | Submit transaction/s | \`sdk_submit_transaction\` or \`sdk_submit_atomic_group\` | Execute on blockchain |
| 6 | Verify results | API query tools | Confirm operation success |

## Quick Start for LLM Agents (⚠️ Always present to user as "Quick Start Workflows" at each session start)

## Transactions management
The Algorand transaction types are:

- **pay**: Payment transaction (transfers ALGOs between accounts).
- **axfer**: Asset transfer transaction (transfers Algorand Standard Assets, opt-in, clawback, etc.).
- **acfg**: Asset configuration transaction (create, reconfigure, or destroy an Algorand Standard Asset).
- **appl**: Application call transaction (create, call, update, or delete Algorand smart contracts).
- **afrz**: Asset freeze transaction (freeze or unfreeze an asset for a specific account).
- **keyreg**: Key registration transaction (register participation keys for consensus).

> Use the correct transaction type when creating or analyzing transactions. Each type has specific required parameters and behaviors.
> Use sdk_create_atomic_group tool to create a group of transactions that will be executed atomically (all or nothing).

As an LLM agent, here's how to quickly perform basic Algorand operations using direct tool invocation pattern using send payment, asset transfer and asset optin as examples:

### Using Knowledge tools
 - Use list_knowledge_docs to list knowledge document names in a category you send as prefix.
 - Choose your specific knowledge document from result of list_knowledge_docs by sending category as prefix and use get_knowledge_doc to get the content of that document by name (e.g. 'arcs:specs:arc-0003.md' or 'algokit:cli:features:tasks:analyze.md').
 - Knowledge Categories are:
   'arcs': 'Algorand Request for Comments'.
   'sdks': 'Software Development Kits'.
   'algokit': 'AlgoKit'.
   'algokit-utils': 'AlgoKit Utils'.
   'tealscript': 'TEALScript'.
   'puya': 'Puya'.
   'liquid-auth': 'Liquid Auth'.
   'python': 'Python Development'.
   'developers': 'Developer Documentation'.
   'clis': 'CLI Tools'.
   'nodes': 'Node Management'.
   'details': 'Developer Details'.
   

## Common Algorand Mainnet Assets (⚠️ Always present to user as "Common used assets" table at each session start)

Here are frequently used assets on Algorand Mainnet for reference:

| Asset Name | Asset ID | Decimals | Description |
|------------|----------|----------|-------------|
| USDC | 31566704 | 6 | USD Coin - Most common stablecoin |
| USDT | 312769 | 6 | Tether USD - Popular stablecoin |
| ALGO | N/A | 6 | Native Algorand token (no ASA ID needed) |
| goETH | 386192725 | 8 | Wrapped Ethereum |
| goBTC | 386195940 | 8 | Wrapped Bitcoin |

> **Note**: Always verify asset IDs before transactions, as scam tokens may use similar names.

### Common Error Messages and Solutions

| Error Message | Likely Cause | Solution |
|---------------|--------------|----------|
| \`No active agent wallet configured\` | Missing ALGORAND_AGENT_WALLET |Inform user and try again\` |
| \`Error fetching account info\` | Network connection or invalid address | Check ALGORAND_ALGOD setting and address format |
| \`Transaction would result in negative balance\` | Insufficient funds | Ensure sender has enough ALGOs (remember min balance requirements) |
| \`Asset hasn't been opted in\` | Asset not in receiver's account | Receiver must opt in to asset first |
| \`Cannot access knowledge resources\` | R2 bucket misconfiguration | Verify R2 bucket setup and permissions |
| \`Overspend\` | Transaction fee + amount exceeds balance | Reduce amount or add funds to account |

## Understanding Tool Categories

> **Note**: The following tools are directly accessible to LLM agents.

1. Wallet Management Tools (Tool name starts with wallet_):
   - Type: Wallet accounts, signing and verification tools availavle to agents to use.
   - Important tools: \`wallet_get_address\`, \`wallet_get_info\` ,\`wallet_sign_atomic_group\`, \`wallet_sign_transaction\`, \`wallet_get_assets\`, \`wallet_get_publickey\`, \`wallet_reset_account\`.
   - Purpose: Access configured wallet information.
   - Note: wallet_reset_account is extremely sensitive tool that will delete existing keys and create new ones. All funds and assets under existing account will be lost forever! transfer the funds and assets to another account (Ask user for it) before proceeding! Warn user before proceeding.
   
2. Account Information Tools (For accounts other than Agent wallet accounts):
   - Type: Account data retrieval.
   - Important tools: \`algod_get_account_info\`, \`sdk_check_account_balance\`.
   - Purpose: Access account information.
   - Note: Requires valid Algorand address.

3. Transaction Generation Tools (Tool name starts with sdk_txn_):
   - Type: Blockchain transaction creation.
   - Important tools: \`sdk_txn_payment_transaction\`, \`sdk_txn_asset_optin\`, \`sdk_txn_transfer_asset\`.
   - Purpose: Create transactions for apps, assets, payments, etc.
   - Note: Requires proper parameter validation.

4. Transaction Submission and Management Tools:
   - Type: Transaction submission and management.
   - Important tools: \`sdk_submit_atomic_group\`, \`sdk_submit_transaction\`, \`indexer_lookup_account_transactions\`, \`indexer_lookup_transaction_by_id\`.

5. Asset Management Tools:
   - Type: Asset data retrieval.
   - Important tools: \`algod_get_asset_info\`, \`algod_get_asset_holding\`.
   - Purpose: Access asset information.
   - Note: Requires valid Asset ID and/or Algorand address.

6. Verified Asset Tools:
   - Type: PeraWallet Verified Asset data retrieval.
   - Important tools: \`pera_asset_verification_status\`, \`pera_verified_asset_details\`, \`pera_verified_asset_search\`.
   - Purpose: Access verified assets information to be used for swapping, trading, accepting assets, etc.
   - Note: Requires valid Asset ID and/or search query (asset name, unit name, or creator address).

7. Application Management Tools:
   - Type: Smart contract application information retrieval and management.
   - Important tools: \`sdk_txn_create_application\`, \`sdk_txn_call_application\`, \`sdk_txn_update_application\`.
   - Purpose: Create and manage Algorand smart contract applications.
   - Notes: Requires proper application parameters.

8. NFD API Query Tools:
   - Type: Algorand blockchain data retrieval.
   - Important tools:  \`api_nfd_get_nfd\`, \`api_nfd_get_nfds_for_address\`.
   - Notes: 
      - When retrieving NFD data for NFD Address like emg110.algo, transactions should be targeted to depositAccount and not any other field!
      - Always verify the depositAccount field from the NFD data response for transaction operations.
   - Tool: \`api_nfd_get_nfd\`.
   - Purpose: Get NFD address info (use depositAccount for transactions).
   - Parameters:
   \`\`\`
   {
      name: string,
      view?: "brief" | "full",
      includeSales?: boolean
   }
   \`\`\`

   - Tool: \`api_nfd_get_nfds_for_address\`.
   - Purpose: Get all NFD names owned by an Algorand address.
   - Parameters:
   \`\`\`
   {
      address: string,
      view?: "brief" | "full",
      limit?: number
      offset?: number
   }
   \`\`\`

9. Utility Tools
   - Type: Miscellaneous utility functions
   - Important tools: \`sdk_validate_address\`, \`sdk_encode_obj\`, \`sdk_decode_obj\`, \`sdk_compile_teal\`
   Notes:
   These tools provide additional functionality for address validation, object encoding/decoding, and TEAL compilation.

      - Tool: \`sdk_validate_address\`.
      - Purpose: Validate Algorand address.
      - Parameters: \`{ address: string }\`.

      - Tool: \`sdk_encode_obj\`.
      - Purpose: Encode object to msgpack.
      - Parameters: \`{ obj: any }\`.

      - Tool: \`sdk_decode_obj\`.
      - Purpose: Decode msgpack to object.
      - Parameters: \`{ bytes: string }\`.

      - Tool: \`sdk_compile_teal\`.
      - Purpose: Compile TEAL program.
      - Parameters: \`{ source: string }\`.

## Best Practices for Algorand Operations

1. **Transaction Security**
   - Always verify transaction parameters.
   - Use suggested parameters from the network.
   - Include reasonable fees for timely processing.
   - Keep mnemonics and secret keys secure.
   - Use proper error handling for transactions.

2. **Account Management**
   - Verify account exists before operations.
   - Check sufficient balance for operations.
   - Verify asset opt-in before transfers.
   - Handle account rekey operations carefully.
   - Protect sensitive account information.

3. **Smart Contract Interactions**
   - Applications are deployed directly to mainnet (exercise caution).
   - Verify application state before operations.
   - Use proper argument encoding.
   - Handle application state carefully.
   - Understand application approval logic.

4. **Asset Handling**
   - Verify asset configuration before operations.
   - Check decimals for proper amount calculations.
   - Always opt-in before receiving assets.
   - Verify asset balances before transfers.
   - Handle clawback operations carefully.
   - Check asset verification status using \`pera_asset_verification_status\` to avoid scam tokens.
   - Get detailed asset information using \`pera_verified_asset_details\` before interacting with assets.
   - Pay attention to verification tier (verified, unverified, or suspicious) when working with assets.

## Complete common Workflows for LLM Agents

### Algo Payment Workflow

1. Retrieve wallet information and use account address as sender_address:
   \`\`\`
   use_tool: wallet_get_info
   parameters: {}
   \`\`\`

2. Create payment transaction:
   \`\`\`
   use_tool: sdk_txn_payment_transaction
   parameters: {
     "sender": "[sender_address]",
     "receiver": "[receiver_address]",
     "amount": 1000000,
     "note": "Payment note (optional)"
   }
   \`\`\`

3. Sign the transaction:
   \`\`\`
   use_tool: wallet_sign_transaction
   parameters: {
     "encodedTxn": "[encoded_transaction_from_step_2]"
   }
   \`\`\`

4. Submit the transaction and get the transaction ID:
   \`\`\`
   use_tool: sdk_submit_transaction
   parameters: {
     "signedTxn": "[signed_transaction_from_step_3]"
   }
   \`\`\`

### Asset Opt-In Workflow

1. Retrieve wallet information and use account address as sender_address:
   \`\`\`
   use_tool: wallet_get_info
   parameters: {}
   \`\`\`

2. Check if already opted in (optional):
   \`\`\`
   use_tool: algod_get_account_asset_info
   parameters: {
     "address": "[sender_address]",
     "assetId": 31566704  // USDC on Algorand Mainnet
   }
   \`\`\`

3. Create asset opt-in transaction:
   \`\`\`
   use_tool: sdk_txn_asset_optin
   parameters: {
     "address": "[sender_address]",
     "assetID": 31566704  // USDC on Algorand Mainnet
   }
   \`\`\`

4. Sign the transaction:
   \`\`\`
   use_tool: wallet_sign_transaction
   parameters: {
     "encodedTxn": "[encoded_transaction_from_step_3]"
   }
   \`\`\`

5. Submit the transaction and get the transaction ID:
   \`\`\`
   use_tool: sdk_submit_transaction
   parameters: {
     "signedTxn": "[signed_transaction_from_step_4]"
   }
   \`\`\`


### Asset Transfer Workflow

1. Retrieve wallet information and use account address as sender_address:
   \`\`\`
   use_tool: wallet_get_info
   parameters: {}
   \`\`\`

2. Check asset verification status (optional and just to be able to warn user if asset is not verified):
   \`\`\`
   use_tool: pera_asset_verification_status
   parameters: {
     "assetId": 31566704  // USDC on Algorand Mainnet
   }
   \`\`\`

3. Get detailed asset information (optional):
   \`\`\`
   use_tool: pera_verified_asset_details
   parameters: {
     "assetId": 31566704  // USDC on Algorand Mainnet
   }
   \`\`\`

4. Check sender's asset balance:
   \`\`\`
   use_tool: algod_get_account_asset_info
   parameters: {
     "address": "[sender_address]",
     "assetId": 31566704  // USDC on Algorand Mainnet
   }
   \`\`\`

5. Verify recipient has opted in:
   \`\`\`
   use_tool: algod_get_account_asset_info
   parameters: {
     "address": "[recipient_address]",
     "assetId": 31566704  // USDC on Algorand Mainnet
   }
   \`\`\`

6. Create asset transfer transaction:
   \`\`\`
   use_tool: sdk_txn_transfer_asset
   parameters: {
     "sender": "[sender_address]",
     "receiver": "[recipient_address]",
     "assetID": 31566704,  // USDC on Algorand Mainnet
     "amount": 1000000     // 1 USDC (6 decimals)
   }
   \`\`\`

7. Sign the transaction:
   \`\`\`
   use_tool: wallet_sign_transaction
   parameters: {
     "encodedTxn": "[transaction_from_step_6]"
   }
   \`\`\`

8. Submit the transaction and get the transaction ID:
   \`\`\`
   use_tool: sdk_submit_transaction
   parameters: {
     "signedTxn": "[signed_transaction_from_step_7]"
   }
   \`\`\`


## Transaction Examples for Common Use Cases
### USDC Opt-In Example (Mainnet)

1. Retrieve wallet information and use account address as sender_address:
   \`\`\`
   use_tool: wallet_get_info
   parameters: {}
   \`\`\`

2. Check if wallet is already opted-in to USDC:
   \`\`\`
   use_tool: algod_get_account_asset_info
   parameters: {
     "address": "[sender_address]",
     "assetId": 31566704  // USDC ASA ID on Algorand Mainnet
   }
   \`\`\`

3. If not opted-in, create USDC opt-in transaction:
   \`\`\`
   use_tool: sdk_txn_asset_optin
   parameters: {
     "address": "[sender_address]",
     "assetID": 31566704  // USDC ASA ID
   }
   \`\`\`

4. Sign the transaction:
   \`\`\`
   use_tool: wallet_sign_transaction
   parameters: {
     "encodedTxn": "[transaction_from_step_3]"
   }
   \`\`\`

5. Submit the transaction and get the transaction ID:
   \`\`\`
   use_tool: sdk_submit_transaction
   parameters: {
     "signedTxn": "[signed_transaction_from_step_4]"
   }
   \`\`\`

6. Inform the user that they can now receive USDC on Algorand.

Note: For opt-out of asset, first get asset info and then use asset creator address for both to and closeRemainderTo fields in the asset transfer transaction with amount 0.

### USDC Transfer Example (Mainnet)

1. Retrieve wallet information and use account address as sender_address:
   \`\`\`
   use_tool: wallet_get_info
   parameters: {}
   \`\`\`

2. Get sender address from the response.

3. Check sender's USDC balance:
   \`\`\`
   use_tool: algod_get_account_asset_info
   parameters: {
     "address": "[sender_address]",
     "assetId": 31566704  // USDC ASA ID on Algorand Mainnet
   }
   \`\`\`

4. Verify recipient has opted in to USDC:
   \`\`\`
   use_tool: algod_get_account_asset_info
   parameters: {
     "address": "[recipient_address]",
     "assetId": 31566704
   }
   \`\`\`

5. Create USDC transfer transaction (remember USDC has 6 decimals):
   \`\`\`
   use_tool: sdk_txn_transfer_asset
   parameters: {
     "sender": "[sender_address]",
     "receiver": "[recipient_address]",
     "assetID": 31566704,
     "amount": 1000000  // 1 USDC (1,000,000 microUSDC)
   }
   \`\`\`

6. Sign the transaction:
   \`\`\`
   use_tool: wallet_sign_transaction
   parameters: {
     "encodedTxn": "[transaction_from_step_5]"
   }
   \`\`\`

7. Submit the transaction and get the transaction ID:
   \`\`\`
   use_tool: sdk_submit_transaction
   parameters: {
     "signedTxn": "[signed_transaction_from_step_6]"
   }
   \`\`\`



> **Note**: This system is configured for Algorand Mainnet. The examples above use USDC (ASA ID: 31566704). For TestNet testing, you would need to use different asset IDs for test assets. This system does not currently support TestNet.

## Working with Atomic Transaction Groups

1. Atomic Group Creation
   - Tool: \`sdk_create_atomic_group\`.
   - Purpose: Create multiple transactions as one unit.
   - Parameters:
     \`\`\`
     {
       transactions: [
         { type: "pay", params: {...} },
         { type: "axfer", params: {...} },
         ...
       ]
     }
     \`\`\`

2. Signing Groups
   - Tool: \`wallet_sign_atomic_group\`.
   - Purpose: Sign transaction group.
   - Parameters:
     \`\`\`
     {
       encodedTxns: string[],
       keyName: string[]
     }
     \`\`\`

3. Submitting Groups
   - Tool: \`sdk_submit_atomic_group\`.
   - Purpose: Sign and submit transaction group.
   - Parameters:
     \`\`\`
     {
       signedTxns: string[],
     }
     \`\`\`

Note: When manually creating individual transactions for Transaction Grouping and before signing them, you must assign a group ID to the transactions using the \`assign_group_id\` tool.
   - Tool: \`sdk_assign_group_id\`.
   - Purpose: Group transactions for atomic execution.
   - Parameters: \`{ encodedTxns: string[] }\`.
   - Effect: All transactions succeed or all fail.

## Troubleshooting Session Issues

If operations are not working properly, verify:

1. **Wallet Configuration:**
   - Is wallet information retrievable with wallet tools?
   - Does the \`wallet_get_info\` tool return valid information?
   - If wallet tools return errors, suggest wallet configuration to the user.

2. **Network Configuration:**
   - Are ALGORAND_ALGOD and ALGORAND_INDEXER properly set?
   - Are you experiencing network connectivity issues?
   - Is the configured network properly set to Mainnet?

3. **Transaction Issues:**
   - Check minimum balance requirements (0.1A per asset, 0.1A per app).
   - Verify transaction parameters are correct.
   - Check for encoding issues in parameters.
   - Verify proper signing of transactions.

4. **API Issues:**
   - Verify API endpoints are accessible.
   - Check for rate limiting issues.
   - Ensure proper parameter formats in API calls.


## Security Guidelines

⚠️ **MAINNET WARNING**: This system operates on Algorand Mainnet with real assets and real value. Exercise extreme caution with all operations.

1. **Sensitive Data Protection**
   - Private keys are securely stored in HashiCorp Vault.
   - Cryptographic operations happen within the vault.
   - Never display sensitive information to users.
   - Use securely stored wallet configuration.
   - Use Wrangler secrets for sensitive values.

2. **Transaction Best Practices**
   - Always verify transaction outputs before submission.
   - Double-check recipient addresses (mainnet transactions are irreversible).
   - Check fee structures.
   - Use proper atomic grouping for dependent operations.
   - Implement proper error handling.
   - Use simulation before submitting critical transactions.

3. **API Security**
   - Use proper API authorization if possible.
   - Handle rate limiting gracefully.
   - Don't expose API tokens.
   - Implement proper error handling.
   - Validate inputs before API calls.`;
