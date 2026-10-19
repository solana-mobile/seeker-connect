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
import { Button, ScrollView, StyleSheet, Text, View } from 'react-native';

const CONFIG: SeekerConnectConfig = {
	identity: { name: 'Seeker Connect Example', uri: 'https://solanamobile.com', icon: 'favicon.ico' },
	chain: 'solana:devnet',
};
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
	/** The connected account; null while disconnected. */
	const [account, setAccount] = useState<Address | null>(null);
	const [busy, setBusy] = useState(false);
	/** Results of past actions, newest last. */
	const [log, setLog] = useState<string[]>([]);
	const running = useRef(false);

	const append = useCallback((line: string) => setLog((lines) => [...lines, line]), []);

	useEffect(() => {
		(async () => {
			await SeekerConnect.configure(CONFIG);
			const restored = await SeekerConnect.restore();
			if (restored) {
				setAccount(address(restored.accounts[0].address));
				append(`restored ${restored.accounts[0].address}`);
			}
		})().catch((error) => append(`restore failed: ${describe(error)}`));
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

	const signAndSend = (feePayer: Address) =>
		run('signAndSendTransaction', async () => {
			const [signature] = await SeekerConnect.signAndSendTransactions([await memoTransaction(feePayer)]);
			return getBase58Decoder().decode(signature);
		});

	return (
		<View style={styles.screen}>
			{account === null ? (
				<>
					<SeekerConnectButton style={styles.seekerButton} enabled={!busy} onPress={connect} />
					<SeekerConnectButton
						style={styles.seekerButton}
						variant="sign-in"
						enabled={!busy}
						onPress={signIn}
					/>
				</>
			) : (
				<>
					<Text>Connected as {account}</Text>
					<Button title="Sign and send a memo" disabled={busy} onPress={() => signAndSend(account)} />
				</>
			)}
			<ScrollView style={styles.log}>
				{log.map((line, index) => (
					<Text key={index}>{line}</Text>
				))}
			</ScrollView>
		</View>
	);
}

const styles = StyleSheet.create({
	log: {
		flex: 1,
	},
	screen: {
		flex: 1,
		gap: 12,
		padding: 16,
	},
	seekerButton: {
		alignSelf: 'stretch',
		height: 56,
	},
});
