import { RouterClient } from '@txnlab/haystack-router';
import { Env } from '../../../types';

// Default free tier API key (60 requests/min)
const DEFAULT_API_KEY = '1b72df7e-1131-4449-8ce1-29b79dd3f51e';

// Memoized RouterClient instances per network
const routerClients = new Map<string, RouterClient>();

export function getRouterClient(env: Env): RouterClient {
  const network = env.ALGORAND_NETWORK || 'mainnet';
  let client = routerClients.get(network);
  if (!client) {
    const config: any = {
      apiKey: env.HAYSTACK_API_KEY || DEFAULT_API_KEY,
      autoOptIn: true,
    };
    if (env.ALGORAND_ALGOD) {
      config.algodUri = env.ALGORAND_ALGOD;
    }
    client = new RouterClient(config);
    routerClients.set(network, client);
  }
  return client;
}
