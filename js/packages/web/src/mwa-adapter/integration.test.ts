/**
 * End-to-end tests for `createNostrSeekerLink()` against the fake wallet
 * in `test/fakeNostrWallet.ts`; the protocol library is not mocked.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SeekerConnectConfig } from '@skr-connect/core';
import { SeekerConnectError, SeekerConnectErrorCode } from '@skr-connect/core';
import {
	base58FromUint8Array,
	base64FromUint8Array,
	base64ToUint8Array,
} from '@solana-mobile/mobile-wallet-adapter-protocol/encoding';

import {
	FakeNostrWallet,
	fakeSignature,
	fakeSignedPayload,
	type FakeWalletScript,
} from '../../test/fakeNostrWallet.js';
import { createNostrSeekerLink } from './index.js';

const CONFIG: SeekerConnectConfig = {
	identity: {
		name: 'Fake Dapp',
		uri: 'https://fakedapp.example.com',
		icon: 'favicon.ico',
	},
	relayDomain: 'fakerelay.example.com',
};

let wallet: FakeNostrWallet;

function installWallet(script: FakeWalletScript = {}): FakeNostrWallet {
	wallet.uninstall();
	wallet = new FakeNostrWallet(script);
	wallet.install();
	return wallet;
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
	return promise.then(
		() => {
			throw new Error('promise resolved unexpectedly');
		},
		(e: unknown) => e,
	);
}

beforeEach(() => {
	wallet = new FakeNostrWallet();
	wallet.install();
});

afterEach(() => {
	wallet.uninstall();
	expect(wallet.errors).toEqual([]);
});

describe('createNostrSeekerLink over the real protocol', () => {
	it('connects: association URL, Nostr handshake, session crypto, authorize', async () => {
		const publicKey = Uint8Array.of(9, 8, 7, 6, 5);
		installWallet({
			accounts: [{ publicKey, label: 'Main' }],
			authToken: 'INTEGRATION_TOKEN',
			walletUriBase: 'https://fakewallet.example.com',
		});

		const authorization = await createNostrSeekerLink().transact(CONFIG, (session) => session.authorize());

		const [launched] = wallet.launchedUrls;
		expect(launched!.protocol).toBe('solana-wallet:');
		expect(launched!.pathname).toContain('v1/associate/local/nostr');
		expect(launched!.searchParams.get('relay')).toBe('fakerelay.example.com');

		expect(wallet.requests.map((r) => r.method)).toEqual(['authorize']);
		expect(wallet.requests[0]!.params.identity).toEqual(CONFIG.identity);
		expect(authorization.accounts).toEqual([
			{
				address: base58FromUint8Array(publicKey),
				publicKey,
				label: 'Main',
			},
		]);
		expect(authorization.authToken).toBe('INTEGRATION_TOKEN');
		expect(authorization.walletUriBase).toBe('https://fakewallet.example.com');
	});

	it('ends the Nostr session once the interaction completes', async () => {
		await createNostrSeekerLink().transact(CONFIG, (session) => session.authorize());

		expect(wallet.sessionEndReceived).toBe(true);
		expect(wallet.openSessions).toBe(0);
	});

	it('establishes an independent session per transact', async () => {
		const link = createNostrSeekerLink();
		await link.transact(CONFIG, (session) => session.authorize());
		await link.transact(CONFIG, (session) => session.authorize({ authToken: 'FAKE_AUTH_TOKEN' }));

		expect(wallet.sessionsEstablished).toBe(2);
		expect(wallet.openSessions).toBe(0);
		expect(wallet.launchedUrls).toHaveLength(2);
	});

	it('reauthorizes with a stored auth token', async () => {
		installWallet({ authToken: 'STORED_TOKEN' });

		const authorization = await createNostrSeekerLink().transact(CONFIG, (session) =>
			session.authorize({ authToken: 'STORED_TOKEN' }),
		);

		expect(wallet.authorizeRequests).toEqual([
			{
				authToken: 'STORED_TOKEN',
				chain: 'solana:mainnet',
				hasSignInPayload: false,
			},
		]);
		expect(authorization.authToken).toBe('STORED_TOKEN');
	});

	it('rejects a stale auth token as authorization-declined', async () => {
		installWallet({ authToken: 'CURRENT_TOKEN' });

		const error = await rejectionOf(
			createNostrSeekerLink().transact(CONFIG, (session) => session.authorize({ authToken: 'STALE_TOKEN' })),
		);

		expect(error).toBeInstanceOf(SeekerConnectError);
		expect((error as SeekerConnectError).code).toBe(SeekerConnectErrorCode.authorizationDeclined);
	});

	it("resolves the wallet's sign-in proof", async () => {
		const publicKey = Uint8Array.of(4, 4, 4, 4);
		installWallet({ accounts: [{ publicKey, label: 'SIWS' }] });
		const signInPayload = {
			domain: 'fakedapp.example.com',
			statement: 'Sign in to Fake Dapp',
		};

		const authorization = await createNostrSeekerLink().transact(CONFIG, (session) =>
			session.authorize({ signInPayload }),
		);

		const signedMessage = new TextEncoder().encode(JSON.stringify(signInPayload));
		expect(authorization.signInResult).toEqual({
			address: base58FromUint8Array(publicKey),
			publicKey,
			signedMessage,
			signature: fakeSignature(signedMessage),
		});
	});

	it('round-trips message signing over the wire encoding', async () => {
		const publicKey = Uint8Array.of(7, 7, 7);
		installWallet({ accounts: [{ publicKey }] });
		const message = new TextEncoder().encode('hello seeker');

		const signed = await createNostrSeekerLink().transact(CONFIG, (session) =>
			session.signMessages({
				addresses: [base58FromUint8Array(publicKey)],
				payloads: [message],
			}),
		);

		expect(signed).toEqual([fakeSignedPayload(message)]);
		const signRequest = wallet.requests.find((r) => r.method === 'sign_messages');
		expect(signRequest!.params.addresses).toEqual([base64FromUint8Array(publicKey)]);
		expect(signRequest!.params.payloads).toEqual([base64FromUint8Array(message)]);
	});

	it('round-trips transaction signing and sending', async () => {
		const transaction = Uint8Array.of(1, 1, 2, 3, 5, 8);

		const [signed, signatures] = await createNostrSeekerLink().transact(CONFIG, async (session) => [
			await session.signTransactions({ payloads: [transaction] }),
			await session.signAndSendTransactions({
				payloads: [transaction],
				options: { minContextSlot: 42 },
			}),
		]);

		expect(signed).toEqual([fakeSignedPayload(transaction)]);
		expect(signatures).toEqual([fakeSignature(transaction)]);
		const sendRequest = wallet.requests.find((r) => r.method === 'sign_and_send_transactions');
		expect(sendRequest!.params.options).toMatchObject({
			min_context_slot: 42,
		});
	});

	it("decodes the wallet's capabilities", async () => {
		// On a protocol v1 session sign-and-send is mandatory: the protocol
		// library normalizes the deprecated flag to true regardless of what the
		// wallet reports.
		installWallet({
			capabilities: {
				supports_sign_and_send_transactions: false,
				max_messages_per_request: 3,
			},
		});

		const capabilities = await createNostrSeekerLink().transact(CONFIG, (session) => session.getCapabilities());

		expect(capabilities.supportsSignAndSendTransactions).toBe(true);
		expect(capabilities.maxMessagesPerRequest).toBe(3);
		expect(capabilities.features).toContain('solana:signTransactions');
	});

	it('surfaces a wallet-declined authorization as authorization-declined', async () => {
		installWallet({
			authorizeError: { code: -1, message: 'authorization declined' },
		});

		const error = await rejectionOf(createNostrSeekerLink().transact(CONFIG, (session) => session.authorize()));

		expect(error).toBeInstanceOf(SeekerConnectError);
		expect((error as SeekerConnectError).code).toBe(SeekerConnectErrorCode.authorizationDeclined);
		expect(wallet.openSessions).toBe(0);
	});

	it('rejects a non-https endpoint-specific URI from the wallet', async () => {
		installWallet({ walletUriBase: 'http://insecure.example.com' });

		await expect(createNostrSeekerLink().transact(CONFIG, (session) => session.authorize())).rejects.toThrow();
	});
});

// Known-answer test for the encoding helpers.
describe('account address mapping', () => {
	it('encodes a known public key to its known base58 form', () => {
		expect(base58FromUint8Array(base64ToUint8Array('AQID'))).toBe('Ldp');
	});
});
