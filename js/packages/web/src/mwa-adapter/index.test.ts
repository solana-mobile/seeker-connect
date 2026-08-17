import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SeekerConnectConfig } from '@solana-mobile/seeker-connect-core';
import { SeekerConnectError, SeekerConnectErrorCode } from '@solana-mobile/seeker-connect-core';

// The protocol package is mocked; these tests cover only the adapter's own
// mapping. integration.test.ts exercises the real protocol.
const { mockStartNostrScenario } = vi.hoisted(() => ({
	mockStartNostrScenario: vi.fn(),
}));

vi.mock('@solana-mobile/mobile-wallet-adapter-protocol', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	startNostrScenario: mockStartNostrScenario,
}));

import {
	SolanaMobileWalletAdapterError,
	SolanaMobileWalletAdapterErrorCode,
	SolanaMobileWalletAdapterProtocolError,
} from '@solana-mobile/mobile-wallet-adapter-protocol';
import {
	base58FromUint8Array,
	base64FromUint8Array,
	base64ToUint8Array,
} from '@solana-mobile/mobile-wallet-adapter-protocol/encoding';

import { createNostrSeekerLink } from './index.js';

const CONFIG: SeekerConnectConfig = {
	identity: {
		name: 'Fake Dapp',
		uri: 'https://fakedapp.example.com',
		icon: 'favicon.ico',
	},
	relayDomain: 'relay.example.com',
};

const AUTHORIZATION = {
	accounts: [{ address: 'YWNjb3VudC1vbmU=', label: 'Account One' }, { address: 'YWNjb3VudC10d28=' }],
	auth_token: 'AUTH_TOKEN',
	wallet_uri_base: 'https://wallet.example.com',
};

function mockScenario(
	walletOverrides: Record<string, ReturnType<typeof vi.fn>> = {},
	scenarioOverrides: { wallet?: Promise<unknown> } = {},
) {
	const wallet = {
		authorize: vi.fn().mockResolvedValue(AUTHORIZATION),
		deauthorize: vi.fn().mockResolvedValue({}),
		getCapabilities: vi.fn().mockResolvedValue({
			max_messages_per_request: 5,
			max_transactions_per_request: 6,
			supported_transaction_versions: ['legacy', 0],
			features: ['solana:signTransactions'],
			supports_clone_authorization: false,
			supports_sign_and_send_transactions: true,
		}),
		signMessages: vi.fn().mockResolvedValue({ signed_payloads: ['c2lnbmVk'] }),
		signTransactions: vi.fn().mockResolvedValue({ signed_payloads: ['c2lnbmVk'] }),
		signAndSendTransactions: vi.fn().mockResolvedValue({ signatures: ['c2ln'] }),
		...walletOverrides,
	};
	const scenario = {
		close: vi.fn(),
		wallet: scenarioOverrides.wallet ?? Promise.resolve(wallet),
	};
	mockStartNostrScenario.mockResolvedValue(scenario);
	return { wallet, scenario };
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
	mockStartNostrScenario.mockReset();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('transact scenario management', () => {
	it('starts a local Nostr scenario against the configured relay', async () => {
		mockScenario();

		await createNostrSeekerLink().transact(CONFIG, () => Promise.resolve());

		expect(mockStartNostrScenario).toHaveBeenCalledWith({
			connectionType: 'local',
			relayDomain: 'relay.example.com',
			baseUri: undefined,
		});
	});

	it('pre-seeds the configured first-connect wallet base URI', async () => {
		mockScenario();

		await createNostrSeekerLink().transact(
			{
				...CONFIG,
				firstConnectWalletBaseUri: 'https://seedvault.example.com',
			},
			() => Promise.resolve(),
		);

		expect(mockStartNostrScenario).toHaveBeenCalledWith(
			expect.objectContaining({
				baseUri: 'https://seedvault.example.com',
			}),
		);
	});

	it('prefers a learned wallet URI over the first-connect URI', async () => {
		mockScenario();

		await createNostrSeekerLink().transact(
			{
				...CONFIG,
				firstConnectWalletBaseUri: 'https://seedvault.example.com',
			},
			() => Promise.resolve(),
			{ walletUriBase: 'https://learned.example.com' },
		);

		expect(mockStartNostrScenario).toHaveBeenCalledWith(
			expect.objectContaining({ baseUri: 'https://learned.example.com' }),
		);
	});

	it('closes the scenario when the callback resolves', async () => {
		const { scenario } = mockScenario();

		await createNostrSeekerLink().transact(CONFIG, () => Promise.resolve());

		expect(scenario.close).toHaveBeenCalledOnce();
	});

	it('closes the scenario and passes a callback failure through unmapped', async () => {
		const { scenario } = mockScenario();
		const failure = new Error('callback failure');

		const error = await rejectionOf(createNostrSeekerLink().transact(CONFIG, () => Promise.reject(failure)));

		expect(error).toBe(failure);
		expect(scenario.close).toHaveBeenCalledOnce();
	});

	it('rejects with association-failed when the scenario cannot start', async () => {
		mockStartNostrScenario.mockRejectedValue(new Error('relay unreachable'));

		const error = await rejectionOf(createNostrSeekerLink().transact(CONFIG, () => Promise.resolve()));

		expect(error).toBeInstanceOf(SeekerConnectError);
		expect((error as SeekerConnectError).code).toBe(SeekerConnectErrorCode.associationFailed);
	});

	it('rejects without starting a scenario when the signal is already aborted', async () => {
		mockScenario();
		const controller = new AbortController();
		controller.abort();

		const error = await rejectionOf(
			createNostrSeekerLink().transact(CONFIG, () => Promise.resolve(), {
				signal: controller.signal,
			}),
		);

		expect(error).toBeInstanceOf(SeekerConnectError);
		expect((error as SeekerConnectError).code).toBe(SeekerConnectErrorCode.sessionClosed);
		expect(mockStartNostrScenario).not.toHaveBeenCalled();
	});

	it('closes the scenario when the signal aborts mid-association', async () => {
		const { scenario } = mockScenario({}, { wallet: new Promise(() => {}) });
		const controller = new AbortController();
		scenario.close.mockImplementation(() => undefined);
		setTimeout(() => controller.abort(), 10);

		const error = await rejectionOf(
			createNostrSeekerLink().transact({ ...CONFIG, associationTimeoutMs: 500 }, () => Promise.resolve(), {
				signal: controller.signal,
			}),
		);

		expect(error).toBeInstanceOf(SeekerConnectError);
		expect(scenario.close).toHaveBeenCalled();
	});

	it('rejects with association-failed when no wallet connects in time', async () => {
		const { scenario } = mockScenario({}, { wallet: new Promise(() => {}) });

		const error = await rejectionOf(
			createNostrSeekerLink().transact({ ...CONFIG, associationTimeoutMs: 10 }, () => Promise.resolve()),
		);

		expect(error).toBeInstanceOf(SeekerConnectError);
		expect((error as SeekerConnectError).code).toBe(SeekerConnectErrorCode.associationFailed);
		expect(scenario.close).toHaveBeenCalledOnce();
	});
});

describe('authorize mapping', () => {
	it('authorizes with the dapp identity and the default chain', async () => {
		const { wallet } = mockScenario();

		await createNostrSeekerLink().transact(CONFIG, (session) => session.authorize());

		expect(wallet.authorize).toHaveBeenCalledWith({
			identity: CONFIG.identity,
			chain: 'solana:mainnet',
			auth_token: undefined,
			sign_in_payload: undefined,
		});
	});

	it('uses the configured chain, overridable per request', async () => {
		const { wallet } = mockScenario();
		const link = createNostrSeekerLink();
		const config = { ...CONFIG, chain: 'solana:devnet' as const };

		await link.transact(config, (session) => session.authorize());
		await link.transact(config, (session) => session.authorize({ chain: 'solana:testnet' }));

		expect(wallet.authorize).toHaveBeenNthCalledWith(1, expect.objectContaining({ chain: 'solana:devnet' }));
		expect(wallet.authorize).toHaveBeenNthCalledWith(2, expect.objectContaining({ chain: 'solana:testnet' }));
	});

	it('forwards an auth token and sign-in payload', async () => {
		const { wallet } = mockScenario();
		const signInPayload = { domain: 'dapp.example.com' };

		await createNostrSeekerLink().transact(CONFIG, (session) =>
			session.authorize({ authToken: 'TOKEN', signInPayload }),
		);

		expect(wallet.authorize).toHaveBeenCalledWith(
			expect.objectContaining({
				auth_token: 'TOKEN',
				sign_in_payload: signInPayload,
			}),
		);
	});

	it('maps the authorization result to consumer shapes', async () => {
		mockScenario();

		const authorization = await createNostrSeekerLink().transact(CONFIG, (session) => session.authorize());

		const [keyOne, keyTwo] = AUTHORIZATION.accounts.map((account) => base64ToUint8Array(account.address));
		expect(authorization.accounts).toEqual([
			{
				address: base58FromUint8Array(keyOne!),
				publicKey: keyOne,
				label: 'Account One',
			},
			{
				address: base58FromUint8Array(keyTwo!),
				publicKey: keyTwo,
				label: undefined,
			},
		]);
		expect(authorization.authToken).toBe('AUTH_TOKEN');
		expect(authorization.walletUriBase).toBe('https://wallet.example.com');
		expect(authorization.signInResult).toBeUndefined();
	});

	it('maps a sign-in result to consumer shapes', async () => {
		const address = base64FromUint8Array(Uint8Array.of(1, 2, 3));
		mockScenario({
			authorize: vi.fn().mockResolvedValue({
				...AUTHORIZATION,
				sign_in_result: {
					address,
					signed_message: 'bWVzc2FnZQ==',
					signature: 'c2lnbmF0dXJl',
				},
			}),
		});

		const authorization = await createNostrSeekerLink().transact(CONFIG, (session) => session.authorize());

		expect(authorization.signInResult).toEqual({
			address: base58FromUint8Array(Uint8Array.of(1, 2, 3)),
			publicKey: Uint8Array.of(1, 2, 3),
			signedMessage: base64ToUint8Array('bWVzc2FnZQ=='),
			signature: base64ToUint8Array('c2lnbmF0dXJl'),
		});
	});

	it('leaves walletUriBase unset when the wallet supplies none', async () => {
		mockScenario({
			authorize: vi.fn().mockResolvedValue({ ...AUTHORIZATION, wallet_uri_base: null }),
		});

		const authorization = await createNostrSeekerLink().transact(CONFIG, (session) => session.authorize());

		expect(authorization.walletUriBase).toBeUndefined();
	});
});

describe('method mapping', () => {
	it('deauthorize passes the token as auth_token', async () => {
		const { wallet } = mockScenario();

		await createNostrSeekerLink().transact(CONFIG, (session) => session.deauthorize({ authToken: 'REVOKE_ME' }));

		expect(wallet.deauthorize).toHaveBeenCalledWith({
			auth_token: 'REVOKE_ME',
		});
	});

	it('getCapabilities maps the wire shape', async () => {
		mockScenario();

		const capabilities = await createNostrSeekerLink().transact(CONFIG, (session) => session.getCapabilities());

		expect(capabilities).toEqual({
			maxMessagesPerRequest: 5,
			maxTransactionsPerRequest: 6,
			supportedTransactionVersions: ['legacy', 0],
			features: ['solana:signTransactions'],
			supportsSignAndSendTransactions: true,
		});
	});

	it('signMessages converts addresses and payloads to base64 and back', async () => {
		const { wallet } = mockScenario();
		const publicKey = Uint8Array.of(1, 2, 3);
		const message = Uint8Array.of(9, 9);

		const signed = await createNostrSeekerLink().transact(CONFIG, (session) =>
			session.signMessages({
				addresses: [base58FromUint8Array(publicKey)],
				payloads: [message],
			}),
		);

		expect(wallet.signMessages).toHaveBeenCalledWith({
			addresses: [base64FromUint8Array(publicKey)],
			payloads: [base64FromUint8Array(message)],
		});
		expect(signed).toEqual([base64ToUint8Array('c2lnbmVk')]);
	});

	it('signAndSendTransactions maps options to the wire shape', async () => {
		const { wallet } = mockScenario();

		const signatures = await createNostrSeekerLink().transact(CONFIG, (session) =>
			session.signAndSendTransactions({
				payloads: [Uint8Array.of(1)],
				options: {
					minContextSlot: 1,
					commitment: 'confirmed',
					skipPreflight: true,
					maxRetries: 2,
					waitForCommitmentToSendNextTransaction: true,
				},
			}),
		);

		expect(wallet.signAndSendTransactions).toHaveBeenCalledWith({
			payloads: [base64FromUint8Array(Uint8Array.of(1))],
			options: {
				min_context_slot: 1,
				commitment: 'confirmed',
				skip_preflight: true,
				max_retries: 2,
				wait_for_commitment_to_send_next_transaction: true,
			},
		});
		expect(signatures).toEqual([base64ToUint8Array('c2ln')]);
	});
});

describe('error mapping', () => {
	it('maps a declined authorization to authorization-declined', async () => {
		mockScenario({
			authorize: vi.fn().mockRejectedValue(new SolanaMobileWalletAdapterProtocolError(0, -1, 'declined')),
		});

		const error = await rejectionOf(createNostrSeekerLink().transact(CONFIG, (session) => session.authorize()));

		expect(error).toBeInstanceOf(SeekerConnectError);
		expect((error as SeekerConnectError).code).toBe(SeekerConnectErrorCode.authorizationDeclined);
	});

	it('maps a signing refusal to request-declined', async () => {
		mockScenario({
			signTransactions: vi
				.fn()
				.mockRejectedValue(new SolanaMobileWalletAdapterProtocolError(0, -3, 'not signed')),
		});

		const error = await rejectionOf(
			createNostrSeekerLink().transact(CONFIG, (session) =>
				session.signTransactions({ payloads: [Uint8Array.of(1)] }),
			),
		);

		expect((error as SeekerConnectError).code).toBe(SeekerConnectErrorCode.requestDeclined);
	});

	it('maps a session drop to session-closed', async () => {
		mockScenario({
			authorize: vi
				.fn()
				.mockRejectedValue(
					new SolanaMobileWalletAdapterError(
						SolanaMobileWalletAdapterErrorCode.ERROR_SESSION_TIMEOUT,
						'session timed out',
					),
				),
		});

		const error = await rejectionOf(createNostrSeekerLink().transact(CONFIG, (session) => session.authorize()));

		expect((error as SeekerConnectError).code).toBe(SeekerConnectErrorCode.sessionClosed);
	});

	it('maps other wallet failures to wallet-error', async () => {
		mockScenario({
			authorize: vi.fn().mockRejectedValue(new SolanaMobileWalletAdapterProtocolError(0, -32601, 'no method')),
		});

		const error = await rejectionOf(createNostrSeekerLink().transact(CONFIG, (session) => session.authorize()));

		expect((error as SeekerConnectError).code).toBe(SeekerConnectErrorCode.walletError);
	});
});
