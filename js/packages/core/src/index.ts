/**
 * Platform-agnostic contracts shared by every Seeker Connect target.
 *
 * This package owns the `SeekerLink` port, the boundary that isolates the
 * MWA implementation. Platform packages implement it in their
 * `src/mwa-adapter/` module, the only module permitted to import
 * `@solana-mobile/*` (lint-enforced).
 *
 * MWA sessions are per-interaction: the wallet endpoint serves one
 * association at a time and terminates its session when the interaction
 * completes. The port therefore exposes a `transact` shape — establish a
 * session, run one callback against it, always tear it down — rather than
 * any long-lived connection handle. Continuity across interactions comes
 * from the wallet-issued auth token (see {@link AuthorizationCache}), not
 * from keeping a transport open.
 */

/** A Solana chain identifier, e.g. `solana:mainnet`. */
export type SeekerChain = `solana:${string}`;

/** The chain requested at authorization when {@link SeekerConnectConfig.chain} is unset. */
export const DEFAULT_SEEKER_CHAIN: SeekerChain = 'solana:mainnet';

/**
 * How the dapp identifies itself to the wallet during authorization
 * (the MWA `authorize` request's identity, shown in the wallet's consent UI).
 */
export interface DappIdentity {
	/** Human-readable dapp name. */
	name: string;
	/** The dapp's web origin; wallets use it to verify and display the requester. */
	uri: string;
	/** Icon path, relative to {@link DappIdentity.uri}. */
	icon?: string;
}

/** Configuration accepted by every Seeker Connect entry point. */
export interface SeekerConnectConfig {
	/** How the dapp presents itself in the wallet's consent UI. */
	identity: DappIdentity;
	/** Domain of the Nostr relay that carries the MWA session traffic. */
	relayDomain: string;
	/** Chain requested at authorization. Defaults to {@link DEFAULT_SEEKER_CHAIN}. */
	chain?: SeekerChain;
	/**
	 * Wallet base URI to target on the first connection, before any wallet
	 * has been learned from an `authorize` response. When unset, first
	 * connections use the generic `solana-wallet:` scheme.
	 */
	firstConnectWalletBaseUri?: string;
	/**
	 * How long a session may spend associating (wallet launched but not yet
	 * connected) before `transact` rejects with `association-failed`.
	 * Defaults to 30 seconds. The timer covers association only, never the
	 * interaction itself.
	 */
	associationTimeoutMs?: number;
}

/** An account the wallet authorized for this dapp. */
export interface SeekerAccount {
	/**
	 * Base58-encoded account address. Adapters convert from MWA's base64
	 * wire encoding.
	 */
	address: string;
	/** The raw public key bytes underlying {@link SeekerAccount.address}. */
	publicKey: Uint8Array;
	/** Display label the wallet assigned to the account, when it provides one. */
	label?: string;
}

/**
 * Sign-in-with-Solana payload forwarded to the wallet inside `authorize`
 * (MWA `sign_in_payload`). Field semantics follow the SIWS input spec.
 */
export interface SeekerSignInPayload {
	/** Domain requesting the sign-in, typically the dapp's hostname. */
	domain?: string;
	/** Base58 address expected to sign in; the wallet picks an account when unset. */
	address?: string;
	/** Human-readable statement shown to the user before signing. */
	statement?: string;
	/** URI of the resource that is the subject of the sign-in, typically the dapp's origin. */
	uri?: string;
	/** SIWS message version; `1` is the only version currently defined. */
	version?: string;
	/** Chain the sign-in applies to, e.g. `mainnet`. */
	chainId?: string;
	/** Random value that prevents replay; at least 8 alphanumeric characters. */
	nonce?: string;
	/** ISO 8601 timestamp of when the message was issued. */
	issuedAt?: string;
	/** ISO 8601 timestamp after which the signed message is no longer valid. */
	expirationTime?: string;
	/** ISO 8601 timestamp before which the signed message is not yet valid. */
	notBefore?: string;
	/** Dapp-specific identifier for the sign-in request. */
	requestId?: string;
	/** URIs the user is asked to grant access to, one per entry. */
	resources?: readonly string[];
}

/** The wallet's proof for a sign-in request, decoded from the wire. */
export interface SeekerSignInResult {
	/** Base58 address of the account that signed in. */
	address: string;
	/** Raw public key bytes underlying {@link SeekerSignInResult.address}. */
	publicKey: Uint8Array;
	/** The full signed sign-in message bytes. */
	signedMessage: Uint8Array;
	/** Signature over {@link SeekerSignInResult.signedMessage}. */
	signature: Uint8Array;
}

/** Result of a successful `authorize` (or token-based reauthorization). */
export interface SeekerAuthorization {
	/** Accounts the wallet authorized; later requests may address any of them. */
	readonly accounts: readonly SeekerAccount[];
	/**
	 * Opaque token from the wallet's `authorize` response; pass it to a later
	 * {@link SeekerWallet.authorize} to reauthorize without fresh user consent.
	 */
	readonly authToken: string;
	/**
	 * Endpoint-specific base URI from the wallet's `authorize` response (MWA
	 * spec §"Endpoint-specific URIs"); reuse it to target the same wallet
	 * directly on later connections.
	 */
	readonly walletUriBase?: string;
	/** Present when the `authorize` carried a sign-in payload. */
	readonly signInResult?: SeekerSignInResult;
}

/** The wallet's `get_capabilities` response, decoded from the wire. */
export interface SeekerWalletCapabilities {
	/** Upper bound on payloads per {@link SeekerWallet.signMessages} call, when the wallet enforces one. */
	maxMessagesPerRequest?: number;
	/** Upper bound on payloads per transaction-signing call, when the wallet enforces one. */
	maxTransactionsPerRequest?: number;
	/** Transaction versions the wallet can sign, e.g. `legacy` and `0`. */
	supportedTransactionVersions: readonly (string | number)[];
	/** Optional-feature identifiers, e.g. `solana:signTransactions`. */
	features: readonly string[];
	/** Whether the wallet implements `sign_and_send_transactions`. */
	supportsSignAndSendTransactions: boolean;
}

/** Parameters of the MWA `authorize` request sent by {@link SeekerWallet.authorize}. */
export interface SeekerAuthorizeRequest {
	/** Defaults to the config's chain. */
	chain?: SeekerChain;
	/** Reauthorizes an earlier grant instead of requesting a fresh one. */
	authToken?: string;
	/** Adds Sign-In-With-Solana to the authorization; the proof arrives as {@link SeekerAuthorization.signInResult}. */
	signInPayload?: SeekerSignInPayload;
}

/** Options for `sign_and_send_transactions`, decoded field-for-field. */
export interface SeekerSignAndSendOptions {
	/** Minimum slot the wallet's RPC must have reached before it simulates and sends. */
	minContextSlot?: number;
	/** Commitment level the wallet waits for when confirming the send, e.g. `confirmed`. */
	commitment?: string;
	/** Skips the wallet's preflight simulation. */
	skipPreflight?: boolean;
	/** How many times the wallet's RPC retries sending before giving up. */
	maxRetries?: number;
	/** Sends payloads one at a time, waiting for `commitment` on each before sending the next. */
	waitForCommitmentToSendNextTransaction?: boolean;
}

/**
 * The wallet endpoint of one live session, valid only inside the
 * {@link SeekerLink.transact} callback that received it.
 */
export interface SeekerWallet {
	/**
	 * Requests authorization for the dapp, or reauthorizes silently with a
	 * prior `authToken`. The wallet shows its consent UI only when needed.
	 */
	authorize(request?: SeekerAuthorizeRequest): Promise<SeekerAuthorization>;
	/** Revokes an auth token so it can no longer reauthorize. */
	deauthorize(request: {
		/** The token to revoke. */
		authToken: string;
	}): Promise<void>;
	/** Queries what the wallet supports; see {@link SeekerWalletCapabilities}. */
	getCapabilities(): Promise<SeekerWalletCapabilities>;
	/** Signs every payload with each listed account. Resolves one signed message per payload. */
	signMessages(request: {
		/** Base58 addresses of the accounts that must sign. */
		addresses: readonly string[];
		/** Raw message bytes to sign. */
		payloads: readonly Uint8Array[];
	}): Promise<Uint8Array[]>;
	/** Signs each serialized transaction. Resolves the signed transaction bytes, one per payload. */
	signTransactions(request: {
		/** Serialized transactions to sign. */
		payloads: readonly Uint8Array[];
	}): Promise<Uint8Array[]>;
	/** Resolves the raw signature bytes of each submitted transaction. */
	signAndSendTransactions(request: {
		/** Serialized transactions to sign and submit. */
		payloads: readonly Uint8Array[];
		/** Send options forwarded to the wallet. */
		options?: SeekerSignAndSendOptions;
	}): Promise<Uint8Array[]>;
}

/** Per-call options for {@link SeekerLink.transact}. */
export interface SeekerTransactOptions {
	/**
	 * Endpoint-specific base URI of the wallet to target, learned from a
	 * prior authorization. Overrides the config's first-connect URI.
	 */
	walletUriBase?: string;
	/**
	 * Aborting closes the session immediately; the `transact` promise then
	 * rejects. An already-aborted signal prevents the session entirely.
	 */
	signal?: AbortSignal;
}

/** The port each platform implements to provide wallet connectivity. */
export interface SeekerLink {
	/**
	 * Establishes one wallet session, runs `callback` against it, and tears
	 * the session down when the callback settles. The `SeekerWallet` must not
	 * be used after that.
	 */
	transact<T>(
		config: SeekerConnectConfig,
		callback: (wallet: SeekerWallet) => Promise<T>,
		options?: SeekerTransactOptions,
	): Promise<T>;
}

/**
 * What a dapp persists between interactions. Restoring this is what makes
 * a dapp "connected" without any live session or wallet launch.
 */
export interface StoredAuthorization {
	/** Accounts granted by the authorization. */
	accounts: readonly SeekerAccount[];
	/** Token that reauthorizes silently on the next interaction. */
	authToken: string;
	/** Endpoint-specific URI of the wallet that issued the grant, when it advertised one. */
	walletUriBase?: string;
	/** Chain the authorization was granted for. */
	chain: SeekerChain;
	/** The wallet's capabilities as reported when the authorization was established. */
	capabilities: SeekerWalletCapabilities;
}

/** Persistence for the wallet-issued authorization, injectable per platform. */
export interface AuthorizationCache {
	/** Resolves the stored authorization, or `undefined` when none is stored. */
	get(): Promise<StoredAuthorization | undefined>;
	/** Replaces the stored authorization. */
	set(authorization: StoredAuthorization): Promise<void>;
	/** Forgets the stored authorization. */
	clear(): Promise<void>;
}

/**
 * Surface for Seeker-Connect-owned UI shown around wallet interactions.
 * Implementations must tolerate any call ordering and never throw.
 */
export interface SeekerConnectPresenter {
	/**
	 * A wallet interaction (session establishment + requests) has started.
	 * `cancel` aborts the interaction (e.g. the user closed the progress UI);
	 * it is safe to call at any time, including after settlement. Returns a
	 * closer invoked when the interaction settles, success or not.
	 */
	interactionStarted(cancel: () => void): () => void;
	/** A wallet interaction failed in a way the user should be told about. */
	interactionFailed(error: SeekerConnectError): void;
}

/** Every code a {@link SeekerConnectError} may carry. */
export const SeekerConnectErrorCode = {
	/** No wallet completed the association (timeout, cancelled, relay unreachable). */
	associationFailed: 'association-failed',
	/** The user declined authorization (MWA `ERROR_AUTHORIZATION_FAILED`). */
	authorizationDeclined: 'authorization-declined',
	/** The wallet declined to sign or submit (MWA `ERROR_NOT_SIGNED`/`ERROR_NOT_SUBMITTED`). */
	requestDeclined: 'request-declined',
	/** The session ended before the interaction completed. */
	sessionClosed: 'session-closed',
	/** The user cancelled the interaction from Seeker Connect UI. */
	cancelled: 'cancelled',
	/** Any other wallet-reported error. */
	walletError: 'wallet-error',
} as const;

/** The union of {@link SeekerConnectErrorCode} values. */
export type SeekerConnectErrorCode = (typeof SeekerConnectErrorCode)[keyof typeof SeekerConnectErrorCode];

/** The only error type `SeekerLink` implementations may reject with. */
export class SeekerConnectError extends Error {
	/** Machine-readable classification of the failure. */
	readonly code: SeekerConnectErrorCode;

	constructor(code: SeekerConnectErrorCode, message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = 'SeekerConnectError';
		this.code = code;
	}
}
