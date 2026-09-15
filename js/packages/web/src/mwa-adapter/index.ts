/**
 * Web implementation of the `SeekerLink` port over
 * `@solana-mobile/mobile-wallet-adapter-protocol`'s Nostr relay transport.
 *
 * Every `transact` establishes one scenario (`connectionType: 'local'`),
 * runs the callback, and closes the scenario — MWA sessions are
 * per-interaction; nothing here outlives a single call.
 */
import type {
	SeekerAuthorization,
	SeekerConnectConfig,
	SeekerLink,
	SeekerTransactOptions,
	SeekerWallet,
} from '@solana-mobile/seeker-connect-core';
import { DEFAULT_SEEKER_CHAIN, SeekerConnectError, SeekerConnectErrorCode } from '@solana-mobile/seeker-connect-core';
import type { AuthorizationResult, MobileWallet } from '@solana-mobile/mobile-wallet-adapter-protocol';
import {
	SolanaMobileWalletAdapterError,
	SolanaMobileWalletAdapterProtocolError,
	SolanaMobileWalletAdapterProtocolErrorCode,
	startNostrScenario,
} from '@solana-mobile/mobile-wallet-adapter-protocol';
import {
	base58FromUint8Array,
	base58ToUint8Array,
	base64FromUint8Array,
	base64ToUint8Array,
} from '@solana-mobile/mobile-wallet-adapter-protocol/encoding';

const DEFAULT_ASSOCIATION_TIMEOUT_MS = 30_000;

/**
 * Creates the web `SeekerLink`. Each `transact` opens one MWA session over
 * the configured Nostr relay and closes it when the callback settles.
 */
export function createNostrSeekerLink(): SeekerLink {
	return {
		async transact<T>(
			config: SeekerConnectConfig,
			callback: (wallet: SeekerWallet) => Promise<T>,
			options?: SeekerTransactOptions,
		): Promise<T> {
			const signal = options?.signal;
			if (signal?.aborted) {
				throw new SeekerConnectError(
					SeekerConnectErrorCode.sessionClosed,
					'The interaction was aborted before the session started',
				);
			}
			let scenario;
			try {
				scenario = await startNostrScenario({
					connectionType: 'local',
					relayDomain: config.relayDomain,
					baseUri: options?.walletUriBase ?? config.firstConnectWalletBaseUri,
				});
			} catch (e) {
				throw associationFailure(e);
			}
			// The scenario closes below regardless of outcome; if the race is
			// lost, the abandoned wallet promise still rejects on close and must
			// not surface as an unhandled rejection.
			void scenario.wallet.then(undefined, () => undefined);
			const onAbort = () => scenario.close();
			signal?.addEventListener('abort', onAbort, { once: true });
			try {
				const wallet = await associate(
					scenario.wallet,
					config.associationTimeoutMs ?? DEFAULT_ASSOCIATION_TIMEOUT_MS,
				);
				return await callback(createSessionWallet(wallet, config));
			} finally {
				signal?.removeEventListener('abort', onAbort);
				scenario.close();
			}
		},
	};
}

/** Bounds association only; the interaction itself is never timed out. */
async function associate(walletPromise: Promise<MobileWallet>, timeoutMs: number): Promise<MobileWallet> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			walletPromise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() =>
						reject(
							new SeekerConnectError(
								SeekerConnectErrorCode.associationFailed,
								`No wallet completed association within ${timeoutMs}ms`,
							),
						),
					timeoutMs,
				);
			}),
		]);
	} catch (e) {
		throw e instanceof SeekerConnectError ? e : associationFailure(e);
	} finally {
		clearTimeout(timer);
	}
}

function associationFailure(cause: unknown): SeekerConnectError {
	return new SeekerConnectError(
		SeekerConnectErrorCode.associationFailed,
		`Wallet association failed: ${errorMessage(cause)}`,
		{ cause },
	);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Maps protocol-layer failures onto `SeekerConnectError`; anything else
 * (notably callback-originated errors) passes through untouched.
 */
function mapWalletError(e: unknown): unknown {
	if (e instanceof SolanaMobileWalletAdapterProtocolError) {
		switch (e.code) {
			case SolanaMobileWalletAdapterProtocolErrorCode.ERROR_AUTHORIZATION_FAILED:
				return new SeekerConnectError(SeekerConnectErrorCode.authorizationDeclined, e.message, { cause: e });
			case SolanaMobileWalletAdapterProtocolErrorCode.ERROR_NOT_SIGNED:
			case SolanaMobileWalletAdapterProtocolErrorCode.ERROR_NOT_SUBMITTED:
				return new SeekerConnectError(SeekerConnectErrorCode.requestDeclined, e.message, { cause: e });
			default:
				return new SeekerConnectError(SeekerConnectErrorCode.walletError, e.message, { cause: e });
		}
	}
	if (e instanceof SolanaMobileWalletAdapterError) {
		switch (e.code) {
			case 'ERROR_SESSION_CLOSED':
			case 'ERROR_SESSION_TIMEOUT':
				return new SeekerConnectError(SeekerConnectErrorCode.sessionClosed, e.message, { cause: e });
			default:
				return new SeekerConnectError(SeekerConnectErrorCode.walletError, e.message, { cause: e });
		}
	}
	return e;
}

function createSessionWallet(wallet: MobileWallet, config: SeekerConnectConfig): SeekerWallet {
	const guard = async <T>(fn: () => Promise<T>): Promise<T> => {
		try {
			return await fn();
		} catch (e) {
			throw mapWalletError(e);
		}
	};
	return {
		authorize: (request) =>
			guard(async () => {
				const result = await wallet.authorize({
					identity: config.identity,
					chain: request?.chain ?? config.chain ?? DEFAULT_SEEKER_CHAIN,
					auth_token: request?.authToken,
					sign_in_payload: request?.signInPayload,
				});
				return mapAuthorization(result);
			}),
		deauthorize: ({ authToken }) =>
			guard(async () => {
				await wallet.deauthorize({ auth_token: authToken });
			}),
		getCapabilities: () =>
			guard(async () => {
				const capabilities = await wallet.getCapabilities();
				return {
					maxMessagesPerRequest: capabilities.max_messages_per_request,
					maxTransactionsPerRequest: capabilities.max_transactions_per_request,
					supportedTransactionVersions: capabilities.supported_transaction_versions,
					features: capabilities.features,
					supportsSignAndSendTransactions: capabilities.supports_sign_and_send_transactions,
				};
			}),
		signMessages: ({ addresses, payloads }) =>
			guard(async () => {
				const result = await wallet.signMessages({
					addresses: addresses.map((address) => base64FromUint8Array(base58ToUint8Array(address))),
					payloads: payloads.map((payload) => base64FromUint8Array(payload)),
				});
				return result.signed_payloads.map(base64ToUint8Array);
			}),
		signTransactions: ({ payloads }) =>
			guard(async () => {
				const result = await wallet.signTransactions({
					payloads: payloads.map((payload) => base64FromUint8Array(payload)),
				});
				return result.signed_payloads.map(base64ToUint8Array);
			}),
		signAndSendTransactions: ({ payloads, options }) =>
			guard(async () => {
				const result = await wallet.signAndSendTransactions({
					payloads: payloads.map((payload) => base64FromUint8Array(payload)),
					...(options
						? {
								options: {
									min_context_slot: options.minContextSlot,
									commitment: options.commitment,
									skip_preflight: options.skipPreflight,
									max_retries: options.maxRetries,
									wait_for_commitment_to_send_next_transaction:
										options.waitForCommitmentToSendNextTransaction,
								},
							}
						: {}),
				});
				return result.signatures.map(base64ToUint8Array);
			}),
	};
}

function mapAuthorization(result: AuthorizationResult): SeekerAuthorization {
	return {
		accounts: result.accounts.map((account) => {
			const publicKey = base64ToUint8Array(account.address);
			return {
				address: base58FromUint8Array(publicKey),
				publicKey,
				label: account.label,
			};
		}),
		authToken: result.auth_token,
		walletUriBase: result.wallet_uri_base ?? undefined,
		signInResult: result.sign_in_result
			? {
					address: base58FromUint8Array(base64ToUint8Array(result.sign_in_result.address)),
					publicKey: base64ToUint8Array(result.sign_in_result.address),
					signedMessage: base64ToUint8Array(result.sign_in_result.signed_message),
					signature: base64ToUint8Array(result.sign_in_result.signature),
				}
			: undefined,
	};
}
