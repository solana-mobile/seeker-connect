/** Default `AuthorizationCache` backed by `window.localStorage`. */
import type { AuthorizationCache, SeekerAccount, StoredAuthorization } from '@solana-mobile/seeker-connect-core';

const STORAGE_KEY = 'SeekerConnectAuthorizationCache';
const STORAGE_VERSION = 1;

interface SerializedAccount {
	address: string;
	publicKey: number[];
	label?: string;
}

interface SerializedAuthorization {
	version: number;
	accounts: SerializedAccount[];
	authToken: string;
	walletUriBase?: string;
	chain: StoredAuthorization['chain'];
	capabilities: StoredAuthorization['capabilities'];
}

function storage(): Storage | undefined {
	try {
		return typeof window === 'undefined' ? undefined : window.localStorage;
	} catch {
		// Accessing localStorage throws in some privacy modes.
		return undefined;
	}
}

/**
 * Persists the authorization in `localStorage`. Where `localStorage` is
 * unavailable the cache is inert: nothing persists, `get` resolves
 * undefined, and every connection requires fresh consent.
 */
export function createLocalStorageAuthorizationCache(): AuthorizationCache {
	return {
		async get(): Promise<StoredAuthorization | undefined> {
			const raw = storage()?.getItem(STORAGE_KEY);
			if (!raw) return undefined;
			try {
				const parsed = JSON.parse(raw) as SerializedAuthorization;
				if (parsed.version !== STORAGE_VERSION) return undefined;
				return {
					accounts: parsed.accounts.map((account): SeekerAccount => ({
						address: account.address,
						publicKey: Uint8Array.from(account.publicKey),
						label: account.label,
					})),
					authToken: parsed.authToken,
					walletUriBase: parsed.walletUriBase,
					chain: parsed.chain,
					capabilities: parsed.capabilities,
				};
			} catch {
				return undefined;
			}
		},
		async set(authorization: StoredAuthorization): Promise<void> {
			const serialized: SerializedAuthorization = {
				version: STORAGE_VERSION,
				accounts: authorization.accounts.map((account) => ({
					address: account.address,
					publicKey: Array.from(account.publicKey),
					label: account.label,
				})),
				authToken: authorization.authToken,
				walletUriBase: authorization.walletUriBase,
				chain: authorization.chain,
				capabilities: authorization.capabilities,
			};
			storage()?.setItem(STORAGE_KEY, JSON.stringify(serialized));
		},
		async clear(): Promise<void> {
			storage()?.removeItem(STORAGE_KEY);
		},
	};
}

/** In-memory `AuthorizationCache`, for tests and non-browser hosts. */
export function createMemoryAuthorizationCache(): AuthorizationCache {
	let stored: StoredAuthorization | undefined;
	return {
		async get() {
			return stored;
		},
		async set(authorization) {
			stored = authorization;
		},
		async clear() {
			stored = undefined;
		},
	};
}
