# @solana-mobile/seeker-connect-wallet-standard

The [Wallet Standard](https://github.com/wallet-standard/wallet-standard)
implementation of [Seeker Connect](https://github.com/solana-mobile/seeker-connect)
— the entry point most web dapps use. Registering it makes Seeker's own wallet
discoverable and drivable by any Wallet-Standard-aware stack
(`@solana/wallet-adapter`, Gill, your own registry code) with no
Seeker-specific code at the call sites.

This package pulls in `@solana-mobile/seeker-connect-web`,
`@solana-mobile/seeker-connect-ui`, and `@solana-mobile/seeker-connect-core`
transitively, so it is usually the only Seeker Connect dependency a dapp needs.

## Install

```sh
npm install @solana-mobile/seeker-connect-wallet-standard @wallet-standard/app @wallet-standard/features
```

## Usage

```ts
import { registerSeekerConnect } from '@solana-mobile/seeker-connect-wallet-standard';
import { getWallets } from '@wallet-standard/app';
import { StandardConnect } from '@wallet-standard/features';

// 1. Register once, early in your app.
registerSeekerConnect({
	identity: { name: 'My Dapp', uri: window.location.origin, icon: '/icon.png' },
	relayDomain: '<relay-domain>',
});

// 2. Discover it like any other Wallet Standard wallet.
const wallet = getWallets()
	.get()
	.find((w) => w.name === 'Seeker Connect');

// 3. Connect — launches the wallet for user consent on first connect.
const { accounts } = await wallet.features[StandardConnect].connect();
```

## Docs

- [Repository](https://github.com/solana-mobile/seeker-connect)
- [Web integration guide](https://github.com/solana-mobile/seeker-connect/blob/main/docs/integration-web.md)
  — auto-discovery, connect/sign flows, configuration, and the error taxonomy
- [Live example dapp](https://solana-mobile.github.io/seeker-connect/example-web/)

Licensed under Apache-2.0.
