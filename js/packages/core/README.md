# @solana-mobile/seeker-connect-core

The platform-agnostic core of [Seeker Connect](https://github.com/solana-mobile/seeker-connect):
the shared types, the `SeekerConnectConfig`, the error taxonomy
(`SeekerConnectError` / `SeekerConnectErrorCode`), and the `SeekerLink` port —
the boundary that isolates the Mobile Wallet Adapter implementation from the
rest of the SDK.

This is a foundational package. Most dapps do not depend on it directly; they
get it transitively through
[`@solana-mobile/seeker-connect-wallet-standard`](https://github.com/solana-mobile/seeker-connect/tree/main/js/packages/wallet-standard)
or [`@solana-mobile/seeker-connect-web`](https://github.com/solana-mobile/seeker-connect/tree/main/js/packages/web).
Install it directly only to reference its types or to implement a custom
`SeekerLink`.

## Install

```sh
npm install @solana-mobile/seeker-connect-core
```

## Usage

Handle failures by switching on the shared error code:

```ts
import { SeekerConnectError, SeekerConnectErrorCode } from '@solana-mobile/seeker-connect-core';

try {
  await connect();
} catch (error) {
  if (error instanceof SeekerConnectError && error.code === SeekerConnectErrorCode.cancelled) {
    // user cancelled from the Seeker Connect UI — usually a no-op
  }
}
```

### Contract-test suite

The `@solana-mobile/seeker-connect-core/testing` entry point exports
`testSeekerLinkContract`, the vitest suite every `SeekerLink` implementation
must pass. Import it only from test code (it depends on `vitest`).

## Docs

- [Repository](https://github.com/solana-mobile/seeker-connect)
- [Web integration guide](https://github.com/solana-mobile/seeker-connect/blob/main/docs/integration-web.md)
  — including the full error taxonomy and recommended handling
- [Live example dapp](https://solana-mobile.github.io/seeker-connect/example-web/)

Licensed under Apache-2.0.
