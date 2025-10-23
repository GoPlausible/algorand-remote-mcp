/**
 * AP2 Manager for Algorand Remote MCP
 * Handles AP2 operations for Algorand keys stored in a HashiCorp vault
 */

import algosdk from 'algosdk';


import { z } from 'zod';
import { ResponseProcessor } from '../../utils';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  Env, Props, VaultResponse,
} from '../../types';
import {
  getUserAddress,
  ensureUserAccount,
  getPublicKey,
  signWithTransit
} from '../../utils/vaultManager';
import * as msgpack from "algo-msgpack-with-bigint"

/**
 * Create and validate an Algorand client
 */
function createAlgoClient(algodUrl: string, token: string): algosdk.Algodv2 | null {
  if (!algodUrl) {
    console.error('Algorand node URL not configured');
    return null;
  }

  return new algosdk.Algodv2(token, algodUrl, '');
}
function ConcatArrays(...arrs: ArrayLike<number>[]) {
  const size = arrs.reduce((sum, arr) => sum + arr.length, 0)
  const c = new Uint8Array(size)

  let offset = 0
  for (let i = 0; i < arrs.length; i++) {
    c.set(arrs[i], offset)
    offset += arrs[i].length
  }

  return c
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
                    "payment_requirements":mandateData.payment_requirements,
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

        // Return the encoded transaction
        return ResponseProcessor.processResponse({
          mandate: mandateObj,
          vc: mandateData.vc || null,
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

  // Sign AP2 mandate with user's vault credentials
  server.tool(
    'wallet_sign_mandate',
    'Sign an AP2 mandate with your agent account',
    {
      type: z.enum(['intent_mandate', 'cart_mandate', 'payment_mandate']).describe('AP2 Mandate type'),
      encodedMandate: z.string().describe('Base64 encoded AP2 mandate to sign')
    },
    async ({ encodedMandate, type }) => {
      try {
        if (!props.email || !props.provider) {
          throw new Error('Email and provider must be provided in props');
        }

        // Get the public key from the vault
        const publicKeyResult = await getPublicKey(env, props.email, props.provider);

        if (!publicKeyResult.success || !publicKeyResult.publicKey) {
          throw new Error('Failed to get public key from vault');
        }
        console.log('Public key from vault:', publicKeyResult.publicKey);
        console.log(`Signing transaction for ${props.email} with provider ${props.provider}`);
        // Get the raw signature from the vault
        const TAG: Buffer = Buffer.from("TX");
        console.log('TAG:', Buffer.from("TX"));
        console.log('Encoded transaction buffer signing:', new Uint8Array(Buffer.from(encodedMandate, 'base64')));
        const finalEncodedTxn = new Uint8Array(Buffer.from(encodedMandate, 'base64'));

        const finalEncodedTxnBase64 = Buffer.from(finalEncodedTxn).toString('base64');
        const signatureResult = await signWithTransit(env, finalEncodedTxnBase64, props.email, props.provider);


        if (!signatureResult.success || !signatureResult.signature) {
          throw new Error('Failed to get signature from vault');
        }


        // Decode the transaction
        const mandate = JSON.parse(Buffer.from(encodedMandate, 'base64').toString());
        console.log('Decoded AP2 Mandate:', mandate);

        // Convert the base64 signature to Uint8Array
        const signature = Buffer.from(signatureResult.signature, 'base64');
        console.log('Mandate Type:', type);
        console.log('Mandate Signature:', signature);


        // Convert the base64 public key to Uint8Array
        const publicKeyBuffer = Buffer.from(publicKeyResult.publicKey, 'base64');
        console.log('Public key buffer:', publicKeyBuffer);

        // Get the address from the public key
        const signerAddr = algosdk.encodeAddress(publicKeyBuffer);
        console.log('Signer address:', signerAddr);


        // Return the base64 encoded signed mandate
        return ResponseProcessor.processResponse({
          signer: signerAddr,
          mandate: mandate,
          type: type,
          signature: Buffer.from(signature).toString('base64')
        });



      } catch (error: any) {
        return {
          content: [{
            type: 'text',
            text: `Error signing AP2 mandate: ${error.message || 'Unknown error'}`
          }]
        };
      }
    }
  );





}
