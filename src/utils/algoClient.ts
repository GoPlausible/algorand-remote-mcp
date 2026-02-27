import algosdk from 'algosdk';

/**
 * Create and validate an Algorand client.
 * Shared across all tool managers to avoid code duplication.
 */
export function createAlgoClient(algodUrl: string, token: string): algosdk.Algodv2 | null {
  if (!algodUrl) {
    console.error('Algorand node URL not configured');
    return null;
  }

  return new algosdk.Algodv2(token, algodUrl, '');
}
