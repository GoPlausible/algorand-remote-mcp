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
 * Response from the migrateFromMnemonicToVault function
 */
export interface MigrationResponse {
  success: boolean;
  oldAddress?: string;
  newAddress?: string;
  error?: string;
}

/**
 * Response from the createKeypair function
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
 * Response from the signWithVault function
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
 * @param keyName Optional name for the keypair (defaults to 'algorand-key')
 * @returns Promise resolving to keypair creation status
 */
export async function createKeypair(env: Env, keyName?: string): Promise<KeypairResponse> {
  if (!env.HCV_WORKER) {
    console.error('Hashicorp Vault worker not configured');
    return { success: false, keyName: keyName || 'algorand-key', error: 'Hashicorp Vault worker not configured' };
  }

  try {
    const body = keyName ? JSON.stringify({ name: keyName.toLowerCase().replace(`@gmail.com`, '') }) : '{}';
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
      return { success: false, keyName: keyName || 'algorand-key', error: errorText };
    }
    
    const result = await response.json();
    return { success: true, keyName: keyName || 'algorand-key' };
  } catch (error: any) {
    console.error('Error creating keypair in vault:', error.message || 'Unknown error');
    return { success: false, keyName: keyName || 'algorand-key', error: error.message || 'Unknown error' };
  }
}

/**
 * Get the public key for a keypair from the vault
 * @param env Environment with HCV_WORKER binding
 * @param keyName Name of the keypair (defaults to 'algorand-key')
 * @returns Promise resolving to the public key
 */
export async function getPublicKey(env: Env, keyName: string = 'algorand-key'): Promise<PublicKeyResponse> {
  if (!env.HCV_WORKER) {
    console.error('Hashicorp Vault worker not configured');
    return { success: false, error: 'Hashicorp Vault worker not configured' };
  }

  try {
    const response = await env.HCV_WORKER.fetch(`${env.HCV_WORKER_URL}/transit/publickey/${keyName.toLowerCase().replace(`@gmail.com`, '')}`, {
      method: 'GET'
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to get public key from vault:', errorText);
      return { success: false, error: errorText };
    }
    
    const result = await response.json();
    return { success: true, publicKey: result.public_key };
  } catch (error: any) {
    console.error('Error getting public key from vault:', error.message || 'Unknown error');
    return { success: false, error: error.message || 'Unknown error' };
  }
}

/**
 * Sign data using a keypair in the vault
 * @param env Environment with HCV_WORKER binding
 * @param keyName Name of the keypair to use for signing (defaults to 'algorand-key')
 * @param data Base64-encoded data to sign
 * @returns Promise resolving to the signature
 */
export async function signWithVault(env: Env, data: string, keyName: string = 'algorand-key'): Promise<SignatureResponse> {
  if (!env.HCV_WORKER) {
    console.error('Hashicorp Vault worker not configured');
    return { success: false, error: 'Hashicorp Vault worker not configured' };
  }

  try {

    const response = await env.HCV_WORKER.fetch(`${env.HCV_WORKER_URL}/transit/sign/${keyName.toLowerCase().replace(`@gmail.com`, '')}`, {
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
 * @param keyName Name of the keypair to use for verification (defaults to 'algorand-key')
 * @param data Base64-encoded data that was signed
 * @param signature Base64-encoded signature to verify
 * @returns Promise resolving to verification result
 */
export async function verifySignature(env: Env, data: string, signature: string, keyName: string = 'algorand-key'): Promise<VerificationResponse> {
  if (!env.HCV_WORKER) {
    console.error('Hashicorp Vault worker not configured');
    return { success: false, error: 'Hashicorp Vault worker not configured' };
  }

  try {
    const response = await env.HCV_WORKER.fetch(`${env.HCV_WORKER_URL}/transit/verify/${keyName.toLowerCase().replace(`@gmail.com`, '')}`, {
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
  // Check for vault-based account
  const publicKeyResult = await getPublicKey(env, email);
  
  if (publicKeyResult.success) {
    return 'vault';
  }
  
  // Check for KV-based account
  const secret = await retrieveSecret(env, email);
  
  if (secret) {
    return 'kv';
  }
  
  // No account found
  return null;
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
  
  // Fall back to KV-based approach
  const secret = await retrieveSecret(env, email);
  
  if (secret) {
    // User has a KV-based account
    const account = algosdk.mnemonicToSecretKey(secret);
    return account.addr;
  }
  
  // No account found
  return null;
}

/**
 * Sign data using user's credentials regardless of storage mechanism
 * @param env Environment with necessary bindings
 * @param email User email
 * @param data Data to sign
 * @returns Promise resolving to the signature or null if signing failed
 */
export async function signWithSecret(env: Env, email: string | undefined, data: string): Promise<string | null> {
  if (!email) {
    console.error('No email provided for signing');
    return null;
  }
  
  // Sign with Secrets KV-based approach
  const secret = await retrieveSecret(env, email);
  
  if (secret) {
    // User has a KV-based account
    try {
      const account = algosdk.mnemonicToSecretKey(secret);
      const txn = algosdk.decodeUnsignedTransaction(Buffer.from(data, 'base64'));
      const signedTxn = txn.signTxn(account.sk);
      return Buffer.from(signedTxn).toString('base64');
    } catch (error) {
      console.error('Error signing with KV-based account:', error);
      return null;
    }
  }
  
  // No account found or signing failed
  return null;
}


/**
 * Ensure user has an account, creating one if necessary
 * @param env Environment with necessary bindings
 * @param email User email
 * @returns Promise resolving to account type
 */
export async function ensureUserAccount(env: Env, email: string | undefined): Promise<AccountType> {
  if (!email) {
    console.error('No email provided for account creation');
    return null;
  }
  // Check if user already has an account
  const accountType = await getUserAccountType(env, email);
  
  if (accountType) {
    return accountType;
  }
  
  // No account found, create a new vault-based account
  const keypairResult = await createKeypair(env, email);
  
  if (!keypairResult.success) {
    throw new Error(keypairResult.error || 'Failed to create keypair in vault');
  }
  
  return 'vault';
}


