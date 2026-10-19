import {
	type Address,
	AccountRole,
	address,
	appendTransactionMessageInstruction,
	compileTransaction,
	createSolanaRpc,
	createTransactionMessage,
	getBase58Decoder,
	getTransactionEncoder,
	getUtf8Encoder,
	pipe,
	setTransactionMessageFeePayer,
	setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit';
import {
	SeekerConnect,
	SeekerConnectButton,
	SeekerConnectError,
	type SeekerConnectConfig,
} from '@solana-mobile/seeker-connect-react-native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

const CONFIG: SeekerConnectConfig = {
	identity: { name: 'Seeker Connect Example', uri: 'https://solanamobile.com', icon: 'favicon.ico' },
	chain: 'solana:devnet',
};
const MESSAGE = 'Hello from the example';
const MEMO = 'Seeker Connect example';
const MEMO_PROGRAM = address('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const rpc = createSolanaRpc('https://api.devnet.solana.com');

/** An unsigned transaction carrying one memo instruction, signed by [feePayer], in wire format. */
async function memoTransaction(feePayer: Address): Promise<Uint8Array> {
	const { value: blockhash } = await rpc.getLatestBlockhash().send();
	const message = pipe(
		createTransactionMessage({ version: 'legacy' }),
		(m) => setTransactionMessageFeePayer(feePayer, m),
		(m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
		(m) =>
			appendTransactionMessageInstruction(
				{
					programAddress: MEMO_PROGRAM,
					accounts: [{ address: feePayer, role: AccountRole.WRITABLE_SIGNER }],
					data: getUtf8Encoder().encode(MEMO),
				},
				m,
			),
	);
	return new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
}

function describe(error: unknown): string {
	if (error instanceof SeekerConnectError) return error.code;
	return error instanceof Error ? error.message : String(error);
}

export default function App() {
	return (
		<SafeAreaProvider>
			<ExampleScreen />
		</SafeAreaProvider>
	);
}

function ExampleScreen() {
	const darkTheme = useColorScheme() === 'dark';
	const colors = {
		background: darkTheme ? '#0D1615' : '#FFFFFF',
		foreground: darkTheme ? '#FFFFFF' : '#000000',
		muted: darkTheme ? 'rgba(255, 255, 255, 0.6)' : 'rgba(0, 0, 0, 0.6)',
	};

	/** The connected account; null while disconnected. */
	const [account, setAccount] = useState<Address | null>(null);
	const [busy, setBusy] = useState(false);
	/** False until configure and restore have settled; wallet actions wait for it. */
	const [ready, setReady] = useState(false);
	/** Results of past actions, oldest first. */
	const [log, setLog] = useState<string[]>([]);
	const running = useRef(false);

	const append = useCallback((line: string) => setLog((lines) => [...lines, line]), []);

	useEffect(() => {
		(async () => {
			try {
				await SeekerConnect.configure(CONFIG);
			} catch (error) {
				// Unconfigured, every wallet action would fail: leave them disabled.
				append(`configure failed: ${describe(error)}`);
				return;
			}
			try {
				const restored = await SeekerConnect.restore();
				if (restored) {
					setAccount(address(restored.accounts[0].address));
					append(`restored ${restored.accounts[0].address}`);
				}
			} catch (error) {
				append(`restore failed: ${describe(error)}`);
			}
			setReady(true);
		})();
	}, [append]);

	/** Runs [action] unless another action is running. */
	const run = useCallback(
		(name: string, action: () => Promise<string>) => {
			if (running.current) return;
			running.current = true;
			setBusy(true);
			action()
				.then(
					(result) => append(`${name}: ${result}`),
					(error) => append(`${name} failed: ${describe(error)}`),
				)
				.finally(() => {
					running.current = false;
					setBusy(false);
				});
		},
		[append],
	);

	const connect = () =>
		run('connect', async () => {
			const authorization = await SeekerConnect.connect();
			setAccount(address(authorization.accounts[0].address));
			return authorization.accounts[0].address;
		});

	const signIn = () =>
		run('signIn', async () => {
			const result = await SeekerConnect.signIn({ statement: 'Sign in to the example' });
			setAccount(address(result.address));
			return result.address;
		});

	const signMessage = (signer: Address) =>
		run('signMessage', async () => {
			const [signed] = await SeekerConnect.signMessages(
				[signer],
				[new Uint8Array(getUtf8Encoder().encode(MESSAGE))],
			);
			return `${signed.length} bytes`;
		});

	const signTransaction = (feePayer: Address) =>
		run('signTransaction', async () => {
			const [signed] = await SeekerConnect.signTransactions([await memoTransaction(feePayer)]);
			return `${signed.length} bytes`;
		});

	const signAndSend = (feePayer: Address) =>
		run('signAndSendTransaction', async () => {
			const [signature] = await SeekerConnect.signAndSendTransactions([await memoTransaction(feePayer)]);
			return getBase58Decoder().decode(signature);
		});

	const disconnect = () =>
		run('disconnect', async () => {
			await SeekerConnect.disconnect();
			setAccount(null);
			return 'done';
		});

	const theme = darkTheme ? 'dark' : 'light';
	const action = (label: string, onPress: () => void) => (
		<Pressable
			key={label}
			disabled={busy || !ready}
			onPress={onPress}
			style={[styles.action, { borderColor: colors.foreground }, (busy || !ready) && styles.disabled]}
		>
			<Text style={[styles.actionLabel, { color: colors.foreground }]}>{label}</Text>
		</Pressable>
	);

	return (
		<SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
			<ScrollView contentContainerStyle={styles.content}>
				<View>
					<Text style={[styles.title, { color: colors.foreground }]}>Seeker Connect</Text>
					<Text style={[styles.subtitle, { color: colors.muted }]}>Example dapp</Text>
				</View>
				{account === null ? (
					<>
						<SeekerConnectButton
							style={styles.seekerButton}
							theme={theme}
							enabled={!busy && ready}
							onPress={connect}
						/>
						<SeekerConnectButton
							style={styles.seekerButton}
							variant="sign-in"
							theme={theme}
							enabled={!busy && ready}
							onPress={signIn}
						/>
					</>
				) : (
					<>
						<Text style={[styles.label, { color: colors.muted }]}>CONNECTED AS</Text>
						<Text style={[styles.mono, { color: colors.foreground }]}>{account}</Text>
						{action('Sign message', () => signMessage(account))}
						{action('Sign transaction', () => signTransaction(account))}
						{action('Sign and send transaction', () => signAndSend(account))}
						{action('Sign in', signIn)}
						{action('Disconnect', disconnect)}
					</>
				)}
				<Text style={[styles.label, { color: colors.muted }]}>ACTIVITY</Text>
				{log.length === 0 ? (
					<Text style={[styles.subtitle, { color: colors.muted }]}>No activity yet.</Text>
				) : (
					log.map((line, index) => (
						<Text key={index} style={[styles.mono, { color: colors.muted }]}>
							{`${index + 1}. ${line}`}
						</Text>
					))
				)}
			</ScrollView>
		</SafeAreaView>
	);
}

const styles = StyleSheet.create({
	action: {
		alignItems: 'center',
		borderRadius: 20,
		borderWidth: 1,
		height: 40,
		justifyContent: 'center',
	},
	actionLabel: {
		fontSize: 14,
		fontWeight: '500',
	},
	content: {
		gap: 12,
		padding: 24,
	},
	disabled: {
		opacity: 0.4,
	},
	label: {
		fontSize: 13,
		fontWeight: '500',
		letterSpacing: 1,
	},
	mono: {
		fontFamily: 'monospace',
		fontSize: 13,
	},
	screen: {
		flex: 1,
	},
	seekerButton: {
		alignSelf: 'stretch',
		height: 56,
	},
	subtitle: {
		fontSize: 13,
	},
	title: {
		fontSize: 22,
		fontWeight: '500',
	},
});
