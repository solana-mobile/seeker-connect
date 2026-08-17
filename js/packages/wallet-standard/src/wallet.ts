/**
 * Wallet Standard wallet backed by a `SeekerLink`.
 *
 * "Connected" means "holds a wallet-issued authorization" — there is no
 * long-lived transport. Every wallet interaction (authorize, sign) runs in
 * its own short-lived MWA session via `SeekerLink.transact`, reauthorizing
 * with the cached auth token so the user is not re-prompted for consent.
 */
import type {
	AuthorizationCache,
	SeekerChain,
	SeekerConnectConfig,
	SeekerConnectPresenter,
	SeekerLink,
	SeekerSignInPayload,
	SeekerWallet,
	StoredAuthorization,
} from '@skr-connect/core';
import { DEFAULT_SEEKER_CHAIN, SeekerConnectError, SeekerConnectErrorCode } from '@skr-connect/core';
import {
	SolanaSignAndSendTransaction,
	type SolanaSignAndSendTransactionFeature,
	type SolanaSignAndSendTransactionMethod,
	type SolanaSignAndSendTransactionOptions,
	type SolanaSignAndSendTransactionOutput,
	SolanaSignIn,
	type SolanaSignInFeature,
	type SolanaSignInInput,
	type SolanaSignInMethod,
	type SolanaSignInOutput,
	SolanaSignMessage,
	type SolanaSignMessageFeature,
	type SolanaSignMessageMethod,
	SolanaSignTransaction,
	type SolanaSignTransactionFeature,
	type SolanaSignTransactionMethod,
} from '@solana/wallet-standard-features';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import {
	StandardConnect,
	type StandardConnectFeature,
	type StandardConnectMethod,
	StandardDisconnect,
	type StandardDisconnectFeature,
	type StandardDisconnectMethod,
	StandardEvents,
	type StandardEventsFeature,
	type StandardEventsListeners,
	type StandardEventsNames,
	type StandardEventsOnMethod,
} from '@wallet-standard/features';
import { ReadonlyWalletAccount } from '@wallet-standard/wallet';

import { icon } from './icon.js';

export const SeekerConnectWalletName = 'Seeker Connect';

// Ed25519 signatures; the signed payload carries the signature in its
// final bytes.
const SIGNATURE_LENGTH_IN_BYTES = 64;

const ACCOUNT_FEATURES = [
	SolanaSignAndSendTransaction,
	SolanaSignTransaction,
	SolanaSignMessage,
	SolanaSignIn,
] as const;

type OptionalFeatures = Partial<SolanaSignAndSendTransactionFeature & SolanaSignTransactionFeature>;

export type SeekerConnectWalletFeatures = StandardConnectFeature &
	StandardDisconnectFeature &
	StandardEventsFeature &
	SolanaSignMessageFeature &
	SolanaSignInFeature &
	OptionalFeatures;

export interface SeekerConnectWalletOptions {
	config: SeekerConnectConfig;
	link: SeekerLink;
	authorizationCache: AuthorizationCache;
	presenter: SeekerConnectPresenter;
}

export class SeekerConnectWallet implements Wallet {
	readonly #config: SeekerConnectConfig;
	readonly #link: SeekerLink;
	readonly #cache: AuthorizationCache;
	readonly #presenter: SeekerConnectPresenter;
	readonly #chain: SeekerChain;
	readonly #listeners: {
		[E in StandardEventsNames]?: StandardEventsListeners[E][];
	} = {};

	#authorization: StoredAuthorization | undefined;
	#accounts: readonly WalletAccount[] = [];
	#optionalFeatures: OptionalFeatures;
	#pendingAuthorization: Promise<StoredAuthorization> | undefined;
	/**
	 * Bumped on disconnect; interactions started before the bump must not
	 * surface late results or errors.
	 */
	#connectionGeneration = 0;

	constructor(options: SeekerConnectWalletOptions) {
		this.#config = options.config;
		this.#link = options.link;
		this.#cache = options.authorizationCache;
		this.#presenter = options.presenter;
		this.#chain = options.config.chain ?? DEFAULT_SEEKER_CHAIN;
		// Both signing routes are assumed until the wallet's capabilities are
		// known; they are re-derived on every adopted authorization.
		this.#optionalFeatures = {
			[SolanaSignAndSendTransaction]: {
				version: '1.0.0',
				supportedTransactionVersions: ['legacy', 0],
				signAndSendTransaction: this.#signAndSendTransaction,
			},
			[SolanaSignTransaction]: {
				version: '1.0.0',
				supportedTransactionVersions: ['legacy', 0],
				signTransaction: this.#signTransaction,
			},
		};
	}

	get version() {
		return '1.0.0' as const;
	}

	get name() {
		return SeekerConnectWalletName;
	}

	get icon() {
		return icon;
	}

	get chains() {
		return [this.#chain];
	}

	get accounts() {
		return this.#accounts.slice();
	}

	get connected(): boolean {
		return !!this.#authorization;
	}

	get features(): SeekerConnectWalletFeatures {
		return {
			[StandardConnect]: {
				version: '1.0.0',
				connect: this.#connect,
			},
			[StandardDisconnect]: {
				version: '1.0.0',
				disconnect: this.#disconnect,
			},
			[StandardEvents]: {
				version: '1.0.0',
				on: this.#on,
			},
			[SolanaSignMessage]: {
				version: '1.0.0',
				signMessage: this.#signMessage,
			},
			[SolanaSignIn]: {
				version: '1.0.0',
				signIn: this.#signIn,
			},
			...this.#optionalFeatures,
		};
	}

	#connect: StandardConnectMethod = async (input) => {
		if (!this.#authorization) {
			if (input?.silent) {
				const cached = await this.#cache.get();
				if (cached) {
					this.#adoptAuthorization(cached);
				}
				// No cached authorization: a silent connect must not launch the
				// wallet, so resolve with no accounts.
				return { accounts: this.accounts };
			}
			await this.#authorizeOrRestore();
		}
		return { accounts: this.accounts };
	};

	#disconnect: StandardDisconnectMethod = async () => {
		// Deliberately no wallet `deauthorize`: that would launch the wallet
		// app just to disconnect. The token is simply forgotten.
		this.#connectionGeneration++;
		this.#pendingAuthorization = undefined;
		await this.#forgetAuthorization();
	};

	/**
	 * Drops the held/cached authorization without bumping the connection
	 * generation, so an in-flight interaction can still surface its error.
	 */
	async #forgetAuthorization(): Promise<void> {
		await this.#cache.clear();
		if (this.#authorization) {
			this.#authorization = undefined;
			this.#accounts = [];
			this.#emit('change', { accounts: this.accounts });
		}
	}

	#on: StandardEventsOnMethod = (event, listener) => {
		const listeners = this.#listeners[event];
		if (listeners) {
			listeners.push(listener);
		} else {
			this.#listeners[event] = [listener];
		}
		return () => {
			this.#listeners[event] = this.#listeners[event]?.filter((existing) => existing !== listener);
		};
	};

	#signMessage: SolanaSignMessageMethod = async (...inputs) => {
		const authorization = this.#assertAuthorized();
		const signedMessages = await this.#transact(async (wallet) => {
			await this.#reauthorize(wallet, authorization);
			return wallet.signMessages({
				addresses: inputs.map((input) => input.account.address),
				payloads: inputs.map((input) => input.message),
			});
		});
		return signedMessages.map((signedMessage) => ({
			signedMessage,
			signature: signedMessage.slice(-SIGNATURE_LENGTH_IN_BYTES),
		}));
	};

	#signTransaction: SolanaSignTransactionMethod = async (...inputs) => {
		const authorization = this.#assertAuthorized();
		const signedTransactions = await this.#transact(async (wallet) => {
			await this.#reauthorize(wallet, authorization);
			return wallet.signTransactions({
				payloads: inputs.map((input) => input.transaction),
			});
		});
		return signedTransactions.map((signedTransaction) => ({
			signedTransaction,
		}));
	};

	#signAndSendTransaction: SolanaSignAndSendTransactionMethod = async (...inputs) => {
		const outputs: SolanaSignAndSendTransactionOutput[] = [];
		for (const input of inputs) {
			const authorization = this.#assertAuthorized();
			if (!authorization.capabilities.supportsSignAndSendTransactions) {
				throw new Error(`${SeekerConnectWalletName}: the wallet does not support signAndSendTransaction`);
			}
			const [signature] = await this.#transact(async (wallet) => {
				await this.#reauthorize(wallet, authorization);
				return wallet.signAndSendTransactions({
					payloads: [input.transaction],
					options: mapSignAndSendOptions(input.options),
				});
			});
			outputs.push({ signature: signature! });
		}
		return outputs;
	};

	#signIn: SolanaSignInMethod = async (...inputs) => {
		const outputs: SolanaSignInOutput[] = [];
		for (const input of inputs.length ? inputs : [undefined]) {
			outputs.push(await this.#performSignIn(input));
		}
		return outputs;
	};

	async #performSignIn(input: SolanaSignInInput | undefined): Promise<SolanaSignInOutput> {
		const payload: SeekerSignInPayload = {
			...input,
			domain: input?.domain ?? (typeof window === 'undefined' ? undefined : window.location.host),
		};
		const cached = this.#authorization ?? (await this.#cache.get());
		const { signInResult } = await this.#performAuthorize(payload, cached);
		if (!signInResult) {
			throw new Error(`${SeekerConnectWalletName}: the wallet returned no sign-in result`);
		}
		const account =
			this.#accounts.find((candidate) => candidate.address === signInResult.address) ??
			new ReadonlyWalletAccount({
				address: signInResult.address,
				publicKey: signInResult.publicKey,
				chains: this.chains,
				features: ACCOUNT_FEATURES,
			});
		return {
			account,
			signedMessage: signInResult.signedMessage,
			signature: signInResult.signature,
		};
	}

	/** Restores the cached authorization or requests a fresh one; coalesced. */
	async #authorizeOrRestore(): Promise<StoredAuthorization> {
		this.#pendingAuthorization ??= (async () => {
			const cached = await this.#cache.get();
			if (cached) {
				this.#adoptAuthorization(cached);
				return cached;
			}
			const { stored } = await this.#performAuthorize(undefined, undefined);
			return stored;
		})().finally(() => {
			this.#pendingAuthorization = undefined;
		});
		return this.#pendingAuthorization;
	}

	/**
	 * Runs a fresh `authorize` in its own session, learning capabilities in
	 * the same round trip when they are not already known.
	 */
	async #performAuthorize(signInPayload: SeekerSignInPayload | undefined, cached: StoredAuthorization | undefined) {
		const generation = this.#connectionGeneration;
		const result = await this.#transact(async (wallet) => {
			const [capabilities, authorization] = await Promise.all([
				cached?.capabilities ?? wallet.getCapabilities(),
				wallet.authorize({
					chain: this.#chain,
					authToken: cached?.authToken,
					signInPayload,
				}),
			]);
			return { capabilities, authorization };
		}, cached?.walletUriBase);
		const stored: StoredAuthorization = {
			accounts: result.authorization.accounts,
			authToken: result.authorization.authToken,
			walletUriBase: result.authorization.walletUriBase ?? cached?.walletUriBase,
			chain: this.#chain,
			capabilities: result.capabilities,
		};
		if (generation === this.#connectionGeneration) {
			await this.#cache.set(stored);
			this.#adoptAuthorization(stored);
		}
		return { stored, signInResult: result.authorization.signInResult };
	}

	/**
	 * Replays the auth token inside a live session so the wallet re-grants
	 * without fresh consent, and adopts the (possibly rotated) result.
	 */
	async #reauthorize(wallet: SeekerWallet, authorization: StoredAuthorization): Promise<void> {
		const generation = this.#connectionGeneration;
		try {
			const result = await wallet.authorize({
				chain: authorization.chain,
				authToken: authorization.authToken,
			});
			const stored: StoredAuthorization = {
				accounts: result.accounts,
				authToken: result.authToken,
				walletUriBase: result.walletUriBase ?? authorization.walletUriBase,
				chain: authorization.chain,
				capabilities: authorization.capabilities,
			};
			if (generation === this.#connectionGeneration) {
				await this.#cache.set(stored);
				this.#adoptAuthorization(stored);
			}
		} catch (e) {
			// The token is no longer honored; the stored authorization is dead.
			// Transport failures don't invalidate the token and must not wipe it.
			if (e instanceof SeekerConnectError && e.code === SeekerConnectErrorCode.authorizationDeclined) {
				await this.#forgetAuthorization();
			}
			throw e;
		}
	}

	/** One wallet interaction: presenter-wrapped, generation-guarded. */
	async #transact<T>(callback: (wallet: SeekerWallet) => Promise<T>, walletUriBase?: string): Promise<T> {
		const generation = this.#connectionGeneration;
		// Closing the presenter's progress UI aborts the session.
		const abort = new AbortController();
		const settle = this.#presenter.interactionStarted(() => abort.abort());
		try {
			return await this.#link.transact(this.#config, callback, {
				walletUriBase: walletUriBase ?? this.#authorization?.walletUriBase,
				signal: abort.signal,
			});
		} catch (e) {
			if (this.#connectionGeneration !== generation) {
				// The user disconnected while this interaction was in flight; its
				// failure must not surface.
				return new Promise<never>(() => {});
			}
			if (abort.signal.aborted) {
				// User-initiated; not an error the presenter should announce.
				throw new SeekerConnectError(SeekerConnectErrorCode.cancelled, 'The wallet interaction was cancelled', {
					cause: e,
				});
			}
			if (e instanceof SeekerConnectError) {
				this.#presenter.interactionFailed(e);
			}
			throw e;
		} finally {
			settle();
		}
	}

	#assertAuthorized(): StoredAuthorization {
		if (!this.#authorization) {
			throw new Error(`${SeekerConnectWalletName}: wallet not connected`);
		}
		return this.#authorization;
	}

	#adoptAuthorization(stored: StoredAuthorization): void {
		const previousAccounts = this.#accounts;
		const previousFeatureNames = Object.keys(this.#optionalFeatures);
		this.#authorization = stored;
		this.#accounts = stored.accounts.map(
			(account) =>
				new ReadonlyWalletAccount({
					address: account.address,
					publicKey: account.publicKey,
					chains: this.chains,
					features: ACCOUNT_FEATURES,
					label: account.label,
				}),
		);
		this.#optionalFeatures = deriveOptionalFeatures(stored.capabilities, {
			signAndSendTransaction: this.#signAndSendTransaction,
			signTransaction: this.#signTransaction,
		});

		const accountsChanged =
			previousAccounts.length !== this.#accounts.length ||
			this.#accounts.some((account, i) => account.address !== previousAccounts[i]?.address);
		if (accountsChanged) {
			this.#emit('change', { accounts: this.accounts });
		}
		const featureNames = Object.keys(this.#optionalFeatures);
		const featuresChanged =
			featureNames.length !== previousFeatureNames.length ||
			featureNames.some((name) => !previousFeatureNames.includes(name));
		if (featuresChanged) {
			this.#emit('change', { features: this.features });
		}
	}

	#emit<E extends StandardEventsNames>(event: E, ...args: Parameters<StandardEventsListeners[E]>): void {
		for (const listener of this.#listeners[event] ?? []) {
			// One listener's error must not affect the others.
			try {
				(listener as (...listenerArgs: unknown[]) => void)(...args);
			} catch (error) {
				console.error(error);
			}
		}
	}
}

function deriveOptionalFeatures(
	capabilities: StoredAuthorization['capabilities'],
	methods: {
		signAndSendTransaction: SolanaSignAndSendTransactionMethod;
		signTransaction: SolanaSignTransactionMethod;
	},
): OptionalFeatures {
	const supportsSignTransactions = capabilities.features.includes('solana:signTransactions');
	const supportsSignAndSend = capabilities.supportsSignAndSendTransactions;
	return {
		// A wallet reporting neither route still gets signAndSendTransaction:
		// MWA 2.0 makes it mandatory, so absence means a non-reporting wallet,
		// not a non-signing one.
		...((supportsSignAndSend || !supportsSignTransactions) && {
			[SolanaSignAndSendTransaction]: {
				version: '1.0.0' as const,
				supportedTransactionVersions: ['legacy', 0] as const,
				signAndSendTransaction: methods.signAndSendTransaction,
			},
		}),
		...(supportsSignTransactions && {
			[SolanaSignTransaction]: {
				version: '1.0.0' as const,
				supportedTransactionVersions: ['legacy', 0] as const,
				signTransaction: methods.signTransaction,
			},
		}),
	};
}

function mapSignAndSendOptions(options: SolanaSignAndSendTransactionOptions | undefined):
	| {
			minContextSlot?: number;
			commitment?: string;
			skipPreflight?: boolean;
			maxRetries?: number;
	  }
	| undefined {
	if (!options) return undefined;
	return {
		minContextSlot: options.minContextSlot,
		commitment: options.commitment,
		skipPreflight: options.skipPreflight,
		maxRetries: options.maxRetries,
	};
}
