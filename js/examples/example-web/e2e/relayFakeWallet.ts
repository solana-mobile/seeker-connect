/**
 * Fake wallet endpoint speaking MWA-over-Nostr through a real relay, for
 * the browser E2E harness. Session/crypto/RPC behavior is shared with the
 * unit-test harness via `@solana-mobile/seeker-connect-web`'s `fakeWalletCore`. Node-only
 * (uses node's global WebSocket).
 */
import type { FakeWalletScript, JsonRpcRequest, NostrEvent } from '../../../packages/web/test/fakeWalletCore.ts';
import {
	FakeWalletResponder,
	fromBase64,
	generateNostrIdentity,
	NOSTR_EVENT_KIND_MWA,
	parseAssociationUrl,
	signNostrEvent,
	toBase64,
	verifyNostrEvent,
	WalletSessionCrypto,
} from '../../../packages/web/test/fakeWalletCore.ts';

/**
 * A real wallet app needs time to start before it reaches the relay; here
 * the delay instead covers the dapp finishing wallet-launch detection and
 * subscribing, since ephemeral (2xxxx-kind) events are not replayed to
 * late subscribers.
 */
const ANNOUNCE_DELAY_MS = 1_200;

export class RelayFakeWallet {
	readonly responder: FakeWalletResponder;
	readonly errors: string[] = [];
	readonly servedUrls: string[] = [];

	#identity = generateNostrIdentity();
	#sockets = new Set<WebSocket>();
	#finishers = new Set<() => void>();

	constructor(script: FakeWalletScript = {}) {
		this.responder = new FakeWalletResponder(script);
	}

	get script(): FakeWalletResponder['script'] {
		return this.responder.script;
	}

	/** Serves one association URL: one relay connection, one MWA session. */
	serveAssociation(associationUrl: string): void {
		this.servedUrls.push(associationUrl);
		if (this.script.unresponsive) return;
		const association = parseAssociationUrl(new URL(associationUrl));
		if (!association) {
			this.errors.push(`not an association URL: ${associationUrl}`);
			return;
		}
		const relayDomain = association.relayDomain;
		if (!relayDomain) {
			this.errors.push(`association URL without relay: ${associationUrl}`);
			return;
		}

		const socket = new WebSocket(`wss://${relayDomain}`);
		this.#sockets.add(socket);
		// Errors after the session ends (SESSION_END, harness shutdown) are
		// teardown noise, not failures.
		let done = false;
		this.#finishers.add(() => {
			done = true;
		});
		const crypto = new WalletSessionCrypto(association.associationPublicKey);
		const walletPubkey = this.#identity.pubkeyHex;
		const publish = (content: string) => {
			const event = signNostrEvent(
				content,
				[
					['d', association.sessionIdentifier],
					['p', association.dappNostrPubkey],
				],
				this.#identity.privateKey,
			);
			socket.send(JSON.stringify(['EVENT', event]));
		};

		socket.onopen = () => {
			socket.send(
				JSON.stringify([
					'REQ',
					`fake-wallet-${association.sessionIdentifier.slice(0, 8)}`,
					{
						kinds: [NOSTR_EVENT_KIND_MWA],
						'#d': [association.sessionIdentifier],
					},
				]),
			);
			setTimeout(() => publish(''), ANNOUNCE_DELAY_MS);
		};
		socket.onerror = () => {
			if (!done) this.errors.push(`relay socket error for ${associationUrl}`);
		};
		socket.onmessage = (message) => {
			void (async () => {
				const parsed = JSON.parse(String(message.data)) as unknown[];
				if (parsed[0] !== 'EVENT') return;
				const event = parsed[2] as NostrEvent;
				if (event.pubkey === walletPubkey) return; // echo of our own event
				if (!verifyNostrEvent(event)) {
					this.errors.push('dapp sent an invalidly-signed Nostr event');
					return;
				}
				if (event.tags.some(([k, v]) => k === 'msg' && v === 'SESSION_END')) {
					done = true;
					socket.close();
					this.#sockets.delete(socket);
					return;
				}
				if (!crypto.established) {
					const helloRsp = await crypto.handleHelloReq(fromBase64(event.content));
					if (!helloRsp) {
						this.errors.push('HELLO_REQ signature does not verify');
						return;
					}
					publish(toBase64(helloRsp));
				} else {
					const request = JSON.parse(await crypto.decrypt(fromBase64(event.content))) as JsonRpcRequest;
					const body = this.responder.handle(request);
					publish(
						toBase64(
							await crypto.encrypt(
								JSON.stringify({
									id: request.id,
									jsonrpc: '2.0',
									...body,
								}),
							),
						),
					);
				}
			})().catch((e: unknown) => {
				this.errors.push(e instanceof Error ? e.message : String(e));
			});
		};
	}

	close(): void {
		for (const finish of this.#finishers) finish();
		this.#finishers.clear();
		for (const socket of this.#sockets) socket.close();
		this.#sockets.clear();
	}
}
