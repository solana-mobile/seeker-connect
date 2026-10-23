/**
 * React Native SDK for Seeker Connect: a typed API over the `SeekerConnect`
 * native module, which runs the Android Seeker Connect SDK. Byte payloads
 * cross the bridge as base64.
 */
import { NativeModules, requireNativeComponent } from 'react-native';
import type { HostComponent, NativeSyntheticEvent, ViewProps } from 'react-native';

/** How the dapp identifies itself in the wallet's consent UI. */
export interface DappIdentity {
	name: string;
	/** Absolute URI of the dapp. */
	uri: string;
	/** Icon path, relative to `uri`. */
	icon?: string;
}

export interface SeekerConnectConfig {
	identity: DappIdentity;
	/** Chain requested at authorization; defaults to `solana:mainnet`. */
	chain?: string;
	/** Wallet base URI targeted before a wallet has been learned; defaults to `https://connect.solanamobile.com`. */
	firstConnectWalletBaseUri?: string;
	/** How long association may take before `association-failed`; defaults to 30 000 ms. */
	associationTimeoutMs?: number;
}

/** Which wallet a connection would reach on this device. */
export type WalletAvailability = 'certified' | 'other' | 'none';

export interface SeekerAccount {
	/** Base58 address. */
	address: string;
	publicKey: Uint8Array;
	label?: string;
}

export interface SeekerWalletCapabilities {
	maxMessagesPerRequest?: number;
	maxTransactionsPerRequest?: number;
	supportedTransactionVersions: (string | number)[];
	features: string[];
	supportsSignAndSendTransactions: boolean;
}

/** The held authorization; holding one is what makes the dapp "connected". */
export interface StoredAuthorization {
	accounts: SeekerAccount[];
	authToken: string;
	walletUriBase?: string;
	chain: string;
	capabilities: SeekerWalletCapabilities;
}

/** Sign-In-With-Solana input; `domain` defaults to the host of the dapp's identity URI. */
export interface SeekerSignInPayload {
	domain?: string;
	address?: string;
	statement?: string;
	uri?: string;
	version?: string;
	chainId?: string;
	nonce?: string;
	issuedAt?: string;
	expirationTime?: string;
	notBefore?: string;
	requestId?: string;
	resources?: string[];
}

export interface SeekerSignInResult {
	address: string;
	publicKey: Uint8Array;
	signedMessage: Uint8Array;
	signature: Uint8Array;
}

export interface SeekerSignAndSendOptions {
	minContextSlot?: number;
	commitment?: string;
	skipPreflight?: boolean;
	maxRetries?: number;
	waitForCommitmentToSendNextTransaction?: boolean;
}

/** One request of a multi-request {@link SeekerConnect.transact}. */
export type SeekerRequest =
	| { method: 'signMessages'; addresses: string[]; payloads: Uint8Array[] }
	| { method: 'signTransactions'; payloads: Uint8Array[] }
	| { method: 'signAndSendTransactions'; payloads: Uint8Array[]; options?: SeekerSignAndSendOptions };

export type SeekerConnectErrorCode =
	| 'no-wallet-found'
	| 'association-failed'
	| 'authorization-declined'
	| 'request-declined'
	| 'session-closed'
	| 'cancelled'
	| 'wallet-error'
	| 'not-configured'
	| 'no-activity'
	| 'invalid-argument';

const ERROR_CODES: Record<string, SeekerConnectErrorCode> = {
	NO_WALLET_FOUND: 'no-wallet-found',
	ASSOCIATION_FAILED: 'association-failed',
	AUTHORIZATION_DECLINED: 'authorization-declined',
	REQUEST_DECLINED: 'request-declined',
	SESSION_CLOSED: 'session-closed',
	CANCELLED: 'cancelled',
	WALLET_ERROR: 'wallet-error',
	NOT_CONFIGURED: 'not-configured',
	NO_ACTIVITY: 'no-activity',
	INVALID_ARGUMENT: 'invalid-argument',
};

/** The only error the SDK rejects with; `code` says what failed. */
export class SeekerConnectError extends Error {
	readonly code: SeekerConnectErrorCode;

	constructor(code: SeekerConnectErrorCode, message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = 'SeekerConnectError';
		this.code = code;
	}
}

interface NativeAuthorization extends Omit<StoredAuthorization, 'accounts' | 'walletUriBase'> {
	accounts: { address: string; publicKey: string; label?: string | null }[];
	walletUriBase?: string | null;
}

interface NativeSignInResult {
	address: string;
	publicKey: string;
	signedMessage: string;
	signature: string;
}

interface NativeSeekerConnect {
	configure(config: SeekerConnectConfig): { code: string; message: string | null } | null;
	walletAvailability(): Promise<'CERTIFIED' | 'OTHER' | 'NONE'>;
	restore(): Promise<NativeAuthorization | null>;
	connect(): Promise<NativeAuthorization>;
	signIn(payload: SeekerSignInPayload | null): Promise<NativeSignInResult>;
	signMessages(addresses: string[], payloads: string[]): Promise<string[]>;
	signTransactions(payloads: string[]): Promise<string[]>;
	signAndSendTransactions(payloads: string[], options: SeekerSignAndSendOptions | null): Promise<string[]>;
	transact(requests: unknown[]): Promise<string[][]>;
	disconnect(): Promise<null>;
}

function nativeModule(): NativeSeekerConnect {
	const module = (NativeModules as { SeekerConnect?: NativeSeekerConnect }).SeekerConnect;
	if (!module) {
		throw new SeekerConnectError(
			'not-configured',
			'The SeekerConnect native module is not linked; rebuild the Android app after installing the package.',
		);
	}
	return module;
}

async function bridge<T>(call: (module: NativeSeekerConnect) => Promise<T>): Promise<T> {
	try {
		return await call(nativeModule());
	} catch (e) {
		if (e instanceof SeekerConnectError) throw e;
		const code = (e as { code?: unknown }).code;
		throw new SeekerConnectError(
			(typeof code === 'string' && ERROR_CODES[code]) || 'wallet-error',
			e instanceof Error ? e.message : String(e),
			{ cause: e },
		);
	}
}

function toBase64(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function fromBase64(base64: string): Uint8Array {
	return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

function authorization(native: NativeAuthorization): StoredAuthorization {
	return {
		...native,
		accounts: native.accounts.map((account) => ({
			address: account.address,
			publicKey: fromBase64(account.publicKey),
			label: account.label ?? undefined,
		})),
		walletUriBase: native.walletUriBase ?? undefined,
	};
}

function nativeRequest(request: SeekerRequest): unknown {
	return { ...request, payloads: request.payloads.map(toBase64) };
}

/**
 * The Seeker Connect client. Call {@link SeekerConnect.configure} once
 * before anything else. Calls that launch the wallet use the app's current
 * activity.
 */
export const SeekerConnect = {
	configure: (config: SeekerConnectConfig): void => {
		const error = nativeModule().configure(config);
		if (error) throw new SeekerConnectError(ERROR_CODES[error.code] ?? 'wallet-error', error.message ?? error.code);
	},

	/** Which wallet a connection would reach, without launching anything. */
	walletAvailability: (): Promise<WalletAvailability> =>
		bridge(async (native) => (await native.walletAvailability()).toLowerCase() as WalletAvailability),

	/** The cached authorization, without launching the wallet; null when there is none. */
	restore: (): Promise<StoredAuthorization | null> =>
		bridge(async (native) => {
			const restored = await native.restore();
			return restored && authorization(restored);
		}),

	/** Restores the cached authorization, or authorizes in a fresh session. */
	connect: (): Promise<StoredAuthorization> => bridge(async (native) => authorization(await native.connect())),

	/** Sign-In-With-Solana, connecting in the same session when not yet connected. */
	signIn: (payload?: SeekerSignInPayload): Promise<SeekerSignInResult> =>
		bridge(async (native) => {
			const result = await native.signIn(payload ?? null);
			return {
				address: result.address,
				publicKey: fromBase64(result.publicKey),
				signedMessage: fromBase64(result.signedMessage),
				signature: fromBase64(result.signature),
			};
		}),

	/** Signs every payload with each base58 address; one signed message per payload. */
	signMessages: (addresses: string[], payloads: Uint8Array[]): Promise<Uint8Array[]> =>
		bridge(async (native) => (await native.signMessages(addresses, payloads.map(toBase64))).map(fromBase64)),

	/** The signed transaction bytes, one per payload. */
	signTransactions: (payloads: Uint8Array[]): Promise<Uint8Array[]> =>
		bridge(async (native) => (await native.signTransactions(payloads.map(toBase64))).map(fromBase64)),

	/** The signature of each submitted transaction. */
	signAndSendTransactions: (payloads: Uint8Array[], options?: SeekerSignAndSendOptions): Promise<Uint8Array[]> =>
		bridge(async (native) =>
			(await native.signAndSendTransactions(payloads.map(toBase64), options ?? null)).map(fromBase64),
		),

	/** Runs every request in one wallet launch; one result list per request, in order. */
	transact: (requests: SeekerRequest[]): Promise<Uint8Array[][]> =>
		bridge(async (native) =>
			(await native.transact(requests.map(nativeRequest))).map((results) => results.map(fromBase64)),
		),

	/** Forgets the authorization without launching the wallet. */
	disconnect: (): Promise<void> =>
		bridge(async (native) => {
			await native.disconnect();
		}),
};

export interface SeekerConnectButtonProps extends ViewProps {
	/** `connect` (default) shows "Connect with Seeker"; `sign-in` shows "Sign in with Seeker". */
	variant?: 'connect' | 'sign-in';
	enabled?: boolean;
	/** The screen's scheme; follows the system when unset. */
	theme?: 'light' | 'dark';
	onPress?: (event: NativeSyntheticEvent<Record<string, never>>) => void;
}

/**
 * The "… with Seeker" button, drawn natively. Give it a size in `style`: React Native can't measure the native view,
 * so without one it renders at zero size. The design's height is 56.
 */
export const SeekerConnectButton: HostComponent<SeekerConnectButtonProps> =
	requireNativeComponent<SeekerConnectButtonProps>('SeekerConnectButton');
