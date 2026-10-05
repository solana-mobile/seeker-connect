/**
 * Example-app configuration. Everything is overridable per URL so the same
 * build serves manual testing on a device, desktop development, and the
 * automated E2E harness:
 *
 *   ?relay=<domain>     Nostr relay domain
 *   ?baseUri=<uri>      first-connect wallet base URI
 *   ?chain=<solana:...> chain requested at authorization
 *   ?timeout=<ms>       association timeout override
 */
import type { SeekerChain } from '@solana-mobile/seeker-connect-wallet-standard';

const params = new URLSearchParams(window.location.search);

const DEFAULT_RELAY_DOMAIN = (import.meta.env.VITE_RELAY_DOMAIN as string | undefined) ?? 'relay.example.com';
/** Shared certified-wallet App Link domain. */
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
	firstConnectWalletBaseUri: baseUriParam ?? DEFAULT_WALLET_BASE_URI,
	associationTimeoutMs: params.has('timeout') ? Number(params.get('timeout')) : undefined,
};

export const rpcUrl = params.get('rpc') ?? 'https://api.devnet.solana.com';
