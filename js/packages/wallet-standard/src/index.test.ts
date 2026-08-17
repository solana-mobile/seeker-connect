import { describe, expect, it, vi } from 'vitest';

import { FakeSeekerLink } from '../test/fakeSeekerLink.js';
import { createMemoryAuthorizationCache } from './authorizationCache.js';
import { registerSeekerConnect, SeekerConnectWallet, SeekerConnectWalletName } from './index.js';

describe('registerSeekerConnect', () => {
	it('builds a SeekerConnectWallet from the config and injected parts', () => {
		// `registerWallet` logs (never throws) when no `window` exists.
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const wallet = registerSeekerConnect({
			identity: { name: 'Test Dapp', uri: 'https://dapp.example.com' },
			relayDomain: 'relay.example.com',
			chain: 'solana:devnet',
			seekerLink: new FakeSeekerLink(),
			authorizationCache: createMemoryAuthorizationCache(),
		});

		expect(wallet).toBeInstanceOf(SeekerConnectWallet);
		expect(wallet.name).toBe(SeekerConnectWalletName);
		expect(wallet.chains).toEqual(['solana:devnet']);
		consoleError.mockRestore();
	});
});
