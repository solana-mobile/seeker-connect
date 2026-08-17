/**
 * Wallet-side MWA-over-Nostr building blocks shared by the in-process test
 * harness (`fakeNostrWallet.ts`) and the E2E harness's real-relay wallet.
 * Implemented from the MWA spec (spec.md §"Nostr") using WebCrypto and
 * `@noble/*` only — zero imports from the code under test. Node-only.
 */
import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

export const NOSTR_EVENT_KIND_MWA = 20012;
const ENCODED_P256_PUBLIC_KEY_BYTES = 65;
const SEQUENCE_NUMBER_BYTES = 4;
const IV_BYTES = 12;

export interface NostrEvent {
	id: string;
	pubkey: string;
	created_at: number;
	kind: number;
	tags: string[][];
	content: string;
	sig: string;
}

/** `get_capabilities` response body, wire-shaped. */
export interface FakeWalletCapabilities {
	max_transactions_per_request: number;
	max_messages_per_request: number;
	supported_transaction_versions: (string | number)[];
	features: string[];
	supports_clone_authorization: boolean;
	supports_sign_and_send_transactions: boolean;
}

export const DEFAULT_FAKE_CAPABILITIES: FakeWalletCapabilities = {
	max_transactions_per_request: 10,
	max_messages_per_request: 10,
	supported_transaction_versions: ['legacy', 0],
	features: ['solana:signTransactions', 'solana:signInWithSolana'],
	supports_clone_authorization: false,
	supports_sign_and_send_transactions: true,
};

export interface FakeWalletScript {
	/** Public keys the wallet authorizes (raw bytes; wire-encoded as base64). */
	accounts?: { publicKey: Uint8Array; label?: string }[];
	authToken?: string;
	/** Endpoint-specific base URI the wallet hands out; null to omit. */
	walletUriBase?: string | null;
	/** When set, `authorize` fails with this JSON-RPC error instead. */
	authorizeError?: { code: number; message: string };
	capabilities?: Partial<FakeWalletCapabilities>;
	/** When set, the wallet never announces itself, so association hangs. */
	unresponsive?: boolean;
}

/** The deterministic 64-byte "signature" the fake produces for a payload. */
export function fakeSignature(payload: Uint8Array): Uint8Array {
	const digest = sha256(payload);
	return concatBytes(digest, digest);
}

/** The deterministic signed form of a payload: payload ‖ signature. */
export function fakeSignedPayload(payload: Uint8Array): Uint8Array {
	return concatBytes(payload, fakeSignature(payload));
}

export interface JsonRpcRequest {
	id: number;
	jsonrpc: '2.0';
	method: string;
	params: Record<string, unknown>;
}

export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
	const total = arrays.reduce((n, a) => n + a.length, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const a of arrays) {
		out.set(a, offset);
		offset += a.length;
	}
	return out;
}

export function toBase64(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString('base64');
}

export function fromBase64(base64: string): Uint8Array {
	return new Uint8Array(Buffer.from(base64, 'base64'));
}

/** Reverse of MWA's URL-safe base64 replacement ('/'→'_', '+'→'-', '='→'.'). */
function fromUrlSafeBase64(urlSafe: string): Uint8Array {
	return fromBase64(urlSafe.replace(/[_\-.]/g, (m) => ({ _: '/', '-': '+', '.': '=' })[m]!));
}

function sequenceNumberVector(sequenceNumber: number): Uint8Array {
	const vector = new Uint8Array(SEQUENCE_NUMBER_BYTES);
	new DataView(vector.buffer).setUint32(0, sequenceNumber, false);
	return vector;
}

/** Ephemeral wallet-side Nostr identity. */
export function generateNostrIdentity(): {
	privateKey: Uint8Array;
	pubkeyHex: string;
} {
	const privateKey = schnorr.utils.randomSecretKey();
	return {
		privateKey,
		pubkeyHex: bytesToHex(schnorr.getPublicKey(privateKey)),
	};
}

/** NIP-01 event signing. */
export function signNostrEvent(content: string, tags: string[][], privateKey: Uint8Array): NostrEvent {
	const pubkey = bytesToHex(schnorr.getPublicKey(privateKey));
	const created_at = Math.floor(Date.now() / 1000);
	const serialized = JSON.stringify([0, pubkey, created_at, NOSTR_EVENT_KIND_MWA, tags, content]);
	const id = bytesToHex(sha256(new TextEncoder().encode(serialized)));
	const sig = bytesToHex(schnorr.sign(hexToBytes(id), privateKey));
	return {
		id,
		pubkey,
		created_at,
		kind: NOSTR_EVENT_KIND_MWA,
		tags,
		content,
		sig,
	};
}

export function verifyNostrEvent(event: NostrEvent): boolean {
	const serialized = JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]);
	const expectedId = bytesToHex(sha256(new TextEncoder().encode(serialized)));
	if (expectedId !== event.id) return false;
	try {
		return schnorr.verify(hexToBytes(event.sig), hexToBytes(event.id), hexToBytes(event.pubkey));
	} catch {
		return false;
	}
}

export interface AssociationInfo {
	associationPublicKey: Uint8Array;
	dappNostrPubkey: string;
	/** Hex SHA-256 of the association public key (the `d` tag). */
	sessionIdentifier: string;
	relayDomain: string | null;
}

/** Extracts the wallet-relevant parts of a Nostr association URL. */
export function parseAssociationUrl(url: URL): AssociationInfo | undefined {
	const association = url.searchParams.get('association');
	const pubkey = url.searchParams.get('pubkey');
	if (!association || !pubkey) return undefined; // not a Nostr association URL
	const associationPublicKey = fromUrlSafeBase64(association);
	return {
		associationPublicKey,
		dappNostrPubkey: pubkey,
		sessionIdentifier: bytesToHex(sha256(associationPublicKey)),
		relayDomain: url.searchParams.get('relay'),
	};
}

/**
 * One session's worth of wallet-side handshake and payload crypto:
 * HELLO_REQ verification, ECDH → HKDF-SHA256 → AES-128-GCM (spec §"Session
 * establishment"), and sequence-numbered encrypt/decrypt.
 */
export class WalletSessionCrypto {
	readonly #associationPublicKey: Uint8Array;
	#sharedKey: CryptoKey | undefined;
	#outboundSequenceNumber = 0;

	constructor(associationPublicKey: Uint8Array) {
		this.#associationPublicKey = associationPublicKey;
	}

	get established(): boolean {
		return this.#sharedKey !== undefined;
	}

	/**
	 * Verifies HELLO_REQ (the dapp's ephemeral ECDH public key signed with
	 * the association key) and derives the session key. Resolves the
	 * HELLO_RSP bytes to send back, or undefined when verification fails.
	 */
	async handleHelloReq(helloReq: Uint8Array): Promise<Uint8Array | undefined> {
		const dappEcdhPublicKeyBytes = helloReq.subarray(0, ENCODED_P256_PUBLIC_KEY_BYTES);
		const signature = helloReq.subarray(ENCODED_P256_PUBLIC_KEY_BYTES);
		const associationKey = await crypto.subtle.importKey(
			'raw',
			this.#associationPublicKey as BufferSource,
			{ name: 'ECDSA', namedCurve: 'P-256' },
			false,
			['verify'],
		);
		const signatureValid = await crypto.subtle.verify(
			{ name: 'ECDSA', hash: 'SHA-256' },
			associationKey,
			signature as BufferSource,
			dappEcdhPublicKeyBytes as BufferSource,
		);
		if (!signatureValid) return undefined;
		const dappEcdhPublicKey = await crypto.subtle.importKey(
			'raw',
			dappEcdhPublicKeyBytes as BufferSource,
			{ name: 'ECDH', namedCurve: 'P-256' },
			false,
			[],
		);
		const walletEcdhKeypair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, [
			'deriveBits',
		]);
		const sharedBits = await crypto.subtle.deriveBits(
			{ name: 'ECDH', public: dappEcdhPublicKey },
			walletEcdhKeypair.privateKey,
			256,
		);
		const hkdfKey = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
		this.#sharedKey = await crypto.subtle.deriveKey(
			{
				name: 'HKDF',
				hash: 'SHA-256',
				salt: this.#associationPublicKey as BufferSource,
				info: new Uint8Array(),
			},
			hkdfKey,
			{ name: 'AES-GCM', length: 128 },
			false,
			['encrypt', 'decrypt'],
		);
		const walletEcdhPublicKeyBytes = new Uint8Array(
			await crypto.subtle.exportKey('raw', walletEcdhKeypair.publicKey),
		);
		const encryptedSessionProps = await this.encrypt(JSON.stringify({ v: 'v1' }));
		return concatBytes(walletEcdhPublicKeyBytes, encryptedSessionProps);
	}

	async encrypt(plaintext: string): Promise<Uint8Array> {
		const seqVector = sequenceNumberVector(++this.#outboundSequenceNumber);
		const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
		const ciphertext = new Uint8Array(
			await crypto.subtle.encrypt(
				{
					name: 'AES-GCM',
					iv: iv as BufferSource,
					additionalData: seqVector as BufferSource,
					tagLength: 128,
				},
				this.#sharedKey!,
				new TextEncoder().encode(plaintext) as BufferSource,
			),
		);
		return concatBytes(seqVector, iv, ciphertext);
	}

	async decrypt(message: Uint8Array): Promise<string> {
		const seqVector = message.subarray(0, SEQUENCE_NUMBER_BYTES);
		const iv = message.subarray(SEQUENCE_NUMBER_BYTES, SEQUENCE_NUMBER_BYTES + IV_BYTES);
		const ciphertext = message.subarray(SEQUENCE_NUMBER_BYTES + IV_BYTES);
		const plaintext = await crypto.subtle.decrypt(
			{
				name: 'AES-GCM',
				iv: iv as BufferSource,
				additionalData: seqVector as BufferSource,
				tagLength: 128,
			},
			this.#sharedKey!,
			ciphertext as BufferSource,
		);
		return new TextDecoder().decode(plaintext);
	}
}

/**
 * Scripted wallet-endpoint behavior: turns decrypted JSON-RPC requests
 * into response bodies and records what it saw.
 */
export class FakeWalletResponder {
	readonly script: FakeWalletScript & {
		accounts: { publicKey: Uint8Array; label?: string }[];
		authToken: string;
		walletUriBase: string | null;
	};

	/** Decrypted JSON-RPC requests received, in order. */
	readonly requests: { method: string; params: Record<string, unknown> }[] = [];
	/** Auth tokens the dapp deauthorized. */
	readonly deauthorizedTokens: string[] = [];

	constructor(script: FakeWalletScript = {}) {
		this.script = {
			...script,
			accounts: script.accounts ?? [
				{
					publicKey: Uint8Array.of(1, 2, 3, 4, 5),
					label: 'Fake Account',
				},
			],
			authToken: script.authToken ?? 'FAKE_AUTH_TOKEN',
			walletUriBase: script.walletUriBase === undefined ? 'https://fakewallet.example.com' : script.walletUriBase,
		};
	}

	get capabilities(): FakeWalletCapabilities {
		return { ...DEFAULT_FAKE_CAPABILITIES, ...this.script.capabilities };
	}

	get authorizeRequests(): readonly {
		authToken?: string;
		chain?: string;
		hasSignInPayload: boolean;
	}[] {
		return this.requests
			.filter((r) => r.method === 'authorize')
			.map((r) => ({
				authToken: r.params.auth_token as string | undefined,
				chain: r.params.chain as string | undefined,
				hasSignInPayload: r.params.sign_in_payload !== undefined,
			}));
	}

	/** Handles one decrypted request, resolving the JSON-RPC response body. */
	handle(request: JsonRpcRequest): Record<string, unknown> {
		this.requests.push({ method: request.method, params: request.params });
		switch (request.method) {
			case 'authorize': {
				if (this.script.authorizeError) {
					return { error: this.script.authorizeError };
				}
				const requestToken = request.params.auth_token as string | undefined;
				if (requestToken !== undefined && requestToken !== this.script.authToken) {
					return {
						error: {
							code: -1,
							message: 'auth_token not valid for this wallet',
						},
					};
				}
				const signInPayload = request.params.sign_in_payload;
				return {
					result: {
						accounts: this.script.accounts.map((account) => ({
							address: toBase64(account.publicKey),
							label: account.label,
						})),
						auth_token: this.script.authToken,
						...(this.script.walletUriBase === null ? {} : { wallet_uri_base: this.script.walletUriBase }),
						...(signInPayload !== undefined ? { sign_in_result: this.#signIn(signInPayload) } : {}),
					},
				};
			}
			case 'deauthorize': {
				this.deauthorizedTokens.push(request.params.auth_token as string);
				return { result: {} };
			}
			case 'get_capabilities': {
				return { result: this.capabilities };
			}
			case 'sign_messages': {
				const addresses = request.params.addresses as string[];
				const known = this.script.accounts.map((a) => toBase64(a.publicKey));
				if (!addresses.every((address) => known.includes(address))) {
					return {
						error: { code: -2, message: 'unknown signing address' },
					};
				}
				return {
					result: {
						signed_payloads: (request.params.payloads as string[]).map((payload) =>
							toBase64(fakeSignedPayload(fromBase64(payload))),
						),
					},
				};
			}
			case 'sign_transactions': {
				return {
					result: {
						signed_payloads: (request.params.payloads as string[]).map((payload) =>
							toBase64(fakeSignedPayload(fromBase64(payload))),
						),
					},
				};
			}
			case 'sign_and_send_transactions': {
				return {
					result: {
						signatures: (request.params.payloads as string[]).map((payload) =>
							toBase64(fakeSignature(fromBase64(payload))),
						),
					},
				};
			}
			default:
				return {
					error: {
						code: -32601,
						message: `Method not found: ${request.method}`,
					},
				};
		}
	}

	/** The wallet's sign-in proof: it signs the serialized payload bytes. */
	#signIn(payload: unknown): Record<string, string> {
		const [account] = this.script.accounts;
		const signedMessage = new TextEncoder().encode(JSON.stringify(payload));
		return {
			address: toBase64(account!.publicKey),
			signed_message: toBase64(signedMessage),
			signature: toBase64(fakeSignature(signedMessage)),
		};
	}
}
