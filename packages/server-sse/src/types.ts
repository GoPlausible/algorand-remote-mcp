import { Buffer } from 'buffer';
export interface EncodedAssetParams {
  /**
   * assetTotal
   */
  t: number | bigint;

  /**
   * assetDefaultFrozen
   */
  df: boolean;

  /**
   * assetDecimals
   */
  dc: number;

  /**
   * assetManager
   */
  m?: Buffer;

  /**
   * assetReserve
   */
  r?: Buffer;

  /**
   * assetFreeze
   */
  f?: Buffer;

  /**
   * assetClawback
   */
  c?: Buffer;

  /**
   * assetName
   */
  an?: string;

  /**
   * assetUnitName
   */
  un?: string;

  /**
   * assetURL
   */
  au?: string;

  /**
   * assetMetadataHash
   */
  am?: Buffer;
}

export interface EncodedLocalStateSchema {
}

export interface EncodedGlobalStateSchema {
}

export interface EncodedBoxReference {
}

/**
 * A rough structure for the encoded transaction object. Every property is labelled with its associated Transaction type property
 */
export interface EncodedTransaction {
  /**
   * fee
   */
  fee?: number;

  /**
   * firstRound
   */
  fv?: number;

  /**
   * lastRound
   */
  lv: number;

  /**
   * note
   */
  note?: Buffer;

  /**
   * from
   */
  snd: Buffer;

  /**
   * type
   */
  type: string;

  /**
   * genesisID
   */
  gen: string;

  /**
   * genesisHash
   */
  gh: Buffer;

  /**
   * lease
   */
  lx?: Buffer;

  /**
   * group
   */
  grp?: Buffer;

  /**
   * amount
   */
  amt?: number | bigint;

  /**
   * amount (but for asset transfers)
   */
  aamt?: number | bigint;

  /**
   * closeRemainderTo
   */
  close?: Buffer;

  /**
   * closeRemainderTo (but for asset transfers)
   */
  aclose?: Buffer;

  /**
   * reKeyTo
   */
  rekey?: Buffer;

  /**
   * to
   */
  rcv?: Buffer;

  /**
   * to (but for asset transfers)
   */
  arcv?: Buffer;

  /**
   * voteKey
   */
  votekey?: Buffer;

  /**
   * selectionKey
   */
  selkey?: Buffer;

  /**
   * stateProofKey
   */
  sprfkey?: Buffer;

  /**
   * voteFirst
   */
  votefst?: number;

  /**
   * voteLast
   */
  votelst?: number;

  /**
   * voteKeyDilution
   */
  votekd?: number;

  /**
   * nonParticipation
   */
  nonpart?: boolean;

  /**
   * assetIndex
   */
  caid?: number;

  /**
   * assetIndex (but for asset transfers)
   */
  xaid?: number;

  /**
   * assetIndex (but for asset freezing/unfreezing)
   */
  faid?: number;

  /**
   * freezeState
   */
  afrz?: boolean;

  /**
   * freezeAccount
   */
  fadd?: Buffer;

  /**
   * assetRevocationTarget
   */
  asnd?: Buffer;

  /**
   * See EncodedAssetParams type
   */
  apar?: EncodedAssetParams;

  /**
   * appIndex
   */
  apid?: number;

  /**
   * appOnComplete
   */
  apan?: number;

  /**
   * See EncodedLocalStateSchema type
   */
  apls?: EncodedLocalStateSchema;

  /**
   * See EncodedGlobalStateSchema type
   */
  apgs?: EncodedGlobalStateSchema;

  /**
   * appForeignApps
   */
  apfa?: number[];

  /**
   * appForeignAssets
   */
  apas?: number[];

  /**
   * appApprovalProgram
   */
  apap?: Buffer;

  /**
   * appClearProgram
   */
  apsu?: Buffer;

  /**
   * appArgs
   */
  apaa?: Buffer[];

  /**
   * appAccounts
   */
  apat?: Buffer[];

  /**
   * extraPages
   */
  apep?: number;

  /**
   * boxes
   */
  apbx?: EncodedBoxReference[];

  /*
   * stateProofType
   */
  sptype?: number | bigint;

  /**
   * stateProof
   */
  sp?: Buffer;

  /**
   * stateProofMessage
   */
  spmsg?: Buffer;
}

export interface EncodedSubsig {
  /**
   *  The public key
   */
  pk: Uint8Array;

  /**
   * The signature provided by the public key, if any
   */
  s?: Uint8Array;
}

export interface EncodedSubsig {
  /**
   *  The public key
   */
  pk: Uint8Array;

  /**
   * The signature provided by the public key, if any
   */
  s?: Uint8Array;
}

/**
 * A rough structure for the encoded multi signature transaction object.
 * Every property is labelled with its associated `MultisigMetadata` type property
 */
export interface EncodedMultisig {
  /**
   * version
   */
  v: number;

  /**
   * threshold
   */
  thr: number;

  /**
   * Subset of signatures. A threshold of `thr` signors is required.
   */
  subsig: EncodedSubsig[];
}

export interface EncodedLogicSig {
  l: Uint8Array;
  arg?: Uint8Array[];
  sig?: Uint8Array;
  msig?: EncodedMultisig;
}

export interface EncodedLogicSigAccount {
  lsig: EncodedLogicSig;
  sigkey?: Uint8Array;
}

/**
 * A structure for an encoded signed transaction object
 */
export interface EncodedSignedTransaction {
  /**
   * Transaction signature
   */
  sig?: Buffer;

  /**
   * The transaction that was signed
   */
  txn: EncodedTransaction;

  /**
   * Multisig structure
   */
  msig?: EncodedMultisig;

  /**
   * Logic signature
   */
  lsig?: EncodedLogicSig;

  /**
   * The signer, if signing with a different key than the Transaction type `from` property indicates
   */
  sgnr?: Buffer;
}
/**
 * Core type definitions for Algorand Remote MCP on Cloudflare Workers
 */

/**
 * State interface for the Durable Object
 * This defines all the persistent state that will be stored
 */
export interface State {
  
  /**
   * Number of items to show per page
   */
  items_per_page: number;
}

/**
 * Environment interface for Cloudflare bindings and variables
 */
export interface Env {

  /**
   * Hashicorp Vault Worker binding for secure secret storage
   */
  HCV_WORKER?: any;
  /**
   * Durable Object namespace for the AlgorandRemoteMCP class
   */
  AlgorandRemoteMCP: DurableObjectNamespace;
  
/**
 * R2 bucket binding for knowledge resources
 */
KNOWLEDGE_BUCKET?: R2Bucket;

/**
 * R2 bucket binding for PlausibleAI documentation
 */
PLAUSIBLE_AI?: R2Bucket;
  
  /**
   * Algorand network to use (mainnet, testnet, etc.)
   */
  ALGORAND_NETWORK?: string;
  
  /**
   * Algorand node URL for API access (base URL)
   */
  ALGORAND_ALGOD?: string;
  
  /**
   * Algorand node API URL with version (e.g., with /v2)
   */
  ALGORAND_ALGOD_API?: string;
  
  /**
   * Algorand node port if different from the default
   */
  ALGORAND_ALGOD_PORT?: string;
  
  /**
   * Algorand Indexer URL for querying historical data (base URL)
   */
  ALGORAND_INDEXER?: string;
  
  /**
   * Algorand Indexer API URL with version (e.g., with /v2)
   */
  ALGORAND_INDEXER_API?: string;
  
  /**
   * Algorand Indexer port if different from the default
   */
  ALGORAND_INDEXER_PORT?: string;
  
  /**
   * NFD API URL for name resolution
   */
  NFD_API_URL?: string;
  
  /**
   * Pera Wallet API URL for asset verification
   */
  PERA_WALLET_API_URL?: string;
  
  /**
   * Pera Explorer URL for asset links
   */
  PERA_EXPLORER_URL?: string;
  
  /**
   * API key for Algorand node access if required
   */
  ALGORAND_TOKEN?: string;
  
  /**
   * Items per page for pagination (default in state)
   */
  ITEMS_PER_PAGE?: string;
  

  OAUTH_KV?: KVNamespace;
  HCV_WORKER_URL?: string; // Hashicorp Vault Worker binding for secure secret storage
  VAULT_ENTITIES?: KVNamespace; // Hashicorp vault entities-emails mappings
  VAULT_OIDC_ACCESSOR: string; // Hashicorp vault OIDC accessors
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  COOKIE_ENCRYPTION_KEY?: string;
}
export interface Props extends Record<string, unknown> {
	name: string;
	email: string;
	accessToken: string;
}
/**
 * Interface for Vault API responses
 */
export interface VaultResponse {
  success: boolean;
  data?: any;
  error?: string;
}

/**
 * Interface for Pera Wallet asset verification response
 */
export interface AssetVerificationResponse {
  asset_id: number;
  verification_tier: "verified" | "unverified" | "suspicious";
  explorer_url: string;
}

/**
 * Interface for Pera Wallet detailed asset information response
 * Based on PublicAssetDetailSerializer.Response schema
 */
export interface AssetDetailsResponse {
  // Required fields according to schema
  asset_id: number;
  fraction_decimals: number;
  total_supply: number;
  total_supply_as_str: string;
  creator_address: string;
  verification_tier: "verified" | "unverified" | "suspicious";
  is_collectible: boolean;
  circulating_supply: string;
  
  // Optional fields according to schema
  name?: string | null;
  unit_name?: string | null;
  is_deleted?: string | null;
  url?: string | null;
  logo?: string | null;
  usd_value?: string | null;
  usd_value_24_hour_ago?: string | null;
  verification_details?: Record<string, any> | null;
  collectible?: Record<string, any> | null;
  description?: string | null;
}

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
 * Response from the verifySignatureWithTransit function
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
