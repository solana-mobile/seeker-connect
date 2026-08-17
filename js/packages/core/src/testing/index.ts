/**
 * Contract-test suite that every `SeekerLink` implementation must pass.
 * Invoke `testSeekerLinkContract` from a vitest file, supplying a driver
 * that wires the link under test to a controllable wallet double.
 *
 * Imports `vitest`; must only be imported by test code.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SeekerAccount, SeekerConnectConfig, SeekerLink, SeekerWalletCapabilities } from '../index.js';
import { SeekerConnectError, SeekerConnectErrorCode } from '../index.js';

/** What the driver's wallet double is scripted to respond with. */
export interface SeekerLinkContractExpectations {
	accounts: readonly SeekerAccount[];
	authToken: string;
	/** The endpoint-specific URI the wallet double hands out. */
	walletUriBase: string;
	capabilities: SeekerWalletCapabilities;
	/** The deterministic transform the wallet double applies when signing a payload. */
	signedPayload(payload: Uint8Array): Uint8Array;
	/** The signature bytes the wallet double reports for a submitted transaction. */
	transactionSignature(payload: Uint8Array): Uint8Array;
}

/** Wallet-double observations the driver must expose to the suite. */
export interface SeekerLinkContractObservations {
	/** Sessions ever established, including ones since closed. */
	sessionsOpened(): number;
	/** Sessions currently open. */
	openSessions(): number;
	/**
	 * The wallet base URI targeted by each wallet launch, in order;
	 * `undefined` for the generic `solana-wallet:` scheme.
	 */
	targetedBaseUris(): readonly (string | undefined)[];
	/** The authorize requests the wallet double received, in order. */
	authorizeRequests(): readonly {
		authToken?: string;
		chain?: string;
		hasSignInPayload: boolean;
	}[];
	/** Auth tokens the wallet double has seen deauthorized, in order. */
	deauthorizedTokens(): readonly string[];
}

export interface SeekerLinkContractContext {
	/** The link under test, wired to the driver's wallet double. */
	link: SeekerLink;
	/** A config that connects successfully against the wallet double. */
	config: SeekerConnectConfig;
	expected: SeekerLinkContractExpectations;
	observed: SeekerLinkContractObservations;
	/** Scripts the wallet double to decline the next authorize. */
	scriptAuthorizeDecline(): void;
	/** Scripts the wallet double to never complete association. */
	scriptUnresponsiveWallet(): void;
}

export interface SeekerLinkContractDriver {
	setup(): Promise<SeekerLinkContractContext> | SeekerLinkContractContext;
	teardown?(): Promise<void> | void;
}

const MESSAGE = Uint8Array.of(10, 20, 30);
const TRANSACTION = Uint8Array.of(40, 50, 60, 70);

export function testSeekerLinkContract(implementationName: string, driver: SeekerLinkContractDriver): void {
	describe(`SeekerLink contract: ${implementationName}`, () => {
		let context: SeekerLinkContractContext;

		beforeEach(async () => {
			context = await driver.setup();
		});

		afterEach(async () => {
			await driver.teardown?.();
		});

		describe('session lifecycle', () => {
			it('runs the callback against an established session and resolves its result', async () => {
				const result = await context.link.transact(context.config, () => Promise.resolve('callback-result'));
				expect(result).toBe('callback-result');
				expect(context.observed.sessionsOpened()).toBe(1);
			});

			it('closes the session once the callback resolves', async () => {
				await context.link.transact(context.config, () => Promise.resolve());
				expect(context.observed.openSessions()).toBe(0);
			});

			it('closes the session when the callback rejects, and rethrows', async () => {
				const failure = new Error('callback failure');
				await expect(context.link.transact(context.config, () => Promise.reject(failure))).rejects.toBe(
					failure,
				);
				expect(context.observed.openSessions()).toBe(0);
			});

			it('establishes a fresh session for every transact call', async () => {
				await context.link.transact(context.config, () => Promise.resolve());
				await context.link.transact(context.config, () => Promise.resolve());
				expect(context.observed.sessionsOpened()).toBe(2);
				expect(context.observed.openSessions()).toBe(0);
			});

			it('an aborted signal prevents the session and rejects', async () => {
				const controller = new AbortController();
				controller.abort();
				const callback = () => Promise.resolve('unreachable');
				await expect(
					context.link.transact(context.config, callback, {
						signal: controller.signal,
					}),
				).rejects.toBeInstanceOf(SeekerConnectError);
				expect(context.observed.openSessions()).toBe(0);
			});

			it('aborting mid-association closes the session and rejects', async () => {
				context.scriptUnresponsiveWallet();
				const controller = new AbortController();
				setTimeout(() => controller.abort(), 100);
				const error = await context.link
					.transact(context.config, () => Promise.resolve(), {
						signal: controller.signal,
					})
					.then(
						() => {
							throw new Error('transact resolved unexpectedly');
						},
						(e: unknown) => e,
					);
				expect(error).toBeInstanceOf(SeekerConnectError);
				expect(context.observed.openSessions()).toBe(0);
			});
		});

		describe('wallet targeting', () => {
			it("targets the config's first-connect base URI when no wallet URI is known", async () => {
				await context.link.transact(
					{
						...context.config,
						firstConnectWalletBaseUri: 'https://firstconnect.example.com',
					},
					() => Promise.resolve(),
				);
				expect(context.observed.targetedBaseUris()).toEqual(['https://firstconnect.example.com']);
			});

			it('targets the learned wallet URI over the first-connect URI', async () => {
				await context.link.transact(
					{
						...context.config,
						firstConnectWalletBaseUri: 'https://firstconnect.example.com',
					},
					() => Promise.resolve(),
					{ walletUriBase: 'https://learned.example.com' },
				);
				expect(context.observed.targetedBaseUris()).toEqual(['https://learned.example.com']);
			});
		});

		describe('authorization', () => {
			it('resolves the wallet-authorized accounts, consumer-shaped', async () => {
				const authorization = await context.link.transact(context.config, (wallet) => wallet.authorize());
				expect(authorization.accounts).toEqual(context.expected.accounts);
			});

			it("surfaces the wallet's auth token for future reauthorization", async () => {
				const authorization = await context.link.transact(context.config, (wallet) => wallet.authorize());
				expect(authorization.authToken).toBe(context.expected.authToken);
			});

			it("learns the wallet's endpoint-specific base URI", async () => {
				const authorization = await context.link.transact(context.config, (wallet) => wallet.authorize());
				expect(authorization.walletUriBase).toBe(context.expected.walletUriBase);
			});

			it('forwards the configured chain to the wallet', async () => {
				await context.link.transact({ ...context.config, chain: 'solana:devnet' }, (wallet) =>
					wallet.authorize(),
				);
				expect(context.observed.authorizeRequests()).toMatchObject([{ chain: 'solana:devnet' }]);
			});

			it('reauthorizes with a stored auth token', async () => {
				await context.link.transact(context.config, (wallet) =>
					wallet.authorize({ authToken: context.expected.authToken }),
				);
				expect(context.observed.authorizeRequests()).toMatchObject([{ authToken: context.expected.authToken }]);
			});

			it("resolves the wallet's sign-in proof for a sign-in payload", async () => {
				const authorization = await context.link.transact(context.config, (wallet) =>
					wallet.authorize({
						signInPayload: {
							domain: 'dapp.example.com',
							statement: 'hi',
						},
					}),
				);
				const [expectedAccount] = context.expected.accounts;
				expect(authorization.signInResult).toBeDefined();
				expect(authorization.signInResult!.address).toBe(expectedAccount!.address);
				expect(authorization.signInResult!.publicKey).toEqual(expectedAccount!.publicKey);
				expect(authorization.signInResult!.signedMessage.length).toBeGreaterThan(0);
				expect(authorization.signInResult!.signature.length).toBeGreaterThan(0);
				expect(context.observed.authorizeRequests()).toMatchObject([{ hasSignInPayload: true }]);
			});

			it('deauthorizes a token with the wallet', async () => {
				await context.link.transact(context.config, (wallet) =>
					wallet.deauthorize({
						authToken: context.expected.authToken,
					}),
				);
				expect(context.observed.deauthorizedTokens()).toEqual([context.expected.authToken]);
			});
		});

		describe('capabilities', () => {
			it("decodes the wallet's capabilities", async () => {
				const capabilities = await context.link.transact(context.config, (wallet) => wallet.getCapabilities());
				expect(capabilities).toEqual(context.expected.capabilities);
			});
		});

		describe('signing', () => {
			it('signMessages resolves the signed payload bytes', async () => {
				const [account] = context.expected.accounts;
				const signed = await context.link.transact(context.config, (wallet) =>
					wallet.signMessages({
						addresses: [account!.address],
						payloads: [MESSAGE],
					}),
				);
				expect(signed).toEqual([context.expected.signedPayload(MESSAGE)]);
			});

			it('signTransactions resolves the signed transaction bytes', async () => {
				const signed = await context.link.transact(context.config, (wallet) =>
					wallet.signTransactions({ payloads: [TRANSACTION] }),
				);
				expect(signed).toEqual([context.expected.signedPayload(TRANSACTION)]);
			});

			it('signAndSendTransactions resolves the transaction signatures', async () => {
				const signatures = await context.link.transact(context.config, (wallet) =>
					wallet.signAndSendTransactions({
						payloads: [TRANSACTION],
					}),
				);
				expect(signatures).toEqual([context.expected.transactionSignature(TRANSACTION)]);
			});
		});

		describe('errors', () => {
			it('rejects with association-failed when no wallet completes association', async () => {
				context.scriptUnresponsiveWallet();
				const error = await context.link
					.transact({ ...context.config, associationTimeoutMs: 100 }, () => Promise.resolve())
					.then(
						() => {
							throw new Error('transact resolved unexpectedly');
						},
						(e: unknown) => e,
					);
				expect(error).toBeInstanceOf(SeekerConnectError);
				expect((error as SeekerConnectError).code).toBe(SeekerConnectErrorCode.associationFailed);
			});

			it('rejects with authorization-declined when the user declines', async () => {
				context.scriptAuthorizeDecline();
				const error = await context.link
					.transact(context.config, (wallet) => wallet.authorize())
					.then(
						() => {
							throw new Error('authorize resolved unexpectedly');
						},
						(e: unknown) => e,
					);
				expect(error).toBeInstanceOf(SeekerConnectError);
				expect((error as SeekerConnectError).code).toBe(SeekerConnectErrorCode.authorizationDeclined);
				expect(context.observed.openSessions()).toBe(0);
			});
		});
	});
}
