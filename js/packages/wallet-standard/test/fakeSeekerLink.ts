/**
 * In-memory `SeekerLink` double for wallet-standard tests. Implements the
 * port shape directly; protocol correctness is covered by `@solana-mobile/seeker-connect-web`'s
 * fake-wallet harness, not here.
 */
import type {
	SeekerAccount,
	SeekerAuthorizeRequest,
	SeekerConnectConfig,
	SeekerLink,
	SeekerTransactOptions,
	SeekerWallet,
	SeekerWalletCapabilities,
} from '@solana-mobile/seeker-connect-core';
import { SeekerConnectError, SeekerConnectErrorCode } from '@solana-mobile/seeker-connect-core';

export const FAKE_CAPABILITIES: SeekerWalletCapabilities = {
	maxMessagesPerRequest: 10,
	maxTransactionsPerRequest: 10,
	supportedTransactionVersions: ['legacy', 0],
	features: ['solana:signTransactions'],
	supportsSignAndSendTransactions: true,
};

export const FAKE_ACCOUNT: SeekerAccount = {
	address: 'FakeAddress1111',
	publicKey: Uint8Array.of(1, 2, 3, 4),
	label: 'Fake Account',
};

const SIGNATURE = new Uint8Array(64).fill(9);

/** payload ‖ 64-byte fake signature. */
export function fakeSignedPayload(payload: Uint8Array): Uint8Array {
	const out = new Uint8Array(payload.length + SIGNATURE.length);
	out.set(payload);
	out.set(SIGNATURE, payload.length);
	return out;
}

export function fakeTransactionSignature(payload: Uint8Array): Uint8Array {
	return new Uint8Array(64).fill(payload.length % 256);
}

export interface FakeLinkScript {
	accounts?: SeekerAccount[];
	authToken?: string;
	walletUriBase?: string;
	capabilities?: SeekerWalletCapabilities;
	/** When set, `authorize` rejects with this error. */
	authorizeError?: SeekerConnectError;
	/** When set, `transact` itself rejects (association never happened). */
	transactError?: SeekerConnectError;
	/** When true, authorize resolves without a sign-in result. */
	omitSignInResult?: boolean;
	/** When true, `transact` never settles unless its signal aborts. */
	hang?: boolean;
}

export class FakeSeekerLink implements SeekerLink {
	script: FakeLinkScript;
	readonly transactCalls: {
		config: SeekerConnectConfig;
		options?: SeekerTransactOptions;
	}[] = [];
	readonly requests: { method: string; params?: unknown }[] = [];

	constructor(script: FakeLinkScript = {}) {
		this.script = script;
	}

	get authorizeRequests(): SeekerAuthorizeRequest[] {
		return this.requests.filter((r) => r.method === 'authorize').map((r) => r.params as SeekerAuthorizeRequest);
	}

	async transact<T>(
		config: SeekerConnectConfig,
		callback: (wallet: SeekerWallet) => Promise<T>,
		options?: SeekerTransactOptions,
	): Promise<T> {
		this.transactCalls.push({ config, options });
		if (this.script.transactError) throw this.script.transactError;
		if (this.script.hang) {
			return new Promise((_, reject) => {
				options?.signal?.addEventListener('abort', () =>
					reject(new SeekerConnectError(SeekerConnectErrorCode.sessionClosed, 'session aborted')),
				);
			});
		}
		return callback(this.#wallet());
	}

	#wallet(): SeekerWallet {
		const accounts = this.script.accounts ?? [FAKE_ACCOUNT];
		return {
			authorize: async (request) => {
				this.requests.push({ method: 'authorize', params: request });
				if (this.script.authorizeError) throw this.script.authorizeError;
				const signInPayload = request?.signInPayload;
				const signedMessage = signInPayload
					? new TextEncoder().encode(JSON.stringify(signInPayload))
					: undefined;
				return {
					accounts,
					authToken: this.script.authToken ?? 'FAKE_TOKEN',
					walletUriBase: this.script.walletUriBase,
					signInResult:
						signedMessage && !this.script.omitSignInResult
							? {
									address: accounts[0]!.address,
									publicKey: accounts[0]!.publicKey,
									signedMessage,
									signature: fakeTransactionSignature(signedMessage),
								}
							: undefined,
				};
			},
			deauthorize: async (request) => {
				this.requests.push({ method: 'deauthorize', params: request });
			},
			getCapabilities: async () => {
				this.requests.push({ method: 'getCapabilities' });
				return this.script.capabilities ?? FAKE_CAPABILITIES;
			},
			signMessages: async (request) => {
				this.requests.push({ method: 'signMessages', params: request });
				return request.payloads.map((payload) => fakeSignedPayload(payload));
			},
			signTransactions: async (request) => {
				this.requests.push({
					method: 'signTransactions',
					params: request,
				});
				return request.payloads.map((payload) => fakeSignedPayload(payload));
			},
			signAndSendTransactions: async (request) => {
				this.requests.push({
					method: 'signAndSendTransactions',
					params: request,
				});
				return request.payloads.map((payload) => fakeTransactionSignature(payload));
			},
		};
	}
}
