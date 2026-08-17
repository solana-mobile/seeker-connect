import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SeekerConnectConfig, SeekerConnectPresenter, StoredAuthorization } from '@skr-connect/core';
import { SeekerConnectError, SeekerConnectErrorCode } from '@skr-connect/core';
import {
	SolanaSignAndSendTransaction,
	SolanaSignIn,
	SolanaSignMessage,
	SolanaSignTransaction,
} from '@solana/wallet-standard-features';
import { StandardConnect, StandardDisconnect, StandardEvents } from '@wallet-standard/features';

import {
	FAKE_ACCOUNT,
	FAKE_CAPABILITIES,
	FakeSeekerLink,
	fakeSignedPayload,
	fakeTransactionSignature,
} from '../test/fakeSeekerLink.js';
import { createMemoryAuthorizationCache } from './authorizationCache.js';
import { SeekerConnectWallet } from './wallet.js';

const CONFIG: SeekerConnectConfig = {
	identity: { name: 'Test Dapp', uri: 'https://dapp.example.com' },
	relayDomain: 'relay.example.com',
	firstConnectWalletBaseUri: 'https://firstconnect.example.com',
};

const NOOP_PRESENTER: SeekerConnectPresenter = {
	interactionStarted: () => () => undefined,
	interactionFailed: () => undefined,
};

function setup(script = {}, config = CONFIG) {
	const link = new FakeSeekerLink(script);
	const cache = createMemoryAuthorizationCache();
	const wallet = new SeekerConnectWallet({
		config,
		link,
		authorizationCache: cache,
		presenter: NOOP_PRESENTER,
	});
	return { link, cache, wallet };
}

async function connected(script = {}) {
	const context = setup(script);
	await context.wallet.features[StandardConnect].connect();
	return context;
}

const STORED: StoredAuthorization = {
	accounts: [FAKE_ACCOUNT],
	authToken: 'STORED_TOKEN',
	walletUriBase: 'https://storedwallet.example.com',
	chain: 'solana:mainnet',
	capabilities: FAKE_CAPABILITIES,
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe('connect', () => {
	it('authorizes and learns capabilities in a single interaction', async () => {
		const { link, wallet } = await connected();

		expect(link.transactCalls).toHaveLength(1);
		expect(link.requests.map((r) => r.method).sort()).toEqual(['authorize', 'getCapabilities']);
		expect(wallet.accounts).toHaveLength(1);
		expect(wallet.accounts[0]).toMatchObject({
			address: FAKE_ACCOUNT.address,
			publicKey: FAKE_ACCOUNT.publicKey,
			label: FAKE_ACCOUNT.label,
		});
		expect(wallet.connected).toBe(true);
	});

	it('passes the config through to the link with no learned wallet URI', async () => {
		const { link } = await connected();

		expect(link.transactCalls[0]!.config).toEqual(CONFIG);
		expect(link.transactCalls[0]!.options?.walletUriBase).toBeUndefined();
	});

	it('caches the authorization for later restoration', async () => {
		const { cache } = await connected({
			authToken: 'CACHED_TOKEN',
			walletUriBase: 'https://wallet.example.com',
		});

		const stored = await cache.get();
		expect(stored).toMatchObject({
			authToken: 'CACHED_TOKEN',
			walletUriBase: 'https://wallet.example.com',
			chain: 'solana:mainnet',
			capabilities: FAKE_CAPABILITIES,
		});
	});

	it('restores a cached authorization without launching the wallet', async () => {
		const { link, cache, wallet } = setup();
		await cache.set(STORED);

		await wallet.features[StandardConnect].connect();

		expect(link.transactCalls).toHaveLength(0);
		expect(wallet.accounts[0]!.address).toBe(FAKE_ACCOUNT.address);
		expect(wallet.connected).toBe(true);
	});

	it('silent connect restores only from cache', async () => {
		const withCache = setup();
		await withCache.cache.set(STORED);
		const withoutCache = setup();

		const restored = await withCache.wallet.features[StandardConnect].connect({
			silent: true,
		});
		const empty = await withoutCache.wallet.features[StandardConnect].connect({
			silent: true,
		});

		expect(restored.accounts).toHaveLength(1);
		expect(withCache.link.transactCalls).toHaveLength(0);
		expect(empty.accounts).toHaveLength(0);
		expect(withoutCache.link.transactCalls).toHaveLength(0);
	});

	it('coalesces concurrent connects into one interaction', async () => {
		const { link, wallet } = setup();

		await Promise.all([wallet.features[StandardConnect].connect(), wallet.features[StandardConnect].connect()]);

		expect(link.transactCalls).toHaveLength(1);
	});

	it('emits a change event with the connected accounts', async () => {
		const { wallet } = setup();
		const listener = vi.fn();
		wallet.features[StandardEvents].on('change', listener);

		await wallet.features[StandardConnect].connect();

		expect(listener).toHaveBeenCalledWith(
			expect.objectContaining({
				accounts: expect.arrayContaining([expect.objectContaining({ address: FAKE_ACCOUNT.address })]),
			}),
		);
	});
});

describe('disconnect', () => {
	it('forgets the authorization without launching the wallet', async () => {
		const { link, cache, wallet } = await connected();
		const listener = vi.fn();
		wallet.features[StandardEvents].on('change', listener);

		await wallet.features[StandardDisconnect].disconnect();

		expect(wallet.accounts).toHaveLength(0);
		expect(wallet.connected).toBe(false);
		expect(await cache.get()).toBeUndefined();
		// No deauthorize round trip: that would launch the wallet app.
		expect(link.requests.some((r) => r.method === 'deauthorize')).toBe(false);
		expect(link.transactCalls).toHaveLength(1); // the connect only
		expect(listener).toHaveBeenCalledWith({ accounts: [] });
	});
});

describe('signMessage', () => {
	it('reauthorizes with the stored token, then signs, in one interaction', async () => {
		const { link, wallet } = await connected({
			authToken: 'SIGNING_TOKEN',
			walletUriBase: 'https://wallet.example.com',
		});
		const message = Uint8Array.of(1, 2, 3);

		const [output] = await wallet.features[SolanaSignMessage].signMessage({
			account: wallet.accounts[0]!,
			message,
		});

		expect(link.transactCalls).toHaveLength(2);
		// The learned wallet URI targets the same wallet on the follow-up.
		expect(link.transactCalls[1]!.options?.walletUriBase).toBe('https://wallet.example.com');
		expect(link.authorizeRequests[1]).toMatchObject({
			authToken: 'SIGNING_TOKEN',
		});
		const signedMessage = fakeSignedPayload(message);
		expect(output!.signedMessage).toEqual(signedMessage);
		expect(output!.signature).toEqual(signedMessage.slice(-64));
		expect(link.requests.find((r) => r.method === 'signMessages')!.params).toEqual({
			addresses: [FAKE_ACCOUNT.address],
			payloads: [message],
		});
	});

	it('persists a rotated auth token from reauthorization', async () => {
		const { link, cache, wallet } = await connected({
			authToken: 'TOKEN_1',
		});
		link.script.authToken = 'TOKEN_2';

		await wallet.features[SolanaSignMessage].signMessage({
			account: wallet.accounts[0]!,
			message: Uint8Array.of(1),
		});

		expect((await cache.get())?.authToken).toBe('TOKEN_2');
	});

	it('disconnects when the wallet no longer honors the token', async () => {
		const { link, cache, wallet } = await connected();
		link.script.authorizeError = new SeekerConnectError(
			SeekerConnectErrorCode.authorizationDeclined,
			'token expired',
		);

		await expect(
			wallet.features[SolanaSignMessage].signMessage({
				account: wallet.accounts[0]!,
				message: Uint8Array.of(1),
			}),
		).rejects.toThrow('token expired');

		expect(wallet.connected).toBe(false);
		expect(await cache.get()).toBeUndefined();
	});

	it('keeps the authorization when the interaction fails in transit', async () => {
		const { link, wallet } = await connected();
		link.script.transactError = new SeekerConnectError(
			SeekerConnectErrorCode.associationFailed,
			'relay unreachable',
		);

		await expect(
			wallet.features[SolanaSignMessage].signMessage({
				account: wallet.accounts[0]!,
				message: Uint8Array.of(1),
			}),
		).rejects.toThrow('relay unreachable');

		expect(wallet.connected).toBe(true);
	});

	it('requires a connection', async () => {
		const { wallet } = setup();

		await expect(
			wallet.features[SolanaSignMessage].signMessage({
				account: {
					address: 'x',
					publicKey: Uint8Array.of(1),
					chains: [],
					features: [],
				},
				message: Uint8Array.of(1),
			}),
		).rejects.toThrow('not connected');
	});
});

describe('transaction signing', () => {
	it('signTransaction resolves the wallet-signed bytes', async () => {
		const { wallet } = await connected();
		const transaction = Uint8Array.of(5, 5, 5);

		const [output] = await wallet.features[SolanaSignTransaction]!.signTransaction({
			account: wallet.accounts[0]!,
			transaction,
			chain: 'solana:mainnet',
		});

		expect(output!.signedTransaction).toEqual(fakeSignedPayload(transaction));
	});

	it('signAndSendTransaction resolves the submitted signature', async () => {
		const { link, wallet } = await connected();
		const transaction = Uint8Array.of(6, 6, 6);

		const [output] = await wallet.features[SolanaSignAndSendTransaction]!.signAndSendTransaction({
			account: wallet.accounts[0]!,
			transaction,
			chain: 'solana:mainnet',
			options: { minContextSlot: 42 },
		});

		expect(output!.signature).toEqual(fakeTransactionSignature(transaction));
		expect(link.requests.find((r) => r.method === 'signAndSendTransactions')!.params).toMatchObject({
			options: { minContextSlot: 42 },
		});
	});

	it('drops signTransaction when the wallet does not offer it', async () => {
		const { wallet } = await connected({
			capabilities: { ...FAKE_CAPABILITIES, features: [] },
		});

		expect(wallet.features[SolanaSignTransaction]).toBeUndefined();
		expect(wallet.features[SolanaSignAndSendTransaction]).toBeDefined();
	});

	it('drops signAndSendTransaction when the wallet reports only signTransactions', async () => {
		const { wallet } = await connected({
			capabilities: {
				...FAKE_CAPABILITIES,
				supportsSignAndSendTransactions: false,
			},
		});

		expect(wallet.features[SolanaSignAndSendTransaction]).toBeUndefined();
		expect(wallet.features[SolanaSignTransaction]).toBeDefined();
	});
});

describe('signIn', () => {
	it('signs in without a prior connection and adopts the authorization', async () => {
		const { link, wallet } = setup();

		const [output] = await wallet.features[SolanaSignIn].signIn({
			domain: 'dapp.example.com',
			statement: 'Sign in',
		});

		expect(link.authorizeRequests[0]!.signInPayload).toMatchObject({
			domain: 'dapp.example.com',
			statement: 'Sign in',
		});
		expect(output!.account.address).toBe(FAKE_ACCOUNT.address);
		expect(output!.signedMessage.length).toBeGreaterThan(0);
		expect(output!.signature.length).toBeGreaterThan(0);
		expect(wallet.connected).toBe(true);
	});

	it('reuses the stored token when already connected', async () => {
		const { link, wallet } = await connected({ authToken: 'SIWS_TOKEN' });

		await wallet.features[SolanaSignIn].signIn({
			domain: 'dapp.example.com',
		});

		expect(link.authorizeRequests[1]).toMatchObject({
			authToken: 'SIWS_TOKEN',
			signInPayload: { domain: 'dapp.example.com' },
		});
	});

	it('rejects when the wallet returns no sign-in result', async () => {
		const { wallet } = setup({ omitSignInResult: true });

		await expect(
			wallet.features[SolanaSignIn].signIn({
				domain: 'dapp.example.com',
			}),
		).rejects.toThrow('no sign-in result');
	});
});

describe('presenter', () => {
	function presenterSetup() {
		const settle = vi.fn();
		const presenter = {
			interactionStarted: vi.fn((cancel: () => void) => {
				void cancel;
				return settle;
			}),
			interactionFailed: vi.fn(),
		};
		const link = new FakeSeekerLink();
		const wallet = new SeekerConnectWallet({
			config: CONFIG,
			link,
			authorizationCache: createMemoryAuthorizationCache(),
			presenter,
		});
		return { link, wallet, presenter, settle };
	}

	it('wraps each wallet interaction', async () => {
		const { wallet, presenter, settle } = presenterSetup();

		await wallet.features[StandardConnect].connect();

		expect(presenter.interactionStarted).toHaveBeenCalledTimes(1);
		expect(settle).toHaveBeenCalledTimes(1);
		expect(presenter.interactionFailed).not.toHaveBeenCalled();
	});

	it('reports failed interactions', async () => {
		const { link, wallet, presenter, settle } = presenterSetup();
		const error = new SeekerConnectError(SeekerConnectErrorCode.associationFailed, 'nobody home');
		link.script.transactError = error;

		await expect(wallet.features[StandardConnect].connect()).rejects.toThrow('nobody home');

		expect(presenter.interactionFailed).toHaveBeenCalledWith(error);
		expect(settle).toHaveBeenCalledTimes(1);
	});

	it('closing the progress UI cancels the interaction without an error dialog', async () => {
		const { link, wallet, presenter, settle } = presenterSetup();
		link.script.hang = true;

		const connecting = wallet.features[StandardConnect].connect();
		// The presenter hands its cancel hook to the UI; simulate the user
		// closing the progress overlay once the interaction reaches it.
		await vi.waitFor(() => expect(presenter.interactionStarted).toHaveBeenCalled());
		const cancel = presenter.interactionStarted.mock.calls[0]![0];
		cancel();

		const error = await connecting.then(
			() => {
				throw new Error('connect resolved unexpectedly');
			},
			(e: unknown) => e,
		);
		expect(error).toBeInstanceOf(SeekerConnectError);
		expect((error as SeekerConnectError).code).toBe(SeekerConnectErrorCode.cancelled);
		expect(presenter.interactionFailed).not.toHaveBeenCalled();
		expect(settle).toHaveBeenCalledTimes(1);
		expect(wallet.connected).toBe(false);
	});

	it('shows nothing for a cache-restored connect', async () => {
		const { wallet, presenter } = presenterSetup();
		const cache = createMemoryAuthorizationCache();
		await cache.set(STORED);
		const restoredWallet = new SeekerConnectWallet({
			config: CONFIG,
			link: new FakeSeekerLink(),
			authorizationCache: cache,
			presenter,
		});

		await restoredWallet.features[StandardConnect].connect();
		void wallet;

		expect(presenter.interactionStarted).not.toHaveBeenCalled();
	});
});

describe('events', () => {
	it('supports unsubscription', async () => {
		const { wallet } = setup();
		const listener = vi.fn();
		const off = wallet.features[StandardEvents].on('change', listener);
		off();

		await wallet.features[StandardConnect].connect();

		expect(listener).not.toHaveBeenCalled();
	});

	it('isolates listener errors', async () => {
		const { wallet } = setup();
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const bad = vi.fn(() => {
			throw new Error('listener boom');
		});
		const good = vi.fn();
		wallet.features[StandardEvents].on('change', bad);
		wallet.features[StandardEvents].on('change', good);

		await wallet.features[StandardConnect].connect();

		expect(good).toHaveBeenCalled();
		expect(consoleError).toHaveBeenCalled();
	});
});

describe('chain selection', () => {
	it('chain defaults to mainnet in authorize requests', async () => {
		const { link } = await connected();
		expect(link.authorizeRequests[0]).toMatchObject({
			chain: 'solana:mainnet',
		});
	});
});
