/**
 * Example-app configuration. Everything is overridable per URL so the same
 * build serves manual testing on a device, desktop development, and the
 * automated E2E harness:
 *
 *   ?relay=<domain>     Nostr relay domain
 *   ?baseUri=<uri|off>  first-connect wallet base URI ("off" disables it)
 *   ?chain=<solana:...> chain requested at authorization
 *   ?timeout=<ms>       association timeout override
 *   ?e2e                test mode (see below)
 */
import type { SeekerChain } from '@skr-connect/wallet-standard';

const params = new URLSearchParams(window.location.search);

const DEFAULT_RELAY_DOMAIN = 'relay.solanamobile.com';
/** Shared certified-wallet App Link domain (not live yet; PR open). */
const DEFAULT_WALLET_BASE_URI = 'https://connect.solanamobile.com';
const DEFAULT_CHAIN: SeekerChain = 'solana:devnet';

const baseUriParam = params.get('baseUri');

export const config = {
	identity: {
		name: 'Seeker Connect Example',
		uri: window.location.origin,
		icon: 'favicon.ico',
	},
	relayDomain: params.get('relay') ?? DEFAULT_RELAY_DOMAIN,
	chain: (params.get('chain') as SeekerChain) ?? DEFAULT_CHAIN,
	firstConnectWalletBaseUri: baseUriParam === 'off' ? undefined : (baseUriParam ?? DEFAULT_WALLET_BASE_URI),
	associationTimeoutMs: params.has('timeout') ? Number(params.get('timeout')) : undefined,
};

export const rpcUrl = params.get('rpc') ?? 'https://api.devnet.solana.com';

export const isE2E = params.has('e2e');

if (isE2E) {
	// The protocol library detects a successful wallet launch by the page
	// losing focus within 3s of the association URL being opened. In the
	// test browser no wallet exists, so nothing blurs the page; a synthetic
	// blur keeps the session (served by the harness's fake wallet over the
	// relay) alive.
	setInterval(() => window.dispatchEvent(new Event('blur')), 400);
}
