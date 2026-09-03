# @solana-mobile/seeker-connect-web

The imperative web SDK for [Seeker Connect](https://github.com/solana-mobile/seeker-connect)
— for dapps that do **not** use Wallet Standard and want to manage sessions, the
authorization token, and UI themselves.

Most dapps should use
[`@solana-mobile/seeker-connect-wallet-standard`](https://github.com/solana-mobile/seeker-connect/tree/main/js/packages/wallet-standard)
instead, which builds on this package and exposes Seeker Connect through the
standard wallet interface. Reach for this package directly only when you need
the low-level `SeekerLink` port.

## Install

```sh
npm install @solana-mobile/seeker-connect-web
```

## Usage

`createNostrSeekerLink()` returns a `SeekerLink`. Its `transact` method opens a
short-lived MWA session over a Nostr relay, runs your callback against a
`SeekerWallet`, and closes the session when the callback settles. The `wallet`
handle is valid only inside the callback; payloads are raw `Uint8Array` and
addresses are base58 strings.

```ts
import { createNostrSeekerLink } from '@solana-mobile/seeker-connect-web';
import type { SeekerConnectConfig } from '@solana-mobile/seeker-connect-web';

const link = createNostrSeekerLink();

const config: SeekerConnectConfig = {
  identity: { name: 'My Dapp', uri: window.location.origin, icon: '/icon.png' },
  relayDomain: 'relay.solanamobile.com',
};

const authorization = await link.transact(config, async (wallet) => {
  return wallet.authorize({ chain: 'solana:mainnet' });
});

// Persist authorization.authToken and authorization.walletUriBase yourself;
// restoring them is what makes the dapp "connected".
```

## Docs

- [Repository](https://github.com/solana-mobile/seeker-connect)
- [Web integration guide](https://github.com/solana-mobile/seeker-connect/blob/main/docs/integration-web.md)
  — the full imperative walkthrough, configuration, and the error taxonomy
- [Live example dapp](https://solana-mobile.github.io/seeker-connect/example-web/)

Licensed under Apache-2.0.
