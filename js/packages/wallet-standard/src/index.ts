/** Seeker Connect's Wallet Standard integration. */
import type { AuthorizationCache, SeekerConnectConfig, SeekerConnectPresenter, SeekerLink } from '@skr-connect/core';
import { createSeekerConnectPresenter } from '@skr-connect/ui';
import { createNostrSeekerLink } from '@skr-connect/web';
import { registerWallet } from '@wallet-standard/wallet';

import { createLocalStorageAuthorizationCache } from './authorizationCache.js';
import { SeekerConnectWallet } from './wallet.js';

export interface RegisterSeekerConnectOptions extends SeekerConnectConfig {
	/**
	 * Overrides the `SeekerLink` backing the wallet. Defaults to the web
	 * Nostr adapter.
	 */
	seekerLink?: SeekerLink;
	/** Defaults to a `localStorage`-backed cache. */
	authorizationCache?: AuthorizationCache;
	/** Defaults to the `@skr-connect/ui` progress/error UI. */
	presenter?: SeekerConnectPresenter;
}

/** Registers Seeker Connect with the app's Wallet Standard registry. */
export function registerSeekerConnect(options: RegisterSeekerConnectOptions): SeekerConnectWallet {
	const { seekerLink, authorizationCache, presenter, ...config } = options;
	const wallet = new SeekerConnectWallet({
		config,
		link: seekerLink ?? createNostrSeekerLink(),
		authorizationCache: authorizationCache ?? createLocalStorageAuthorizationCache(),
		presenter: presenter ?? createSeekerConnectPresenter(),
	});
	registerWallet(wallet);
	return wallet;
}

export { createLocalStorageAuthorizationCache, createMemoryAuthorizationCache } from './authorizationCache.js';
export {
	SeekerConnectWallet,
	SeekerConnectWalletName,
	type SeekerConnectWalletFeatures,
	type SeekerConnectWalletOptions,
} from './wallet.js';
export type {
	AuthorizationCache,
	DappIdentity,
	SeekerAccount,
	SeekerChain,
	SeekerConnectConfig,
	SeekerConnectPresenter,
	SeekerLink,
	StoredAuthorization,
} from '@skr-connect/core';
export { SeekerConnectError, SeekerConnectErrorCode } from '@skr-connect/core';
