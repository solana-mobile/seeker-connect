/** React binding for the Wallet Standard registry (no wallet-adapter). */
import { getWallets } from '@wallet-standard/app';
import type { Wallet } from '@wallet-standard/base';
import { useSyncExternalStore } from 'react';

const { get, on } = getWallets();

let snapshot: readonly Wallet[] = get();

function subscribe(callback: () => void): () => void {
	// Catch up on wallets registered between module evaluation and mount.
	snapshot = get();
	const offs = [
		on('register', () => {
			snapshot = get();
			callback();
		}),
		on('unregister', () => {
			snapshot = get();
			callback();
		}),
	];
	return () => offs.forEach((off) => off());
}

export function useWallets(): readonly Wallet[] {
	return useSyncExternalStore(subscribe, () => snapshot);
}
