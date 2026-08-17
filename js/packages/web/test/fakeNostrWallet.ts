/**
 * In-process fake wallet: stands in for the browser (`window`/`navigator`
 * stubs), the relay (a fake global `WebSocket`), and the wallet endpoint,
 * so the real dapp-side library runs unmocked in node. Session/crypto/RPC
 * behavior lives in `fakeWalletCore.ts`. Supports any number of sequential
 * sessions, since the dapp establishes a fresh session per interaction.
 * Node-only.
 */
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import type {
	AssociationInfo,
	FakeWalletCapabilities,
	FakeWalletScript,
	JsonRpcRequest,
	NostrEvent,
} from './fakeWalletCore.js';
import {
	FakeWalletResponder,
	fromBase64,
	parseAssociationUrl,
	signNostrEvent,
	toBase64,
	verifyNostrEvent,
	WalletSessionCrypto,
} from './fakeWalletCore.js';

export {
	DEFAULT_FAKE_CAPABILITIES,
	fakeSignature,
	fakeSignedPayload,
	type FakeWalletCapabilities,
	type FakeWalletScript,
} from './fakeWalletCore.js';

const ASSOCIATION_PATH_SUFFIX = '/v1/associate/local/nostr';

type Listener = (evt: unknown) => void;

class FakeRelaySocket {
	static onCreated: ((socket: FakeRelaySocket) => void) | undefined;
	static onSend: ((socket: FakeRelaySocket, data: string) => void) | undefined;
	static onClosed: ((socket: FakeRelaySocket) => void) | undefined;

	readonly url: string;
	#listeners = new Map<string, Set<Listener>>();

	constructor(url: string | URL) {
		this.url = String(url);
		FakeRelaySocket.onCreated?.(this);
		// Listeners attach synchronously right after construction; open on the
		// next macrotask so none are missed.
		setTimeout(() => this.dispatch('open', {}), 0);
	}

	addEventListener(type: string, listener: Listener): void {
		let set = this.#listeners.get(type);
		if (!set) this.#listeners.set(type, (set = new Set()));
		set.add(listener);
	}

	removeEventListener(type: string, listener: Listener): void {
		this.#listeners.get(type)?.delete(listener);
	}

	send(data: string): void {
		FakeRelaySocket.onSend?.(this, data);
	}

	close(): void {
		FakeRelaySocket.onClosed?.(this);
		setTimeout(
			() =>
				this.dispatch('close', {
					wasClean: true,
					code: 1000,
					reason: '',
				}),
			0,
		);
	}

	dispatch(type: string, evt: unknown): void {
		for (const listener of [...(this.#listeners.get(type) ?? [])]) {
			listener(evt);
		}
	}
}

/** One relay connection's worth of wallet-side session state. */
interface WalletSession {
	socket: FakeRelaySocket;
	subscriptionId?: string;
	crypto?: WalletSessionCrypto;
	established: boolean;
	closed: boolean;
}

export class FakeNostrWallet {
	readonly #responder: FakeWalletResponder;

	/** Every URL the "browser" was navigated to (association URLs). */
	readonly launchedUrls: URL[] = [];
	/** Wallet-side protocol violations (non-empty fails the test). */
	readonly errors: string[] = [];
	sessionEndReceived = false;

	#nostrPrivateKey = schnorr.utils.randomSecretKey();
	#sessions: WalletSession[] = [];
	#association: AssociationInfo | undefined;
	#savedGlobals: Map<string, PropertyDescriptor | undefined> | undefined;

	constructor(script: FakeWalletScript = {}) {
		this.#responder = new FakeWalletResponder(script);
	}

	get script(): FakeWalletResponder['script'] {
		return this.#responder.script;
	}

	get capabilities(): FakeWalletCapabilities {
		return this.#responder.capabilities;
	}

	/** Decrypted JSON-RPC requests the wallet received, in order. */
	get requests(): FakeWalletResponder['requests'] {
		return this.#responder.requests;
	}

	/** Auth tokens the dapp deauthorized. */
	get deauthorizedTokens(): readonly string[] {
		return this.#responder.deauthorizedTokens;
	}

	get authorizeRequests(): FakeWalletResponder['authorizeRequests'] {
		return this.#responder.authorizeRequests;
	}

	/** Sessions that completed the encrypted handshake, including closed ones. */
	get sessionsEstablished(): number {
		return this.#sessions.filter((s) => s.established).length;
	}

	/** Sessions that completed the handshake and have not ended. */
	get openSessions(): number {
		return this.#sessions.filter((s) => s.established && !s.closed).length;
	}

	/**
	 * The wallet base URI each launch targeted: the association URL's prefix
	 * for an endpoint-specific https launch, undefined for the generic
	 * `solana-wallet:` scheme.
	 */
	get targetedBaseUris(): readonly (string | undefined)[] {
		return this.launchedUrls.map((url) => {
			if (url.protocol !== 'https:') return undefined;
			return url.origin + url.pathname.slice(0, -ASSOCIATION_PATH_SUFFIX.length);
		});
	}

	/** Stub `window`/`navigator`/`WebSocket` so the real dapp library runs in node. */
	install(): void {
		// Node's own `navigator`/`WebSocket` globals are getter-only accessors;
		// save and restore them as property descriptors, not values.
		this.#savedGlobals = new Map(
			['window', 'navigator', 'WebSocket'].map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]),
		);
		const define = (key: string, value: unknown) =>
			Object.defineProperty(globalThis, key, {
				value,
				configurable: true,
				writable: true,
			});
		const windowListeners = new Map<string, Set<Listener>>();
		define('window', {
			isSecureContext: true,
			setTimeout: setTimeout.bind(globalThis),
			clearTimeout: clearTimeout.bind(globalThis),
			addEventListener(type: string, listener: Listener) {
				let set = windowListeners.get(type);
				if (!set) windowListeners.set(type, (set = new Set()));
				set.add(listener);
			},
			removeEventListener(type: string, listener: Listener) {
				windowListeners.get(type)?.delete(listener);
			},
			location: {
				assign: (url: string | URL) => {
					const parsed = new URL(String(url));
					this.launchedUrls.push(parsed);
					this.#association = parseAssociationUrl(parsed) ?? this.#association;
					// The dapp detects the wallet launch via window blur.
					setTimeout(() => {
						for (const l of [...(windowListeners.get('blur') ?? [])]) l({});
					}, 0);
				},
			},
		});
		define('navigator', { userAgent: 'FakeBrowser/1.0' });
		FakeRelaySocket.onCreated = (socket) => {
			this.#sessions.push({ socket, established: false, closed: false });
		};
		FakeRelaySocket.onClosed = (socket) => {
			const session = this.#sessionFor(socket);
			if (session) session.closed = true;
		};
		FakeRelaySocket.onSend = (socket, data) => {
			void this.#onDappMessage(socket, data).catch((e) => {
				this.#fail(socket, e instanceof Error ? e.message : String(e));
			});
		};
		define('WebSocket', FakeRelaySocket);
	}

	uninstall(): void {
		for (const [key, descriptor] of this.#savedGlobals ?? []) {
			if (descriptor) {
				Object.defineProperty(globalThis, key, descriptor);
			} else {
				delete (globalThis as Record<string, unknown>)[key];
			}
		}
		FakeRelaySocket.onCreated = undefined;
		FakeRelaySocket.onSend = undefined;
		FakeRelaySocket.onClosed = undefined;
	}

	#sessionFor(socket: FakeRelaySocket): WalletSession | undefined {
		return this.#sessions.find((s) => s.socket === socket);
	}

	/** Terminate the session abnormally so failing tests reject fast. */
	#fail(socket: FakeRelaySocket, message: string): void {
		this.errors.push(message);
		socket.dispatch('close', {
			wasClean: false,
			code: 4000,
			reason: `fake wallet: ${message}`,
		});
	}

	async #onDappMessage(socket: FakeRelaySocket, data: string): Promise<void> {
		const session = this.#sessionFor(socket);
		if (!session) return;
		const message = JSON.parse(data) as unknown[];
		if (message[0] === 'REQ') {
			session.subscriptionId = message[1] as string;
			if (!this.#association) {
				return this.#fail(socket, 'REQ before any association URL was launched');
			}
			if (this.script.unresponsive) return;
			// An empty event announces the wallet and prompts the dapp's HELLO_REQ.
			this.#sendToDapp(session, '');
			return;
		}
		if (message[0] !== 'EVENT') return;
		const event = message[1] as NostrEvent;
		if (event.pubkey === bytesToHex(schnorr.getPublicKey(this.#nostrPrivateKey))) {
			return; // relay echo of our own event
		}
		if (!verifyNostrEvent(event)) {
			return this.#fail(socket, 'dapp sent an invalidly-signed Nostr event');
		}
		if (event.tags.some(([k, v]) => k === 'msg' && v === 'SESSION_END')) {
			this.sessionEndReceived = true;
			session.closed = true;
			return;
		}
		if (this.script.unresponsive) return;
		if (!session.crypto?.established) {
			session.crypto = new WalletSessionCrypto(this.#association!.associationPublicKey);
			const helloRsp = await session.crypto.handleHelloReq(fromBase64(event.content));
			if (!helloRsp) {
				return this.#fail(socket, 'HELLO_REQ signature does not verify');
			}
			session.established = true;
			this.#sendToDapp(session, toBase64(helloRsp));
		} else {
			const request = JSON.parse(await session.crypto.decrypt(fromBase64(event.content))) as JsonRpcRequest;
			const body = this.#responder.handle(request);
			this.#sendToDapp(
				session,
				toBase64(
					await session.crypto.encrypt(
						JSON.stringify({
							id: request.id,
							jsonrpc: '2.0',
							...body,
						}),
					),
				),
			);
		}
	}

	#sendToDapp(session: WalletSession, content: string): void {
		const event = signNostrEvent(
			content,
			[
				['d', this.#association!.sessionIdentifier],
				['p', this.#association!.dappNostrPubkey],
			],
			this.#nostrPrivateKey,
		);
		// Deliver on a fresh macrotask: the dapp completes its state transition
		// after send() returns, so a synchronous reply would arrive too early.
		setTimeout(() => {
			session.socket.dispatch('message', {
				data: JSON.stringify(['EVENT', session.subscriptionId, event]),
			});
		}, 0);
	}
}
