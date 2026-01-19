/**
 * AP2 Manager for Algorand Remote MCP
 * Handles AP2 operations for Algorand keys stored in a HashiCorp vault
 */

import algosdk from 'algosdk';
import { z } from 'zod';
import { ResponseProcessor } from '../utils';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  Env, Props, VaultResponse,
} from '../types';
import {
  getUserAddress,
  ensureUserAccount,
  getPublicKey,
  signWithTransit
} from '../utils/vaultManager';

// Zod schemas for mandate types
const AmountSchema = z.object({
  currency: z.string().default('USDC'),
  value: z.number()
});

const DisplayItemSchema = z.object({
  label: z.string(),
  amount: AmountSchema
});

// Schema for Intent Mandate data
const IntentMandateSchema = z.object({
  id: z.string(),
  items: z.array(DisplayItemSchema),
  total: z.number(),
  currency: z.string().default('USDC'),
  signature: z.string(),
  merchant_public_key: z.string(),
});

// Schema for Cart Mandate data
const CartMandateSchema = z.object({
  id: z.string(),
  items: z.array(DisplayItemSchema),
  total: z.number(),
  currency: z.string().default('USDC'),
  signature: z.string(),
  merchant_public_key: z.string(),
  payment_requirements: z.object({}).passthrough()
});

// Schema for Payment Mandate data
const PaymentMandateSchema = z.object({
  id: z.string(),
  total: z.number(),
  currency: z.string().default('USDC'),
  signature: z.string(),
  payment_requirements: z.object({
    id: z.string()
  }).passthrough(),
  refund_period: z.number(),
  cart_request_id: z.string(),
  merchant_agent: z.string(),
  merchant_public_key: z.string()
});

// Parse incoming JSON string to validate mandate data based on type
const parseMandateData = (mandateStr: string, type: string): any => {
  const data = JSON.parse(mandateStr);

  switch (type) {
    case 'intent_mandate':
      return IntentMandateSchema.parse(data);
    case 'cart_mandate':
      return CartMandateSchema.parse(data);
    case 'payment_mandate':
      return PaymentMandateSchema.parse(data);
    default:
      throw new Error(`Unsupported mandate type: ${type}`);
  }
};

// Type definition for verifiable credential
interface VerifiableCredential {
  "@context": string[];
  type: string[];
  issuer: { id: string };
  holder: string;
  issuanceDate: string;
  credentialSubject: { mandate: any };
  credentialSchema: { id: string; type: string };
  proof: {
    type: string;
    cryptosuite: string;
    created: string;
    proofPurpose: string;
    verificationMethod: string;
    proofValue: string;
  };
  endorsement?: {
    id: string;
    name: string;
    proof: {
      type: string;
      created: string;
      verificationMethod: string;
      proofPurpose: string;
      proofValue: string;
    };
  };
}

/**
 * Generate a verifiable credential for an AP2 mandate
 * @param mandateType Type of mandate (intent, cart, payment)
 * @param mandate The mandate object
 * @param userPublicKey User's public key in base64 format
 * @returns A verifiable credential object
 */
async function generateVerifiableCredential(env: Env, props: Props, mandateType: string, mandate: any, userPublicKey: string, merchantPublicKey: string): Promise<VerifiableCredential> {
  // Get the current timestamp in ISO format
  const timestamp = new Date().toISOString();
  console.log('Generating VC at timestamp:', timestamp);
  // Generate a DID from the public key
  const publicKeyBuffer = Buffer.from(userPublicKey, 'base64');
  const userAddress = algosdk.encodeAddress(publicKeyBuffer);
  const merchantAddress = algosdk.encodeAddress(Buffer.from(merchantPublicKey, 'base64'))
  console.log('User address for DID:', userAddress);
  console.log('Merchant address for DID:', merchantAddress);
  const userDid = `did:algo:${userAddress}`;
  const merchantDid = mandateType !== 'intent_mandate' ? `did:algo:${merchantAddress}` : null;

  // Determine the VC type based on mandate type
  let vcType: string;
  let schemaId: string;
  let mandateWithType: any;
  let issuer = userDid;

  switch (mandateType) {
    case 'intent_mandate':
      vcType = 'IntentMandateCredential';
      schemaId = 'https://goplausible.xyz/api/schemas/intent-mandate.json';
      mandateWithType = {
        type: 'IntentMandate',
        ...mandate
      };
      break;
    case 'cart_mandate':
      vcType = 'CartMandateCredential';
      schemaId = 'https://goplausible.xyz/api/schemas/cart-mandate.json';
      mandateWithType = {
        type: 'CartMandate',
        ...mandate
      };
      // For cart mandates, the merchant is the issuer (typically)
      issuer = merchantDid; // 
      break;
    case 'payment_mandate':
      vcType = 'PaymentMandateCredential';
      schemaId = 'https://goplausible.xyz/api/schemas/payment-mandate.json';
      mandateWithType = {
        type: 'PaymentMandate',
        ...mandate
      };
      break;
    default:
      throw new Error(`Unsupported mandate type: ${mandateType}`);
  }

  let signatureResult: any = { success: false, signature: null };
  if (mandateType === 'payment_mandate' || mandateType === 'intent_mandate') {
    const finalEncodedMandate = new Uint8Array(Buffer.from(JSON.stringify(mandateWithType)));

    const finalEncodedMandateBase64 = Buffer.from(finalEncodedMandate).toString('base64');
    signatureResult = await signWithTransit(env, finalEncodedMandateBase64, props.email, props.provider);
    if (!signatureResult.success || !signatureResult.signature) {
      throw new Error('Failed to get signature from vault');
    }
  }

  // Create the verifiable credential
  const vc: VerifiableCredential = {
    "@context": [
      "https://www.w3.org/ns/credentials/v2",
      "https://w3id.org/security/suites/ed25519-2020/v1"
    ],
    "type": [
      "VerifiableCredential",
      vcType
    ],
    "issuer": {
      "id": issuer
    },
    "holder": `${mandateType === 'cart_mandate' ? userDid : merchantDid}`,
    "issuanceDate": timestamp,
    "credentialSubject": {
      "mandate": mandateWithType
    },
    "credentialSchema": {
      "id": schemaId,
      "type": "JsonSchema"
    },
    "proof": {
      "type": "DataIntegrityProof",
      "cryptosuite": "eddsa-rdfc-2022",
      "created": timestamp,
      "proofPurpose": "assertionMethod",
      "verificationMethod": `${mandateType !== 'cart_mandate' ? userDid : merchantDid}#auth`,
      "proofValue": signatureResult?.signature ? signatureResult.signature : ''
    }
  };

  // Add endorsement for payment mandates (optional, based on business requirements)
  // if (mandateType === 'payment_mandate') {
  //   vc.endorsement = {
  //     "id": "did:algo:UTI7PAASILRDA3ISHY5M7J7LNRX2AIVQJWI7ZKCCGKVLMFD3VPR5PWSZ4I",
  //     "name": "PLAUSIBLE Protocol",
  //     "proof": {
  //       "type": "EndorsementProofType",
  //       "created": timestamp,
  //       "verificationMethod": "did:algo:goplausible#endorsementKey",
  //       "proofPurpose": "endorsement",
  //       "proofValue": signatureResult.signature
  //     }
  //   };
  // }

  return vc;
}

/**
 * Register AP2 management tools to the MCP server
 */
export async function registerAp2Tools(server: McpServer, env: Env, props: Props): Promise<void> {
  // Ensure user has a vault-based account
  if (!props.email || !props.provider) {
    throw new Error('Email and provider must be provided in props');
  }

  // Generate AP2 mandate tool
  server.tool(
    'generate_ap2_mandate',
    'Create an AP2 intent, cart or payment mandate for AP2 process and flow using fields: id, type (mandate type), items, total, currency, merchant_public_key, payment_requirements, merchant_agent (id) and cart_request_id then returns an stringified object containing verifiableCredential and verifiableCredentialLink.',
    {
      mandate: z.object({
        id: z.string().describe("Unique identifier for the mandate"),
        type: z.enum(["intent_mandate", "cart_mandate", "payment_mandate"]).describe("Mandate type for AP2 flow"),

        // Shared fields
        currency: z.string().default("USDC").describe("Currency code, defaults to USDC"),
        total: z.string().describe("Total amount in smallest unit given currency decimals (e.g., 1000000 = 1 USDC)"),
        items: z
          .array(
            z.object({
              label: z.string().describe("Item name or label"),
              amount: z.object({
                currency: z.string().default("USDC"),
                value: z.string(),
              }),
            })
          )
          .describe("Array of items included in this mandate"),


        merchant_public_key: z
          .string()

          .describe("Merchant's Algorand public key (base32 address or base64-encoded)"),

        // Type-specific fields
        payment_requirements: z
          .object({
            id: z.string().optional(),
            payment_method: z.string().optional(),
            network: z.string().optional(),
            amount: z.string().optional(),
          })
          .optional()
          .describe("Payment requirements object for cart/payment mandates"),

        merchant_agent: z.string().optional().describe("DID or identifier of merchant agent"),
        refund_period: z.string().optional().describe("Refund period in ISO-8601 duration format (e.g., P30D = 30 days)"),
        cart_request_id: z.string().optional().describe("Associated cart or payment request ID"),
      })
    },
    async ({ mandate }) => {
      if (!env.ALGORAND_ALGOD) {
        return {
          content: [{
            type: 'text',
            text: 'Algorand node URL not configured'
          }]
        };
      }
      const type = mandate.type;
      console.log('Generating AP2 mandate of type:', type);



      try {
        // Get the public key from the vault for VC generation
        const publicKeyResult = await getPublicKey(env, props.email, props.provider);
        if (!publicKeyResult.success || !publicKeyResult.publicKey) {
          console.error('Failed to retrieve public key from vault');
          throw new Error('Failed to get public key from vault for VC generation');
        }
        const shopperAddress = algosdk.encodeAddress(Buffer.from(publicKeyResult.publicKey, 'base64'));
        // Parse and validate the mandate data based on type
        const mandateData = mandate;
        console.log('Parsed mandate data:', mandateData);
        if (mandateData.merchant_public_key && mandateData.merchant_public_key.length === 58) {
          mandateData.merchant_public_key = Buffer.from(algosdk.decodeAddress(mandateData.merchant_public_key).publicKey).toString('base64');
          console.log('Converted merchant public key to base64:', mandateData.merchant_public_key);
        }

        const mandateObj = type === 'intent_mandate' ? {
          "contents": {
            "id": mandateData.id,
            "user_signature_required": true,
            "cart_request": {
              "method_data": [
                {
                  "supported_methods": "X402",
                  "data": {
                    "shopper_public_key": publicKeyResult.publicKey,
                    "shopper_address": shopperAddress,
                    "currency": mandateData.currency || "USDC"
                  }
                }
              ],
              "details": {
                "id": mandateData.id,
                "displayItems": mandateData.items,
                "shipping_options": null,
                "modifiers": null,
                "total": {
                  "label": "Total",
                  "amount": {
                    "currency": mandateData.currency || "USDC",
                    "value": mandateData.total
                  },
                  "pending": null
                }
              },
              "options": {
                "requestShipping": true,
                "shippingType": null
              }
            }
          },
          // "shopper_signature": mandateData.signature,
          "timestamp": Date.now()
        } : type === 'cart_mandate' ? {
          "contents": {
            "id": mandateData.id,
            "user_signature_required": false,
            "payment_request": {
              "method_data": [
                {
                  "supported_methods": "X402",
                  "data": {
                    "payment_requirements": mandateData.payment_requirements,
                  }
                }
              ],
              "details": {
                "id": mandateData.id,
                "displayItems": mandateData.items,
                "shipping_options": null,
                "modifiers": null,
                "total": {
                  "label": "Total",
                  "amount": {
                    "currency": mandateData.currency || "USDC",
                    "value": mandateData.total
                  },
                  "pending": null
                }
              },
              "options": {
                "requestPayerName": false,
                "requestPayerEmail": false,
                "requestPayerPhone": false,
                "requestShipping": true,
                "shippingType": null
              }
            }
          },
          // "merchant_signature": mandateData.signature,
          "timestamp": Date.now()
        } : {
          "payment_mandate_contents": {
            "payment_mandate_id": mandateData.id,
            "payment_details_id": mandateData.payment_requirements.id,
            "payment_details_total": {
              "label": "Total",
              "amount": {
                "currency": mandateData.currency || "USDC",
                "value": mandateData.total
              },
              "refund_period": mandateData.refund_period
            },
            "payment_response": {
              "request_id": mandateData.cart_request_id,
              "method_name": "X402",
              "details": {
                "token": mandateData.currency || "USDC"
              },
              "shipping_address": null,
              "shipping_option": null,
              "payer_name": null,
              "payer_email": null,
              "payer_phone": null
            },
            "merchant_agent": mandateData.merchant_agent,
            "timestamp": Date.now()
          },
          // "user_authorization": mandateData.signature
        };



        // Generate the verifiable credential
        console.log('Generating verifiable credential with mandate object:', mandateObj);
        console.log('Using public key:', publicKeyResult.publicKey);
        const verifiableCredential = await generateVerifiableCredential(
          env,
          props,
          type,
          mandateObj,
          publicKeyResult.publicKey,
          mandateData.merchant_public_key, // Provide empty string as fallback for intent mandates
        );
        // Persist VC to KV with 24h TTL
        if (!env.A2A_AP2_STORE) {
          throw new Error('A2A_AP2_STORE KV namespace not configured');
        }
        const key = `ap2-vc-${crypto.randomUUID()}`;
        const value = JSON.stringify({
          verifiableCredential,
          type,
          createdAt: new Date().toISOString()
        });
        await env.A2A_AP2_STORE.put(key, value, { expirationTtl: 24 * 60 * 60 });
        console.log('Stored VC in KV with key:', key);
        console.log('Generated verifiable credential:', verifiableCredential);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              verifiableCredentialLink: key,
              type: type,
              verifiableCredential: verifiableCredential
            }, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Error creating mandate: ${error.message || 'Unknown error'}`
          }]
        };
      }
    }
  );
}
