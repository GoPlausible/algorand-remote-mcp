/**
 * Vault Manager for Algorand Remote MCP
 * Provides utility functions for interacting with the Hashicorp Vault worker
 */

import algosdk from 'algosdk';
import { Env } from '../types';

/**
 * Account type enum
 */
export type AccountType = 'vault' | 'kv' | null;



/**
 * Response from the create Keypair function
 */
export interface KeypairResponse {
  success: boolean;
  keyName: string;
  error?: string;
}

/**
 * Response from the getPublicKey function
 */
export interface PublicKeyResponse {
  success: boolean;
  publicKey?: string;
  error?: string;
}

/**
 * Response from the signWithTransit function
 */
export interface SignatureResponse {
  success: boolean;
  signature?: string;
  error?: string;
}

/**
 * Response from the verifySignature function
 */
export interface VerificationResponse {
  success: boolean;
  valid?: boolean;
  error?: string;
}

/**
 * Response from the createNewEntity function
 */
export interface EntityResponse {
  success: boolean;
  entityId?: string;
  token?: string;
  error?: string;
}

/**
 * Response from the checkIdentityEntity function
 */
export interface EntityCheckResponse {
  success: boolean;
  exists: boolean;
  entityDetails?: any;
  error?: string;
}



/**
 * Store a secret in the vault for a given email
 * @param env Environment with HCV_WORKER binding
 * @param email User email as the key
 * @param secret to store
 * @returns Promise resolving to success status
 */
export async function storeSecret(env: Env, email: string, secret: string): Promise<boolean> {
  if (!env.HCV_WORKER) {
    console.error('Hashicorp Vault worker not configured');
    return false;
  }

  try {
    const secretPath = `${email}`;
    const response = await env.HCV_WORKER.fetch(`${env.HCV_WORKER_URL}/secret/${secretPath}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        value: secret
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to store secret in vault:', errorText);
      return false;
    }

    const result = await response.json();
    return result.status === 'success';
  } catch (error: any) {
    console.error('Error storing secret in vault:', error.message || 'Unknown error');
    return false;
  }
}

/**
 * Retrieve a secret from the vault for a given email
 * @param env Environment with HCV_WORKER binding
 * @param email User email as the key
 * @returns Promise resolving to the secret or undefined if not found
 */
export async function retrieveSecret(env: Env, email: string): Promise<string | undefined> {
  if (!env.HCV_WORKER) {
    console.error('Hashicorp Vault worker not configured');
    return undefined;
  }

  try {
    const secretPath = `${email}`;
    console.log('Retrieving secret from vault for email:', email);
    // Fetch the secret from the vault
    // Note: Adjust the endpoint as per your vault worker's API
    console.log('Fetching secret from vault at path:', secretPath);
    const response = await env.HCV_WORKER.fetch(`${env.HCV_WORKER_URL}/secret/${secretPath}`, {
      method: 'GET'
    });
    console.log('Response from vault:', response);

    if (!response.ok) {
      // If the secret doesn't exist, don't log an error, just return undefined
      if (response.status === 404) {
        return undefined;
      }

      const errorText = await response.text();
      console.error('Failed to retrieve secret from vault:', errorText);
      return undefined;
    }

    const result = await response.json();
    return result.value;
  } catch (error: any) {
    console.error('Error retrieving secret from vault:', error.message || 'Unknown error');
    return undefined;
  }
}

/**
 * Delete a secret from the vault for a given email
 * @param env Environment with HCV_WORKER binding
 * @param email User email as the key
 * @returns Promise resolving to success status
 */
export async function deleteSecret(env: Env, email: string): Promise<boolean> {
  if (!env.HCV_WORKER) {
    console.error('Hashicorp Vault worker not configured');
    return false;
  }

  try {
    const secretPath = `${email}`;
    const response = await env.HCV_WORKER.fetch(`${env.HCV_WORKER_URL}/secret/${secretPath}`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to delete secret from vault:', errorText);
      return false;
    }

    const result = await response.json();
    return result.status === 'success';
  } catch (error: any) {
    console.error('Error deleting secret from vault:', error.message || 'Unknown error');
    return false;
  }
}

/**
 * Create a new Ed25519 keypair in the vault
 * @param env Environment with HCV_WORKER binding
 * @param keyName Optional name for the keypair
 * @returns Promise resolving to keypair creation status
 */
export async function createKeypair(env: Env, keyName?: string): Promise<KeypairResponse> {
  if (!env.HCV_WORKER || !keyName) {
    console.error('Hashicorp Vault worker not configured');
    return { success: false, keyName: keyName || 'No key', error: 'Hashicorp Vault worker not configured' };
  }

  try {
    const body = keyName ? JSON.stringify({ name: keyName }) : '{}';
    const response = await env.HCV_WORKER.fetch(`${env.HCV_WORKER_URL}/transit/keypair`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to create keypair in vault:', errorText);
      return { success: false, keyName: keyName, error: errorText };
    }

    const result = await response.json();
    return { success: true, keyName: keyName };
  } catch (error: any) {
    console.error('Error creating keypair in vault:', error.message || 'Unknown error');
    return { success: false, keyName: keyName, error: error.message || 'Unknown error' };
  }
}

/**
 * Delete a Ed25519 keypair in the vault
 * @param env Environment with HCV_WORKER binding
 * @param keyName Optional name for the keypair 
 * @returns Promise resolving to keypair deletion status
 */
export async function deleteKeypair(env: Env, keyName: string): Promise<KeypairResponse> {
  if (!env.HCV_WORKER || !keyName) {
    console.error('Hashicorp Vault worker not configured');
    return { success: false, keyName: keyName, error: 'Hashicorp Vault worker not configured' };
  }
  try {
    const response = await env.HCV_WORKER.fetch(`${env.HCV_WORKER_URL}/transit/keys/${keyName}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to delete keypair in vault:', errorText);
      return { success: false, keyName: keyName, error: errorText };
    }

    const result = await response.json();
    console.log('Keypair deleted successfully:', result);
    return { success: true, keyName: keyName };
  } catch (error: any) {
    console.error('Error creating keypair in vault:', error.message || 'Unknown error');
    return { success: false, keyName: keyName, error: error.message || 'Unknown error' };
  }
}

/**
 * Get the public key for a keypair from the vault
 * @param env Environment with HCV_WORKER binding
 * @param keyName Name of the keypair 
 * @returns Promise resolving to the public key
 */
export async function getPublicKey(env: Env, keyName: string): Promise<PublicKeyResponse> {
  if (!env.HCV_WORKER || !keyName) {
    console.error('Hashicorp Vault worker not configured');
    return { success: false, error: 'Hashicorp Vault worker not configured' };
  }

  try {
    const response = await env.HCV_WORKER.fetch(`${env.HCV_WORKER_URL}/transit/publickey/${keyName}`, {
      method: 'GET'
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to get public key from vault:', errorText);
      return { success: false, error: errorText };
    }

    const result = await response.json();
    console.log('Public key retrieved successfully:', result);
    return { success: true, publicKey: result.public_key };
  } catch (error: any) {
    console.error('Error getting public key from vault:', error.message || 'Unknown error');
    return { success: false, error: error.message || 'Unknown error' };
  }
}

/**
 * Sign data using a keypair in the vault
 * @param env Environment with HCV_WORKER binding
 * @param keyName Name of the keypair to use for signing 
 * @param data Base64-encoded data to sign
 * @returns Promise resolving to the signature
 */
export async function signWithTransit(env: Env, data: string, keyName: string): Promise<SignatureResponse> {
  if (!env.HCV_WORKER || !keyName) {
    console.error('Hashicorp Vault worker not configured');
    return { success: false, error: 'Hashicorp Vault worker not configured' };
  }

  try {

    const response = await env.HCV_WORKER.fetch(`${env.HCV_WORKER_URL}/transit/sign/${keyName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: data
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to sign data with vault:', errorText);
      return { success: false, error: errorText };
    }

    const result = await response.json();
    return { success: true, signature: result.signature };
  } catch (error: any) {
    console.error('Error signing data with vault:', error.message || 'Unknown error');
    return { success: false, error: error.message || 'Unknown error' };
  }
}

/**
 * Verify a signature using a keypair in the vault
 * @param env Environment with HCV_WORKER binding
 * @param keyName Name of the keypair to use for verification 
 * @param data Base64-encoded data that was signed
 * @param signature Base64-encoded signature to verify
 * @returns Promise resolving to verification result
 */
export async function verifySignature(env: Env, data: string, signature: string, keyName: string): Promise<VerificationResponse> {
  if (!env.HCV_WORKER || !keyName) {
    console.error('Hashicorp Vault worker not configured');
    return { success: false, error: 'Hashicorp Vault worker not configured' };
  }

  try {
    const response = await env.HCV_WORKER.fetch(`${env.HCV_WORKER_URL}/transit/verify/${keyName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: data,
        signature: signature
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to verify signature with vault:', errorText);
      return { success: false, error: errorText };
    }

    const result = await response.json();
    return { success: true, valid: result.valid };
  } catch (error: any) {
    console.error('Error verifying signature with vault:', error.message || 'Unknown error');
    return { success: false, error: error.message || 'Unknown error' };
  }
}

/**
 * Check if user has an account and determine its type
 * @param env Environment with necessary bindings
 * @param email User email
 * @returns Promise resolving to account type or null if no account found
 */
export async function getUserAccountType(env: Env, email: string | undefined): Promise<AccountType> {
  if (!email) {
    console.error('No email provided for account type check');
    return null;
  }

  //Check for vault-based account
  const publicKeyResult = await getPublicKey(env, email);

  if (publicKeyResult.success) {
    return 'vault';
  }
  return null
}

/**
 * Get user's address regardless of storage mechanism
 * @param env Environment with necessary bindings
 * @param email User email
 * @returns Promise resolving to the user's address or null if not found
 */
export async function getUserAddress(env: Env, email: string | undefined): Promise<string | null> {
  if (!email) {
    console.error('No email provided for getting address');
    return null;
  }
  // First try vault-based approach
  const publicKeyResult = await getPublicKey(env, email);

  if (publicKeyResult.success && publicKeyResult.publicKey) {
    // User has a vault-based account
    const publicKeyBuffer = Buffer.from(publicKeyResult.publicKey, 'base64');
    return algosdk.encodeAddress(publicKeyBuffer);
  }

  return null;
}


/**
 * Ensure user has an account, creating one if necessary
 * @param env Environment with necessary bindings
 * @param email User email
 * @returns Promise resolving to account type
 */
export async function ensureUserAccount(env: Env, email: string | undefined): Promise<AccountType> {
  console.log('Ensuring user account for email:', email);
  if (!email || email === '') {
    console.error('No email provided for account creation');
    return null;
  }

  if (!env) {
    console.error('Environment not provided for account creation');
    return null;
  }


  let entityId: string | null = null;

  if (env.VAULT_ENTITIES) {
    console.log(`Checking for existing entity in VAULT_ENTITIES for email: ${email}`);
    try {
      entityId = await env.VAULT_ENTITIES.get(email);
      console.log(`Entity ID for ${email} from KV store:`, entityId);
    } catch (error) {
      console.error('Error getting entity ID from KV store:', error);
    }
  }

  // If no entity exists, create one
  if (!entityId) {
    console.log(`Creating new entity for ${email}`);
    const entityResult = await createNewEntity(env, email);

    if (!entityResult.success) {
      console.error('Failed to create entity:', entityResult.error);
    } else {
      entityId = entityResult.entityId || null;
      console.log(`Created new entity with ID: ${entityId}`);
    }
  }

  // Create a new vault-based account
  console.log(`Creating new keypair for ${email}`);
  const keypairResult = await createKeypair(env, email);

  if (!keypairResult.success) {
    throw new Error(keypairResult.error || 'Failed to create keypair in vault');
  }

  return 'vault';
}

/**
 * Create a new entity in HashiCorp Vault with proper identity mapping
 * This function performs the following steps:
 * 1. Creates a new entity in Vault
 * 2. Gets the OIDC accessor
 * 3. Creates an alias mapping for the entity
 * 4. Creates a token for the entity
 * 
 * @param env Environment with HCV_WORKER binding
 * @param email User email to use as entity name and for metadata
 * @returns Promise resolving to entity creation status and token
 */
export async function createNewEntity(env: Env, email: string): Promise<EntityResponse> {
  if (!env.HCV_WORKER || !email) {
    console.error('Hashicorp Vault worker not configured or email not provided');
    return { success: false, error: 'Hashicorp Vault worker not configured or email not provided' };
  }

  try {
    // Check if the entity already exists
    const existingEntityCheck = await checkIdentityEntity(env, email);
    if (existingEntityCheck && existingEntityCheck.success && existingEntityCheck.entityDetails?.id) {
      console.log(`Entity already exists for email: ${email}`);
      if (env.VAULT_ENTITIES) {
        await env.VAULT_ENTITIES.put(email, existingEntityCheck.entityDetails.id);
      }
      return { success: true, entityId: existingEntityCheck.entityDetails.id };
    }
    console.log(`Creating new entity in vault for email: ${email}`);
    // Step 1: Create the Entity
    const createEntityResponse = await env.HCV_WORKER.fetch(`${env.HCV_WORKER_URL}/v1/identity/entity`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: email,
      })
    });

    if (!createEntityResponse.ok) {
      const errorText = await createEntityResponse.text();
      console.error('Failed to create entity in vault:', errorText);
      return { success: false, error: `Failed to create entity: ${errorText}` };
    }

    const entityResult = await createEntityResponse.json();
    const entityId = entityResult.data.id;
    console.log('Entity created successfully with ID:', entityId);


    if (!entityId) {
      return { success: false, error: 'Entity ID not found in response' };
    }


    // Step 2: Get OIDC Accessor
    // const authMethodsResponse = await env.HCV_WORKER.fetch(`${env.HCV_WORKER_URL}/v1/sys/auth`, {
    //   method: 'GET',
    // });

    // if (!authMethodsResponse.ok) {
    //   const errorText = await authMethodsResponse.text();
    //   console.error('Failed to get auth methods from vault:', errorText);
    //   return { success: false, entityId, error: `Failed to get auth methods: ${errorText}` };
    // }

    // const authMethods = await authMethodsResponse.json();
    // let oidcAccessor = '';

    // // Find the OIDC accessor
    // if (authMethods['oidc/'] && authMethods['oidc/'].accessor) {
    //   oidcAccessor = authMethods['oidc/'].accessor;
    // } else {
    //   return { success: false, entityId, error: 'OIDC accessor not found' };
    // }
    // const oidcAccessor = env.VAULT_OIDC_ACCESSOR; // Use a default or configured OIDC accessor

    // Step 3: Create Alias Mapping Email to Entity
    // const createAliasResponse = await env.HCV_WORKER.fetch(`${env.HCV_WORKER_URL}/v1/identity/entity-alias`, {
    //   method: 'POST',
    //   headers: {
    //     'Content-Type': 'application/json',
    //   },
    //   body: JSON.stringify({
    //     name: email,
    //     canonical_id: entityId,
    //     mount_accessor: oidcAccessor,

    //   })
    // });

    // if (!createAliasResponse.ok) {
    //   const errorText = await createAliasResponse.text();
    //   console.error('Failed to create entity alias in vault:', errorText);
    //   return { success: false, entityId, error: `Failed to create entity alias: ${errorText}` };
    // }
    // console.log('Entity alias created successfully');
    // Write the entityId to VAULT_ENTITIES KV store with email as the key
    if (env.VAULT_ENTITIES) {
      await env.VAULT_ENTITIES.put(email, entityId);
    }

    // Step 4: Create Token for Entity
    // const createTokenResponse = await env.HCV_WORKER.fetch(`${env.HCV_WORKER_URL}/v1/auth/token/create`, {
    //   method: 'POST',
    //   headers: {
    //     'Content-Type': 'application/json',
    //   },
    //   body: JSON.stringify({
    //     entity_id: entityId,
    //     role_name: email.toLowerCase().replace('@', '-').replaceAll('.', '-'),
    //     policies: ["per-user-policy"],
    //     meta: {
    //       email: email,
    //       role_name: email.toLowerCase().replace('@', '-').replaceAll('.', '-')
    //     },
    //     no_default_policy: true,
    //     display_name: `${email}`,
    //     // entity_alias: email,
    //     // role_name: "user-role",
    //   })
    // });

    // if (!createTokenResponse.ok) {
    //   const errorText = await createTokenResponse.text();
    //   console.error('Failed to create token in vault:', errorText);
    //   return { success: false, entityId, error: `Failed to create token: ${errorText}` };
    // }

    // const tokenResult = await createTokenResponse.json();
    // const token = tokenResult.auth.client_token;

    // if (!token) {
    //   return { success: false, entityId, error: 'Token not found in response' };
    // }



    return { success: true, entityId };
  } catch (error: any) {
    console.error('Error creating entity in vault:', error.message || 'Unknown error');
    return { success: false, error: error.message || 'Unknown error' };
  }
}

/**
 * Check if an entity exists in HashiCorp Vault by ID
 * 
 * @param env Environment with HCV_WORKER binding
 * @param entityId ID of the entity to check
 * @returns Promise resolving to entity check status and details if it exists
 */
export async function checkIdentityEntity(env: Env, entityId: string): Promise<EntityCheckResponse> {
  if (!env.HCV_WORKER || !entityId) {
    console.error('Hashicorp Vault worker not configured or entity ID not provided');
    return { success: false, exists: false, error: 'Hashicorp Vault worker not configured or entity ID not provided' };
  }

  try {
    // Make a GET request to the entity endpoint with the provided ID
    const response = await env.HCV_WORKER.fetch(`${env.HCV_WORKER_URL}/v1/identity/entity/id/${entityId}`, {
      method: 'GET'
    });

    // If the response is 404, the entity doesn't exist
    if (response.status === 404) {
      return { success: true, exists: false };
    }

    // If the response is not OK and not 404, there was an error
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to check entity in vault:', errorText);
      return { success: false, exists: false, error: `Failed to check entity: ${errorText}` };
    }

    // Parse the response to get the entity details
    const result = await response.json();

    // Return success with the entity details
    return {
      success: true,
      exists: true,
      entityDetails: result.data
    };
  } catch (error: any) {
    console.error('Error checking entity in vault:', error.message || 'Unknown error');
    return { success: false, exists: false, error: error.message || 'Unknown error' };
  }
}
