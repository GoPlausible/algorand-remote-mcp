/**
 * Vault Manager for Algorand Remote MCP
 * Provides utility functions for interacting with the Hashicorp Vault worker
 */

import { Env } from '../types';



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
    const secretPath = `${email}`;
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
