/**
 * Vault Manager for Algorand Remote MCP
 * Provides utility functions for interacting with the Hashicorp Vault worker
 */

import { Env } from '../types';

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
 * Response from the signData function
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
 * Store a mnemonic in the vault for a given email
 * @param env Environment with HCV_WORKER binding
 * @param email User email as the key
 * @param mnemonic Mnemonic to store
 * @returns Promise resolving to success status
 */
export async function storeMnemonic(env: Env, email: string, mnemonic: string): Promise<boolean> {
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
        value: mnemonic
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to store mnemonic in vault:', errorText);
      return false;
    }
    
    const result = await response.json();
    return result.status === 'success';
  } catch (error: any) {
    console.error('Error storing mnemonic in vault:', error.message || 'Unknown error');
    return false;
  }
}

/**
 * Retrieve a mnemonic from the vault for a given email
 * @param env Environment with HCV_WORKER binding
 * @param email User email as the key
 * @returns Promise resolving to the mnemonic or undefined if not found
 */
export async function retrieveMnemonic(env: Env, email: string): Promise<string | undefined> {
  if (!env.HCV_WORKER) {
    console.error('Hashicorp Vault worker not configured');
    return undefined;
  }

  try {
    const secretPath = `${email}`;
    console.log('Retrieving mnemonic from vault for email:', email);
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
      console.error('Failed to retrieve mnemonic from vault:', errorText);
      return undefined;
    }
    
    const result = await response.json();
    return result.value;
  } catch (error: any) {
    console.error('Error retrieving mnemonic from vault:', error.message || 'Unknown error');
    return undefined;
  }
}

/**
 * Delete a mnemonic from the vault for a given email
 * @param env Environment with HCV_WORKER binding
 * @param email User email as the key
 * @returns Promise resolving to success status
 */
export async function deleteMnemonic(env: Env, email: string): Promise<boolean> {
  if (!env.HCV_WORKER) {
    console.error('Hashicorp Vault worker not configured');
    return false;
  }

  try {
    const secretPath = encodeURIComponent(email);
    const response = await env.HCV_WORKER.fetch(`${env.HCV_WORKER_URL}/secret/${secretPath}`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to delete mnemonic from vault:', errorText);
      return false;
    }
    
    const result = await response.json();
    return result.status === 'success';
  } catch (error: any) {
    console.error('Error deleting mnemonic from vault:', error.message || 'Unknown error');
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
    const encodedKeyName = encodeURIComponent(keyName);
    const response = await env.HCV_WORKER.fetch(`${env.HCV_WORKER_URL}/transit/publickey/${encodedKeyName}`, {
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
export async function signData(env: Env, data: string, keyName: string = 'algorand-key'): Promise<SignatureResponse> {
  if (!env.HCV_WORKER) {
    console.error('Hashicorp Vault worker not configured');
    return { success: false, error: 'Hashicorp Vault worker not configured' };
  }

  try {
    const encodedKeyName = encodeURIComponent(keyName);
    const response = await env.HCV_WORKER.fetch(`${env.HCV_WORKER_URL}/transit/sign/${encodedKeyName}`, {
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
    const encodedKeyName = encodeURIComponent(keyName);
    const response = await env.HCV_WORKER.fetch(`${env.HCV_WORKER_URL}/transit/verify/${encodedKeyName}`, {
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
