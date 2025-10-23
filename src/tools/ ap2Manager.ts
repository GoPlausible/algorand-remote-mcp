/**
 * AP2 Manager for Algorand Remote MCP
 * Handles AP2 operations for Algorand keys stored in a HashiCorp vault
 */

import algosdk from 'algosdk';
import { z } from 'zod';
import crypto from 'node:crypto';
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

  // Generate a DID from the public key
  const publicKeyBuffer = Buffer.from(userPublicKey, 'base64');
  const userAddress = algosdk.encodeAddress(publicKeyBuffer);
  const merchantAddress = algosdk.encodeAddress(Buffer.from(merchantPublicKey, 'base64'))
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
      issuer = merchantDid ? merchantDid : 'NA'; // 
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
    "holder": `${mandateType !== 'cart_mandate' ? userDid : merchantDid}`,
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
    'Create an AP2 intent,cart or payment mandate for AP2 process and flow',
    {
      type: z.enum(['intent_mandate', 'cart_mandate', 'payment_mandate']).describe('Mandate type'),
      mandate: z.string().describe('Details for the mandate in stringified JSON format')

    },
    async ({ type, mandate }) => {

      if (!env.ALGORAND_ALGOD) {
        return {
          content: [{
            type: 'text',
            text: 'Algorand node URL not configured'
          }]
        };
      }
      const mandateData = JSON.parse(mandate);

      try {
        const mandateObj = type === 'intent_mandate' ? {
          "contents": {
            "id": mandateData.id,
            "user_signature_required": true,
            "cart_request": {
              "method_data": [
                {
                  "supported_methods": "X402",
                  "data": {
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
          "shopper_signature": mandateData.signature,
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
          "merchant_signature": mandateData.signature,
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
          "user_authorization": mandateData.signature
        };

        // Get the public key from the vault for VC generation
        const publicKeyResult = await getPublicKey(env, props.email, props.provider);
        if (!publicKeyResult.success || !publicKeyResult.publicKey) {
          throw new Error('Failed to get public key from vault for VC generation');
        }

        // Generate the verifiable credential
        const verifiableCredential = await generateVerifiableCredential(
          env,
          props,
          type,
          mandateObj,
          publicKeyResult.publicKey,
          mandateData.merchant_public_key,
        );

        // Return the encoded transaction
        return ResponseProcessor.processResponse({
          mandate: mandateObj,
          vc: verifiableCredential,
          type: type
        });
      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Error creating transaction: ${error.message || 'Unknown error'}`
          }]
        };
      }
    }
  );

  // // Sign AP2 mandate with user's vault credentials
  // server.tool(
  //   'wallet_sign_mandate',
  //   'Sign an AP2 mandate with your agent account',
  //   {
  //     type: z.enum(['intent_mandate', 'cart_mandate', 'payment_mandate']).describe('AP2 Mandate type'),
  //     encodedMandate: z.string().describe('Base64 encoded AP2 mandate to sign')
  //   },
  //   async ({ encodedMandate, type }) => {
  //     try {
  //       if (!props.email || !props.provider) {
  //         throw new Error('Email and provider must be provided in props');
  //       }

  //       // Get the public key from the vault
  //       const publicKeyResult = await getPublicKey(env, props.email, props.provider);

  //       if (!publicKeyResult.success || !publicKeyResult.publicKey) {
  //         throw new Error('Failed to get public key from vault');
  //       }
  //       console.log('Public key from vault:', publicKeyResult.publicKey);
  //       console.log(`Signing transaction for ${props.email} with provider ${props.provider}`);
  //       // Get the raw signature from the vault
  //       console.log('Encoded transaction buffer signing:', new Uint8Array(Buffer.from(encodedMandate, 'base64')));
  //       const finalEncodedMandate = new Uint8Array(Buffer.from(encodedMandate, 'base64'));

  //       const finalEncodedMandateBase64 = Buffer.from(finalEncodedMandate).toString('base64');
  //       const signatureResult = await signWithTransit(env, finalEncodedMandateBase64, props.email, props.provider);


  //       if (!signatureResult.success || !signatureResult.signature) {
  //         throw new Error('Failed to get signature from vault');
  //       }


  //       // Decode the transaction
  //       const mandate = JSON.parse(Buffer.from(encodedMandate, 'base64').toString());
  //       console.log('Decoded AP2 Mandate:', mandate);

  //       // Convert the base64 signature to Uint8Array
  //       const signature = Buffer.from(signatureResult.signature, 'base64');
  //       console.log('Mandate Type:', type);
  //       console.log('Mandate Signature:', signature);


  //       // Convert the base64 public key to Uint8Array
  //       const publicKeyBuffer = Buffer.from(publicKeyResult.publicKey, 'base64');
  //       console.log('Public key buffer:', publicKeyBuffer);

  //       // Get the address from the public key
  //       const signerAddr = algosdk.encodeAddress(publicKeyBuffer);
  //       console.log('Signer address:', signerAddr);


  //       // Return the base64 encoded signed mandate
  //       return ResponseProcessor.processResponse({
  //         signer: signerAddr,
  //         mandate: mandate,
  //         type: type,
  //         signature: Buffer.from(signature).toString('base64')
  //       });

  //     } catch (error: any) {
  //       return {
  //         content: [{
  //           type: 'text',
  //           text: `Error signing AP2 mandate: ${error.message || 'Unknown error'}`
  //         }]
  //       };
  //     }
  //   }
  // );

  // // Generate a verifiable credential for an AP2 mandate
  // server.tool(
  //   'generate_ap2_vc',
  //   'Generate a verifiable credential for an AP2 mandate',
  //   {
  //     type: z.enum(['intent_mandate', 'cart_mandate', 'payment_mandate']).describe('AP2 Mandate type'),
  //     encodedMandate: z.string().describe('Base64 encoded AP2 mandate to create a VC for')
  //   },
  //   async ({ encodedMandate, type }) => {
  //     try {
  //       if (!props.email || !props.provider) {
  //         throw new Error('Email and provider must be provided in props');
  //       }

  //       // Get the public key from the vault
  //       const publicKeyResult = await getPublicKey(env, props.email, props.provider);

  //       if (!publicKeyResult.success || !publicKeyResult.publicKey) {
  //         throw new Error('Failed to get public key from vault');
  //       }

  //       // Decode the mandate
  //       const mandateObj = JSON.parse(Buffer.from(encodedMandate, 'base64').toString());

  //       // Generate the verifiable credential
  //       const vc = generateVerifiableCredential(type, mandateObj, publicKeyResult.publicKey);

  //       // Return the verifiable credential
  //       return ResponseProcessor.processResponse({
  //         mandate: mandateObj,
  //         vc: vc,
  //         type: type
  //       });

  //     } catch (error: any) {
  //       return {
  //         content: [{
  //           type: 'text',
  //           text: `Error generating verifiable credential: ${error.message || 'Unknown error'}`
  //         }]
  //       };
  //     }
  //   }
  // );
}
