import { FOOTER_WORDMARK_PATHS, S_MARK_ARC_PATH, S_MARK_PATH } from '@skr-connect/ui';
import { SeekerConnectWalletName } from '@skr-connect/wallet-standard';
import type {
	SolanaSignAndSendTransactionFeature,
	SolanaSignInFeature,
	SolanaSignMessageFeature,
	SolanaSignTransactionFeature,
} from '@solana/wallet-standard-features';
import {
	SolanaSignAndSendTransaction,
	SolanaSignIn,
	SolanaSignMessage,
	SolanaSignTransaction,
} from '@solana/wallet-standard-features';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import type {
	StandardConnectFeature,
	StandardDisconnectFeature,
	StandardEventsFeature,
} from '@wallet-standard/features';
import { StandardConnect, StandardDisconnect, StandardEvents } from '@wallet-standard/features';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { base58Encode } from './base58.js';
import { config } from './config.js';
import { buildMemoTransaction, fetchRecentBlockhash } from './memoTransaction.js';
import { useWallets } from './useWallets.js';

type SeekerFeatures = StandardConnectFeature &
	StandardDisconnectFeature &
	StandardEventsFeature &
	SolanaSignMessageFeature &
	SolanaSignInFeature &
	Partial<SolanaSignTransactionFeature & SolanaSignAndSendTransactionFeature>;

function features(wallet: Wallet): SeekerFeatures {
	return wallet.features as SeekerFeatures;
}

/** The brand S-in-arc mark (vectors re-exported by `@skr-connect/ui`). */
function SeekerMark({ size }: { size: number }) {
	return (
		<svg viewBox="138 317 124 124" width={size} height={size} aria-hidden="true">
			<path d={S_MARK_PATH} fill="currentColor" />
			<path d={S_MARK_ARC_PATH} fill="none" stroke="currentColor" strokeWidth="3.99911" />
		</svg>
	);
}

function SolanaMobileWordmark() {
	return (
		<svg viewBox="140 671 120 10" width="120" height="10" aria-label="Solana Mobile">
			<g fill="#B4B4B4">
				{FOOTER_WORDMARK_PATHS.map((d) => (
					<path key={d.slice(0, 16)} d={d} />
				))}
			</g>
		</svg>
	);
}

export function App() {
	const wallets = useWallets();
	const seeker = useMemo(() => wallets.find((wallet) => wallet.name === SeekerConnectWalletName), [wallets]);

	const [accounts, setAccounts] = useState<readonly WalletAccount[]>([]);
	const [busy, setBusy] = useState(false);
	const [log, setLog] = useState<string[]>([]);

	const append = useCallback((line: string) => {
		setLog((current) => [...current, line]);
	}, []);

	// Track account changes announced by the wallet.
	useEffect(() => {
		if (!seeker) return;
		return features(seeker)[StandardEvents].on('change', (properties) => {
			if (properties.accounts) setAccounts(properties.accounts);
		});
	}, [seeker]);

	// Restore a previous session on load; never launches the wallet.
	useEffect(() => {
		if (!seeker) return;
		const connectFeature = features(seeker)[StandardConnect];
		void connectFeature.connect({ silent: true }).then(({ accounts: restored }) => {
			setAccounts(restored);
			if (restored.length) append('restored session from cache');
		});
	}, [seeker, append]);

	const run = useCallback(
		(label: string, action: () => Promise<string>) => {
			if (!seeker || busy) return;
			setBusy(true);
			void action()
				.then((outcome) => append(`${label} ✓ ${outcome}`))
				.catch((error: unknown) =>
					append(`${label} ✗ ${error instanceof Error ? error.message : String(error)}`),
				)
				.finally(() => setBusy(false));
		},
		[seeker, busy, append],
	);

	if (!seeker) {
		return (
			<main>
				<header>
					<h1>Seeker Connect</h1>
				</header>
				<p className="status" data-testid="wallet-status">
					Seeker Connect wallet not found.
				</p>
			</main>
		);
	}

	const account = accounts[0];
	const seekerFeatures = features(seeker);

	const signIn = () =>
		run('signIn', async () => {
			const [output] = await seekerFeatures[SolanaSignIn].signIn({
				domain: window.location.host,
				statement: 'Sign in to the Seeker Connect example',
			});
			return `address=${output!.account.address} sig=${base58Encode(output!.signature)}`;
		});

	return (
		<main>
			<header>
				<div className="mark">
					<SeekerMark size={44} />
				</div>
				<div>
					<h1>Seeker Connect</h1>
					<p className="subtitle">Example dapp</p>
				</div>
			</header>

			<p className="status" data-testid="wallet-status">
				Discovered {seeker.name} · {config.relayDomain} · {config.chain}
			</p>

			{!account ? (
				<div className="stack">
					<seeker-connect-button
						data-testid="connect"
						theme="dark"
						disabled={busy}
						onClick={() =>
							run('connect', async () => {
								const { accounts: connected } = await seekerFeatures[StandardConnect].connect();
								setAccounts(connected);
								return connected[0] ? `address=${connected[0].address}` : 'no accounts';
							})
						}
					></seeker-connect-button>
					<seeker-connect-button
						variant="sign-in"
						data-testid="sign-in"
						theme="dark"
						disabled={busy}
						onClick={signIn}
					></seeker-connect-button>
				</div>
			) : (
				<>
					<section className="card">
						<p className="label">Connected as</p>
						<code data-testid="account-address">{account.address}</code>
						<div className="actions">
							<button
								data-testid="sign-message"
								disabled={busy}
								onClick={() =>
									run('signMessage', async () => {
										const [output] = await seekerFeatures[SolanaSignMessage].signMessage({
											account,
											message: new TextEncoder().encode(
												`Hello from Seeker Connect at ${new Date().toISOString()}`,
											),
										});
										return `sig=${base58Encode(output!.signature)}`;
									})
								}
							>
								Sign Message
							</button>
							<button
								data-testid="sign-transaction"
								disabled={busy || !seekerFeatures[SolanaSignTransaction]}
								onClick={() =>
									run('signTransaction', async () => {
										const { blockhash, placeholder } = await fetchRecentBlockhash();
										const [output] = await seekerFeatures[SolanaSignTransaction]!.signTransaction({
											account,
											chain: config.chain,
											transaction: buildMemoTransaction(
												account.publicKey as Uint8Array,
												blockhash,
												'Seeker Connect example memo',
											),
										});
										return `signedTx=${output!.signedTransaction.length}B${
											placeholder ? ' (placeholder blockhash)' : ''
										}`;
									})
								}
							>
								Sign Transaction
							</button>
							<button
								data-testid="sign-and-send"
								disabled={busy || !seekerFeatures[SolanaSignAndSendTransaction]}
								onClick={() =>
									run('signAndSendTransaction', async () => {
										const { blockhash, placeholder } = await fetchRecentBlockhash();
										const [output] = await seekerFeatures[
											SolanaSignAndSendTransaction
										]!.signAndSendTransaction({
											account,
											chain: config.chain,
											transaction: buildMemoTransaction(
												account.publicKey as Uint8Array,
												blockhash,
												'Seeker Connect example memo',
											),
										});
										return `sig=${base58Encode(output!.signature)}${
											placeholder ? ' (placeholder blockhash)' : ''
										}`;
									})
								}
							>
								Sign &amp; Send
							</button>
							<button data-testid="sign-in" disabled={busy} onClick={signIn}>
								Sign In (SIWS)
							</button>
							<button
								className="quiet"
								data-testid="disconnect"
								disabled={busy}
								onClick={() =>
									run('disconnect', async () => {
										await seekerFeatures[StandardDisconnect].disconnect();
										setAccounts([]);
										return 'done';
									})
								}
							>
								Disconnect
							</button>
						</div>
					</section>
				</>
			)}

			<section className="card">
				<p className="label">Activity</p>
				<pre data-testid="log">
					{log.length ? log.map((line, i) => `${i + 1}. ${line}`).join('\n') : 'No activity yet.'}
				</pre>
			</section>

			<footer>
				<SolanaMobileWordmark />
			</footer>
		</main>
	);
}
