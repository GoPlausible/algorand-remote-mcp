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
   * API key for Algorand node access if required
   */
  ALGORAND_TOKEN?: string;
  
  /**
   * Items per page for pagination (default in state)
   */
  ITEMS_PER_PAGE?: string;
  

  OAUTH_KV?: KVNamespace;
  HCV_WORKER_URL?: string; // Hashicorp Vault Worker binding for secure secret storage
  // OAUTH_KV_ACCOUNTS?: KVNamespace;
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
