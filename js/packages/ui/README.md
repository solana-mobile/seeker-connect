# @solana-mobile/seeker-connect-ui

The Seeker-Connect-owned UI for [Seeker Connect](https://github.com/solana-mobile/seeker-connect):
a connect button, a progress overlay, and an error dialog, implemented as
[Lit](https://lit.dev) custom elements in Shadow DOM. No host-page styling is
required or affected.

[`@solana-mobile/seeker-connect-wallet-standard`](https://github.com/solana-mobile/seeker-connect/tree/main/js/packages/wallet-standard)
already uses this package's presenter by default, so most dapps get this UI
without depending on it directly. Install it explicitly only to render the
connect button or to customize the presenter.

## Install

```sh
npm install @solana-mobile/seeker-connect-ui
```

## Usage

Register the custom elements, then use them in markup:

```ts
import { defineSeekerConnectElements } from '@solana-mobile/seeker-connect-ui';

defineSeekerConnectElements(); // registers <seeker-connect-button> and friends
```

```html
<seeker-connect-button theme="dark"></seeker-connect-button>
```

To supply a themed presenter to the Wallet Standard package:

```ts
import { registerSeekerConnect } from '@solana-mobile/seeker-connect-wallet-standard';
import { createSeekerConnectPresenter } from '@solana-mobile/seeker-connect-ui';

registerSeekerConnect({
  identity: { name: 'My Dapp', uri: window.location.origin },
  relayDomain: '<relay-domain>',
  presenter: createSeekerConnectPresenter({ theme: 'dark' }),
});
```

The elements are `seeker-connect-button`, `seeker-connect-progress`, and
`seeker-connect-error-dialog`. The package also re-exports the brand mark vector
paths (`S_MARK_PATH`, `S_MARK_ARC_PATH`, `FOOTER_WORDMARK_PATHS`).

## Docs

- [Repository](https://github.com/solana-mobile/seeker-connect)
- [Web integration guide](https://github.com/solana-mobile/seeker-connect/blob/main/docs/integration-web.md)
- [Live example dapp](https://solana-mobile.github.io/seeker-connect/example-web/)

Licensed under Apache-2.0.
