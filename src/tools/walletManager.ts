/**
 * Wallet Manager for Algorand Remote MCP
 * Provides tool-based access to wallet and account information
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as algosdk from "algosdk";
import { z } from "zod";
import { grantHelpers } from "../oauth-provider";
import { type Env, type Props, VaultResponse } from "../types";
import { ResponseProcessor } from "../utils";
import {
	createKeypair,
	createNewEntity,
	deleteEntity,
	/* ensureUserAccount, */
	deleteKeypair,
	getPublicKey,
	getUserAddress,
	subjectBindingKey,
} from "../utils/vaultManager";
import { revokeOwnSession } from "../workers-oauth-utils";

/**
 * Create and validate an Algorand client
 */
export function createAlgoClient(algodUrl: string, token: string): algosdk.Algodv2 | null {
	if (!algodUrl) {
		console.error("Algorand node URL not configured");
		return null;
	}

	return new algosdk.Algodv2(token, algodUrl, "");
}

/**
 * Get account from mnemonic
 */
export function getAccountFromMnemonic(mnemonic: string | undefined): algosdk.Account | null {
	if (!mnemonic) {
		console.error("No active agent wallet configured");
		return null;
	}

	try {
		return algosdk.mnemonicToSecretKey(mnemonic);
	} catch (error) {
		console.error("Invalid mnemonic:", error);
		return null;
	}
}

/**
 * Build a VAULT_ENTITIES KV key from a provider and an email or entity ID
 */
export function providerKey(provider: string, emailOrEntityId: string | null): string {
	return `${provider}--${emailOrEntityId}`;
}

/**
 * Convert a base64 public key to an Algorand address
 */
export function addressFromBase64PublicKey(publicKeyBase64: string): string {
	const publicKeyBuffer = Buffer.from(publicKeyBase64, "base64");
	return algosdk.encodeAddress(publicKeyBuffer);
}

/**
 * Get the base64 public key of an Algorand address
 */
export function base64PublicKeyFromAddress(address: string): string {
	const pkBytes = algosdk.decodeAddress(address).publicKey;
	return Buffer.from(pkBytes).toString("base64");
}

/**
 * Register wallet management tools to the MCP server
 */
export async function registerWalletTools(
	server: McpServer,
	env: Env,
	props: Props,
): Promise<void> {
	console.log("Registering wallet tools for Algorand Remote MCP");
	if (!props.email || !props.provider) {
		throw new Error("Email and provider must be provided in props");
	}

	// Ensure user has a vault-based account
	// try {
	//   const accType = await ensureUserAccount(env, props.email, props.provider || 'google');
	//   console.log(`User has a ${accType}-based account`);
	// } catch (error: any) {
	//   throw new Error(`Failed to ensure user account: ${error.message || 'Unknown error'}`);
	// }
	//Reset wallet account
	server.tool(
		"wallet_reset_account",
		"Reset the wallet account for the configured user. CAUTION: This will delete existing keys and create new ones. Warn user before proceeding.",
		{},
		async () => {
			try {
				const publicKeyResult = await getPublicKey(env, props.email, props.provider);
				let providerEmail = providerKey(props.provider, props.email);
				let entityId: string | null = await env.VAULT_ENTITIES.get(providerEmail);
				let providerEntity: string | null = providerKey(props.provider, entityId);
				console.log("Wallet reset: current entity", { provider: props.provider, entityId });
				let roleId = null;
				if (entityId) {
					console.log(`Fetching role ID from KV for entity ${entityId}`);
					providerEntity = providerKey(props.provider, entityId);
					roleId = await env.VAULT_ENTITIES.get(providerEntity);
				}
				if (!roleId || !entityId) {
					console.log("Wallet reset: no role or entity ID in KV", {
						provider: props.provider,
						clientId: props.clientId,
						userId: props.id,
						hasEntityId: !!entityId,
						hasRoleId: !!roleId,
					});
					throw new Error("Role or entity ID not found in KV store");
				}

				if (publicKeyResult.success && !publicKeyResult.error) {
					// For vault-based accounts, create a new keypair in the vault
					console.log("Creating new vault-based keypair for user:", props.id);

					// Delete existing keypair if it exists
					// Note: This would require a delete endpoint in the vault worker

					// Create new keypair
					await deleteKeypair(env, props.email, props.provider);

					await deleteEntity(env, props.email, entityId, roleId, props.provider);
					console.log("Deleted entity and role:", { provider: props.provider, entityId });

					providerEmail = providerKey(props.provider, props.email);
					providerEntity = providerKey(props.provider, entityId);
					await env.VAULT_ENTITIES.delete(providerEmail);
					await env.VAULT_ENTITIES.delete(providerEntity);
					// The Vault worker deletes this binding itself from its fix #7 on; deleting it here too is harmless
					await env.VAULT_ENTITIES.delete(subjectBindingKey(props.provider, entityId));
					console.log("Deleted the account's KV keys:", {
						provider: props.provider,
						entityId,
					});
					const entityResult = await createNewEntity(env, props.email, props.provider);
					console.log("New entity created:", {
						success: entityResult.success,
						entityId: entityResult.entityId,
					});
					if (entityResult.success && entityResult.entityId) {
						// The new account belongs to the same provider user (see checkSubjectBinding)
						await env.VAULT_ENTITIES.put(
							subjectBindingKey(props.provider, entityResult.entityId),
							String(props.id),
						);
					}
					await new Promise((resolve) => setTimeout(resolve, 500));
					const keypairResult = await createKeypair(env, props.email, props.provider);

					if (!keypairResult.success) {
						throw new Error(keypairResult.error || "Failed to create keypair in vault");
					}
					console.log("New keypair created");

					const newPublicKeyResult = await getPublicKey(env, props.email, props.provider);

					if (!newPublicKeyResult.success || !newPublicKeyResult.publicKey) {
						throw new Error(
							newPublicKeyResult.error || "Failed to get public key from vault",
						);
					}

					// Convert the public key to an Algorand address
					const address = addressFromBase64PublicKey(newPublicKeyResult.publicKey);
					providerEmail = providerKey(props.provider, props.email);
					entityId = await env.VAULT_ENTITIES?.get(providerEmail);
					providerEntity = providerKey(props.provider, entityId);
					console.log("Wallet reset: new entity", { provider: props.provider, entityId });
					if (!entityId) {
						throw new Error(`No entity ID found for ${providerEmail}`);
					}
					console.log(`Fetching role ID from KV for entity ${providerEntity}`);
					roleId = await env.VAULT_ENTITIES?.get(providerEntity);
					if (!roleId) {
						throw new Error(`No Role ID found for entity: ${providerEntity}`);
					}
					return ResponseProcessor.processResponse({
						address,
						role: roleId,
						user: props.email,
						provider: props.provider,
					});
				}
				throw new Error("No active agent wallet configured");
			} catch (error: any) {
				return {
					content: [
						{
							type: "text",
							text: `Failed to reset wallet account: ${error.message || "Unknown error"}`,
						},
					],
				};
			}
		},
	);
	// // Get wallet public key — DEPRECATED: merged into wallet_get_info
	// server.tool(
	//   'wallet_get_publickey',
	//   'Get the public key for the configured wallet',
	//   {},
	//   async () => {
	//     try {
	//
	//       // Check account type
	//       const publicKeyResult = await getPublicKey(env, props.email, props.provider);
	//       if (!publicKeyResult.success || publicKeyResult.error) {
	//         return {
	//           content: [{
	//             type: 'text',
	//             text: 'No active agent wallet configured'
	//           }]
	//         };
	//       }
	//       let providerEmail = `${props.provider}--${props.email}`
	//
	//       const entityId = await env.VAULT_ENTITIES?.get(providerEmail);
	//       // let providerEntity = `${props.provider}--${entityId}`
	//
	//       console.log(`Entity ID for ${props.email} from KV store:`, entityId);
	//       // let roleId = null;
	//       // if (!!entityId) {
	//       //   console.log(`Fetching role ID from KV for entity ${providerEntity}`);
	//       //   roleId = await env.VAULT_ENTITIES?.get(providerEntity);
	//       // }
	//       return ResponseProcessor.processResponse({
	//         publicKey: publicKeyResult.publicKey,
	//         format: 'base64',
	//         // role: roleId,
	//         user: props.email,
	//         provider: props.provider,
	//       });
	//     } catch (error: any) {
	//       return {
	//         content: [{
	//           type: 'text',
	//           text: `Failed to get public key: ${error.message || 'Unknown error'}`
	//         }]
	//       };
	//     }
	//   }
	// );

	// // Get wallet address — DEPRECATED: merged into wallet_get_info
	// server.tool(
	//   'wallet_get_address',
	//   'Get the address for the configured wallet',
	//   {},
	//   async () => {
	//     try {
	//       // Get address using the unified approach
	//       const address = await getUserAddress(env, props.email, props.provider);
	//
	//       if (!address) {
	//         return {
	//           content: [{
	//             type: 'text',
	//             text: 'No active agent wallet configured'
	//           }]
	//         };
	//       }
	//       let providerEmail = `${props.provider}--${props.email}`
	//       const entityId = await env.VAULT_ENTITIES?.get(providerEmail);
	//       let providerEntity = `${props.provider}--${entityId}`
	//       console.log(`Entity ID for ${providerEmail} from KV store:`, providerEntity);
	//
	//       // let roleId = null;
	//       // if (!!entityId) {
	//       //   console.log(`Fetching role ID from KV for entity ${providerEntity}`);
	//       //   roleId = await env.VAULT_ENTITIES?.get(providerEntity);
	//       // }
	//
	//
	//       return ResponseProcessor.processResponse({
	//         address,
	//         // role: roleId,
	//         user: props.email,
	//         provider: props.provider,
	//       });
	//     } catch (error: any) {
	//       return {
	//         content: [{
	//           type: 'text',
	//           text: `Failed to get address: ${error.message || 'Unknown error'}`
	//         }]
	//       };
	//     }
	//   }
	// );

	// // Get wallet role UUID
	server.tool(
		"wallet_get_role",
		"Get the role UUID for the configured wallet to be used to login into Hashicorp Vault with OIDC. This is a very sensitive piece of information. Always protect it and avoid sharing it!",
		{},
		async () => {
			try {
				const providerEmail = providerKey(props.provider, props.email);
				const entityId = await env.VAULT_ENTITIES?.get(providerEmail);
				const providerEntity = providerKey(props.provider, entityId);
				console.log("Entity ID from KV store:", { provider: props.provider, entityId });
				let roleId = null;
				if (entityId) {
					console.log(`Fetching role ID from KV for entity ${providerEntity}`);
					roleId = await env.VAULT_ENTITIES?.get(providerEntity);
				}
				if (!entityId) {
					return {
						content: [
							{
								type: "text",
								text: "No active agent wallet configured",
							},
						],
					};
				}

				return ResponseProcessor.processResponse({
					role: roleId,
					user: props.email,
					provider: props.provider,
				});
			} catch (error: any) {
				return {
					content: [
						{
							type: "text",
							text: `Failed to get role: ${error.message || "Unknown error"}`,
						},
					],
				};
			}
		},
	);

	// Get wallet account information
	server.tool(
		"wallet_get_info",
		"Get the account information for the configured wallet including address, publicKey, balance, and assets. This replaces wallet_get_address and wallet_get_publickey — both are returned in the response. Always use algorand_mcp_skill tool at the start of each session to obtain required skill on how to operate and interact with this MCP service! ",
		{},
		async () => {
			if (!env.ALGORAND_ALGOD) {
				return {
					content: [
						{
							type: "text",
							text: "Algorand node URL not configured",
						},
					],
				};
			}
			const providerEmail = providerKey(props.provider, props.email);
			const entityId = await env.VAULT_ENTITIES?.get(providerEmail);
			const providerEntity = providerKey(props.provider, entityId);
			console.log("Entity ID from KV store:", { provider: props.provider, entityId });
			// let roleId = null;
			// if (!!entityId) {
			//   console.log(`Fetching role ID from KV for entity ${providerEntity}`);
			//   roleId = await env.VAULT_ENTITIES?.get(providerEntity);
			// }

			try {
				// Get address using the unified approach
				const address = await getUserAddress(env, props.email, props.provider);

				if (!address) {
					return {
						content: [
							{
								type: "text",
								text: "No active agent wallet configured",
							},
						],
					};
				}

				// Create algod client
				const algodClient = createAlgoClient(env.ALGORAND_ALGOD, env.ALGORAND_TOKEN || "");
				if (!algodClient) {
					throw new Error("Failed to create Algorand client");
				}

				// Get account information
				const accountInfo = await algodClient.accountInformation(address).do();
				const pk = base64PublicKeyFromAddress(address);

				return ResponseProcessor.processResponse({
					accounts: [
						{
							address,
							amount: Number(accountInfo.amount),
							assets: accountInfo.assets || [],
							user: props.email,
							provider: props.provider,
							// role: roleId,
							publickey: pk,
						},
					],
				});
			} catch (error: any) {
				return {
					content: [
						{
							type: "text",
							text: `Failed to get account info: ${error.message || "Unknown error"}`,
						},
					],
				};
			}
		},
	);

	// Get wallet assets
	server.tool("wallet_get_assets", "Get the assets for the configured wallet", {}, async () => {
		if (!env.ALGORAND_ALGOD) {
			return {
				content: [
					{
						type: "text",
						text: "Algorand node URL not configured",
					},
				],
			};
		}

		try {
			// Get address using the unified approach
			const address = await getUserAddress(env, props.email, props.provider);

			if (!address) {
				return {
					content: [
						{
							type: "text",
							text: "No active agent wallet configured",
						},
					],
				};
			}

			// Create algod client
			const algodClient = createAlgoClient(env.ALGORAND_ALGOD, env.ALGORAND_TOKEN || "");
			if (!algodClient) {
				throw new Error("Failed to create Algorand client");
			}

			// Get account information
			const accountInfo = await algodClient.accountInformation(address).do();

			return ResponseProcessor.processResponse({
				assets: accountInfo.assets || [],
				user: props.email,
				provider: props.provider,
			});
		} catch (error: any) {
			return {
				content: [
					{
						type: "text",
						text: `Failed to get asset info: ${error.message || "Unknown error"}`,
					},
				],
			};
		}
	});

	// Logout from OAuth provider
	server.tool(
		"wallet_logout",
		"Logout from the OAuth provider and clear authentication cookies",
		{},
		async () => {
			try {
				// The same revocation as /logout, done here: the session's props come from a validated
				// access token, and /logout now requires that token, which a tool never sees
				if (!props.id || !props.clientId) {
					throw new Error("The session does not carry a user and client ID");
				}
				const revoked = await revokeOwnSession(grantHelpers(env), env, {
					userId: props.id,
					clientId: props.clientId,
					provider: props.provider,
					upstreamToken: props.accessToken,
				});
				console.log("Logout: revoked grants", {
					userId: props.id,
					clientId: props.clientId,
					revoked,
				});

				// Return response with clear instructions for the client
				return ResponseProcessor.processResponse({
					success: true,
					message:
						"Successfully logged out. You will need to re-authenticate on your next request.",
					user: props.email,
					provider: props.provider,
					forceReauthentication: true,
				});
			} catch (error: any) {
				console.error("Error during logout:", error);
				return {
					content: [
						{
							type: "text",
							text: `Error during logout: ${error.message || "Unknown error"}`,
						},
					],
				};
			}
		},
	);
}
