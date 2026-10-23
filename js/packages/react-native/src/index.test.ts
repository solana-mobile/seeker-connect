import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
	configure: vi.fn(),
	walletAvailability: vi.fn(),
	restore: vi.fn(),
	connect: vi.fn(),
	signIn: vi.fn(),
	signMessages: vi.fn(),
	signTransactions: vi.fn(),
	signAndSendTransactions: vi.fn(),
	transact: vi.fn(),
	disconnect: vi.fn(),
}));
const nativeModules = vi.hoisted(() => ({ SeekerConnect: undefined as unknown }));

vi.mock('react-native', () => ({
	NativeModules: nativeModules,
	requireNativeComponent: (name: string) => `native:${name}`,
}));

import { SeekerConnect, SeekerConnectButton, SeekerConnectError } from './index.js';

const b64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes));

const nativeAuthorization = {
	accounts: [{ address: 'Addr1', publicKey: b64([1, 2, 3]), label: null }],
	authToken: 'token',
	walletUriBase: null,
	chain: 'solana:mainnet',
	capabilities: {
		supportedTransactionVersions: ['legacy', 0],
		features: ['solana:signTransactions'],
		supportsSignAndSendTransactions: true,
	},
};

beforeEach(() => {
	vi.resetAllMocks();
	nativeModules.SeekerConnect = native;
});

describe('SeekerConnect', () => {
	it('passes the config to the native module', () => {
		const config = { identity: { name: 'Dapp', uri: 'https://dapp.example.com' } };
		native.configure.mockReturnValue(null);
		SeekerConnect.configure(config);
		expect(native.configure).toHaveBeenCalledWith(config);
	});

	it('throws the error configure returns', () => {
		native.configure.mockReturnValue({ code: 'INVALID_ARGUMENT', message: 'identity is required' });
		const config = { identity: { name: 'Dapp', uri: 'https://dapp.example.com' } };
		const error = (() => {
			try {
				SeekerConnect.configure(config);
			} catch (e) {
				return e;
			}
		})();
		expect(error).toBeInstanceOf(SeekerConnectError);
		expect((error as SeekerConnectError).code).toBe('invalid-argument');
		expect((error as SeekerConnectError).message).toBe('identity is required');
	});

	it('throws not-configured from configure when the native module is not linked', () => {
		nativeModules.SeekerConnect = undefined;
		const config = { identity: { name: 'Dapp', uri: 'https://dapp.example.com' } };
		expect(() => SeekerConnect.configure(config)).toThrow(SeekerConnectError);
	});

	it('reports wallet availability in lower case', async () => {
		native.walletAvailability.mockResolvedValue('CERTIFIED');
		expect(await SeekerConnect.walletAvailability()).toBe('certified');
	});

	it('decodes the authorization from connect', async () => {
		native.connect.mockResolvedValue(nativeAuthorization);
		expect(await SeekerConnect.connect()).toEqual({
			...nativeAuthorization,
			accounts: [{ address: 'Addr1', publicKey: Uint8Array.of(1, 2, 3), label: undefined }],
			walletUriBase: undefined,
		});
	});

	it('restores null when nothing is cached, and decodes a cached authorization', async () => {
		native.restore.mockResolvedValueOnce(null);
		expect(await SeekerConnect.restore()).toBeNull();
		native.restore.mockResolvedValueOnce({ ...nativeAuthorization, walletUriBase: 'https://wallet.example.com' });
		expect((await SeekerConnect.restore())?.walletUriBase).toBe('https://wallet.example.com');
	});

	it('signs in, sending a null payload by default and decoding the result', async () => {
		native.signIn.mockResolvedValue({
			address: 'Addr1',
			publicKey: b64([1]),
			signedMessage: b64([2]),
			signature: b64([3]),
		});
		expect(await SeekerConnect.signIn()).toEqual({
			address: 'Addr1',
			publicKey: Uint8Array.of(1),
			signedMessage: Uint8Array.of(2),
			signature: Uint8Array.of(3),
		});
		expect(native.signIn).toHaveBeenCalledWith(null);
		await SeekerConnect.signIn({ statement: 'hi' });
		expect(native.signIn).toHaveBeenLastCalledWith({ statement: 'hi' });
	});

	it('encodes payloads as base64 and decodes the signed results', async () => {
		native.signMessages.mockResolvedValue([b64([9, 9])]);
		expect(await SeekerConnect.signMessages(['Addr1'], [Uint8Array.of(255, 0)])).toEqual([Uint8Array.of(9, 9)]);
		expect(native.signMessages).toHaveBeenCalledWith(['Addr1'], [b64([255, 0])]);

		native.signTransactions.mockResolvedValue([b64([7])]);
		expect(await SeekerConnect.signTransactions([Uint8Array.of(1)])).toEqual([Uint8Array.of(7)]);
		expect(native.signTransactions).toHaveBeenCalledWith([b64([1])]);
	});

	it('forwards sign-and-send options, or null without them', async () => {
		native.signAndSendTransactions.mockResolvedValue([b64([4])]);
		expect(await SeekerConnect.signAndSendTransactions([Uint8Array.of(1)])).toEqual([Uint8Array.of(4)]);
		expect(native.signAndSendTransactions).toHaveBeenCalledWith([b64([1])], null);
		await SeekerConnect.signAndSendTransactions([Uint8Array.of(1)], { commitment: 'confirmed' });
		expect(native.signAndSendTransactions).toHaveBeenLastCalledWith([b64([1])], { commitment: 'confirmed' });
	});

	it('runs several requests in one transact, encoding each', async () => {
		native.transact.mockResolvedValue([[b64([1])], [b64([2])]]);
		const results = await SeekerConnect.transact([
			{ method: 'signMessages', addresses: ['Addr1'], payloads: [Uint8Array.of(5)] },
			{ method: 'signAndSendTransactions', payloads: [Uint8Array.of(6)], options: { maxRetries: 2 } },
		]);
		expect(results).toEqual([[Uint8Array.of(1)], [Uint8Array.of(2)]]);
		expect(native.transact).toHaveBeenCalledWith([
			{ method: 'signMessages', addresses: ['Addr1'], payloads: [b64([5])] },
			{ method: 'signAndSendTransactions', payloads: [b64([6])], options: { maxRetries: 2 } },
		]);
	});

	it('disconnects', async () => {
		native.disconnect.mockResolvedValue(null);
		await SeekerConnect.disconnect();
		expect(native.disconnect).toHaveBeenCalled();
	});

	it('maps native error codes onto SeekerConnectError codes', async () => {
		const codes = {
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
			SOMETHING_NEW: 'wallet-error',
		};
		for (const [nativeCode, code] of Object.entries(codes)) {
			const failure = Object.assign(new Error(`failed: ${nativeCode}`), { code: nativeCode });
			native.connect.mockRejectedValueOnce(failure);
			const error = await SeekerConnect.connect().catch((e: unknown) => e);
			expect(error).toBeInstanceOf(SeekerConnectError);
			expect((error as SeekerConnectError).code).toBe(code);
			expect((error as SeekerConnectError).message).toBe(`failed: ${nativeCode}`);
			expect((error as SeekerConnectError).cause).toBe(failure);
		}
	});

	it('maps a non-Error rejection to wallet-error', async () => {
		native.connect.mockRejectedValueOnce('boom');
		const error = await SeekerConnect.connect().catch((e: unknown) => e);
		expect((error as SeekerConnectError).code).toBe('wallet-error');
		expect((error as SeekerConnectError).message).toBe('boom');
	});

	it('fails with not-configured when the native module is not linked', async () => {
		nativeModules.SeekerConnect = undefined;
		const error = await SeekerConnect.connect().catch((e: unknown) => e);
		expect(error).toBeInstanceOf(SeekerConnectError);
		expect((error as SeekerConnectError).code).toBe('not-configured');
	});
});

describe('SeekerConnectButton', () => {
	it('is the native SeekerConnectButton view', () => {
		expect(SeekerConnectButton).toBe('native:SeekerConnectButton');
	});
});
