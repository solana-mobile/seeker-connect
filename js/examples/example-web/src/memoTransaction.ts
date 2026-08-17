/**
 * Builds an unsigned legacy Solana transaction carrying one Memo program
 * instruction, serialized to the wire format wallets sign. Hand-rolled to
 * keep this example free of heavyweight SDK dependencies.
 */
import { base58Decode } from './base58.js';
import { rpcUrl } from './config.js';

const MEMO_PROGRAM_ID = base58Decode('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

/** Solana shortvec: little-endian base-128 varint. */
function shortvec(length: number): number[] {
	const out: number[] = [];
	let remaining = length;
	for (;;) {
		const byte = remaining & 0x7f;
		remaining >>= 7;
		if (remaining === 0) {
			out.push(byte);
			return out;
		}
		out.push(byte | 0x80);
	}
}

export function buildMemoTransaction(feePayer: Uint8Array, recentBlockhash: Uint8Array, memo: string): Uint8Array {
	const data = new TextEncoder().encode(memo);
	const message = [
		// Header: 1 required signature, 0 readonly signed, 1 readonly unsigned.
		1,
		0,
		1,
		...shortvec(2),
		...feePayer,
		...MEMO_PROGRAM_ID,
		...recentBlockhash,
		...shortvec(1),
		1, // program id index (memo program)
		...shortvec(0), // no instruction accounts
		...shortvec(data.length),
		...data,
	];
	// Unsigned transaction: signature count + zeroed signature placeholder.
	return Uint8Array.from([...shortvec(1), ...new Array(64).fill(0), ...message]);
}

/**
 * Latest blockhash from the configured RPC; falls back to a placeholder
 * (fine for fake-wallet tests, rejected by a real cluster) when the RPC is
 * unreachable.
 */
export async function fetchRecentBlockhash(): Promise<{
	blockhash: Uint8Array;
	placeholder: boolean;
}> {
	try {
		const response = await fetch(rpcUrl, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'getLatestBlockhash',
			}),
			signal: AbortSignal.timeout(4000),
		});
		const body = (await response.json()) as {
			result?: { value?: { blockhash?: string } };
		};
		const blockhash = body.result?.value?.blockhash;
		if (blockhash) {
			return { blockhash: base58Decode(blockhash), placeholder: false };
		}
	} catch {
		// Fall through to the placeholder.
	}
	return { blockhash: new Uint8Array(32).fill(1), placeholder: true };
}
