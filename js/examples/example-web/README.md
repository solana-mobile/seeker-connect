# Seeker Connect Example (web)

A Vite + React demo that consumes
[`@solana-mobile/seeker-connect-wallet-standard`](../../packages/wallet-standard)
directly through the [Wallet Standard](https://github.com/wallet-standard/wallet-standard)
registry: discover the Seeker Connect wallet, connect, sign in (SIWS), sign a
message, sign a transaction, and sign-and-send a memo transaction on devnet.

The same build also serves as the browser E2E harness (`pnpm e2e`).

## Live demo

Deployed on GitHub Pages:

**<https://solana-mobile.github.io/seeker-connect/example-web/>**

## Local development

From this directory:

```sh
pnpm build
pnpm dev # start the Vite dev server on http://localhost:3010
```

### Testing on a device

A phone can't reach `localhost` on your machine, so expose the dev server over
https with the bundled ngrok tunnel, then open the tunnel URL on the device:

```sh
pnpm dev            # in one terminal
pnpm tunnel:start   # in another — ngrok http 3010
```

Vite is preconfigured to accept ngrok Host headers.

### E2E harness

```sh
pnpm e2e
```

Runs a real Chromium browser against a fake wallet that talks over a real Nostr
relay, so it requires network access to the relay.

## Configuration (URL params)

Every setting is overridable per URL so the same build serves manual testing on
a device, desktop development, and the automated E2E harness. Defaults live in
[`src/config.ts`](src/config.ts).

| Param | Meaning | Default |
| --- | --- | --- |
| `?relay=<domain>` | Nostr relay domain | `VITE_RELAY_DOMAIN` env, else `relay.example.com` |
| `?baseUri=<uri\|off>` | First-connect wallet base URI; `off` disables it | `https://connect.solanamobile.com` |
| `?chain=<solana:...>` | Chain requested at authorization | `solana:devnet` |
| `?timeout=<ms>` | Association timeout override | SDK default |
| `?rpc=<url>` | Solana RPC endpoint | `https://api.devnet.solana.com` |
| `?e2e` | Test mode (synthetic blur keeps the harness session alive) | off |

The relay domain can also be set at build time with the `VITE_RELAY_DOMAIN`
environment variable.

Example — point the app at a specific relay and mainnet:

```
http://localhost:3010/?relay=relay.example.com&chain=solana:mainnet
```
