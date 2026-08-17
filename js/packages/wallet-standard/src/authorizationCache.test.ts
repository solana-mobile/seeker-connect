import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { StoredAuthorization } from '@skr-connect/core';
import { createLocalStorageAuthorizationCache, createMemoryAuthorizationCache } from './authorizationCache.js';

const STORED: StoredAuthorization = {
	accounts: [
		{
			address: 'Addr111',
			publicKey: Uint8Array.of(1, 2, 3),
			label: 'Account',
		},
	],
	authToken: 'TOKEN',
	walletUriBase: 'https://wallet.example.com',
	chain: 'solana:devnet',
	capabilities: {
		maxMessagesPerRequest: 5,
		maxTransactionsPerRequest: 5,
		supportedTransactionVersions: ['legacy', 0],
		features: ['solana:signTransactions'],
		supportsSignAndSendTransactions: true,
	},
};

describe('createMemoryAuthorizationCache', () => {
	it('round-trips and clears', async () => {
		const cache = createMemoryAuthorizationCache();
		expect(await cache.get()).toBeUndefined();
		await cache.set(STORED);
		expect(await cache.get()).toEqual(STORED);
		await cache.clear();
		expect(await cache.get()).toBeUndefined();
	});
});

describe('createLocalStorageAuthorizationCache', () => {
	let store: Map<string, string>;

	beforeEach(() => {
		store = new Map();
		Object.defineProperty(globalThis, 'window', {
			value: {
				localStorage: {
					getItem: (key: string) => store.get(key) ?? null,
					setItem: (key: string, value: string) => void store.set(key, value),
					removeItem: (key: string) => void store.delete(key),
				},
			},
			configurable: true,
			writable: true,
		});
	});

	afterEach(() => {
		delete (globalThis as Record<string, unknown>).window;
	});

	it('round-trips the authorization, preserving byte arrays', async () => {
		const cache = createLocalStorageAuthorizationCache();
		await cache.set(STORED);
		const restored = await cache.get();
		expect(restored).toEqual(STORED);
		expect(restored!.accounts[0]!.publicKey).toBeInstanceOf(Uint8Array);
	});

	it('clears the stored authorization', async () => {
		const cache = createLocalStorageAuthorizationCache();
		await cache.set(STORED);
		await cache.clear();
		expect(await cache.get()).toBeUndefined();
		expect(store.size).toBe(0);
	});

	it('ignores corrupt or foreign stored values', async () => {
		const cache = createLocalStorageAuthorizationCache();
		await cache.set(STORED);
		const [key] = [...store.keys()];
		store.set(key!, 'not json');
		expect(await cache.get()).toBeUndefined();
		store.set(key!, JSON.stringify({ version: 999 }));
		expect(await cache.get()).toBeUndefined();
	});

	it('is inert without localStorage', async () => {
		delete (globalThis as Record<string, unknown>).window;
		const cache = createLocalStorageAuthorizationCache();
		await cache.set(STORED);
		expect(await cache.get()).toBeUndefined();
		await cache.clear();
	});
});
