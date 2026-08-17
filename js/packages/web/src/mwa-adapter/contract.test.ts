/**
 * Runs the `SeekerLink` contract suite against the web Nostr adapter via
 * the fake-wallet harness.
 */
import { base58FromUint8Array } from '@solana-mobile/mobile-wallet-adapter-protocol/encoding';

import { testSeekerLinkContract } from '@solana-mobile/seeker-connect-core/testing';
import {
	DEFAULT_FAKE_CAPABILITIES,
	FakeNostrWallet,
	fakeSignature,
	fakeSignedPayload,
} from '../../test/fakeNostrWallet.js';
import { createNostrSeekerLink } from './index.js';

const PUBLIC_KEY = Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8);

let wallet: FakeNostrWallet;

testSeekerLinkContract('web Nostr adapter', {
	setup() {
		wallet = new FakeNostrWallet({
			accounts: [{ publicKey: PUBLIC_KEY, label: 'Contract Account' }],
			authToken: 'CONTRACT_TOKEN',
			walletUriBase: 'https://contractwallet.example.com',
		});
		wallet.install();
		return {
			link: createNostrSeekerLink(),
			config: {
				identity: {
					name: 'Contract Dapp',
					uri: 'https://dapp.example.com',
				},
				relayDomain: 'fakerelay.example.com',
			},
			expected: {
				accounts: [
					{
						address: base58FromUint8Array(PUBLIC_KEY),
						publicKey: PUBLIC_KEY,
						label: 'Contract Account',
					},
				],
				authToken: 'CONTRACT_TOKEN',
				walletUriBase: 'https://contractwallet.example.com',
				capabilities: {
					maxMessagesPerRequest: DEFAULT_FAKE_CAPABILITIES.max_messages_per_request,
					maxTransactionsPerRequest: DEFAULT_FAKE_CAPABILITIES.max_transactions_per_request,
					supportedTransactionVersions: DEFAULT_FAKE_CAPABILITIES.supported_transaction_versions,
					features: DEFAULT_FAKE_CAPABILITIES.features,
					supportsSignAndSendTransactions: DEFAULT_FAKE_CAPABILITIES.supports_sign_and_send_transactions,
				},
				signedPayload: fakeSignedPayload,
				transactionSignature: fakeSignature,
			},
			observed: {
				sessionsOpened: () => wallet.sessionsEstablished,
				openSessions: () => wallet.openSessions,
				targetedBaseUris: () => wallet.targetedBaseUris,
				authorizeRequests: () => wallet.authorizeRequests,
				deauthorizedTokens: () => wallet.deauthorizedTokens,
			},
			scriptAuthorizeDecline: () => {
				wallet.script.authorizeError = {
					code: -1,
					message: 'authorization declined',
				};
			},
			scriptUnresponsiveWallet: () => {
				wallet.script.unresponsive = true;
			},
		};
	},
	teardown() {
		wallet.uninstall();
	},
});
