# Seeker Connect

A dapp-only SDK that gives a tighter, branded, direct connect experience for a
Solana Mobile certified device's own wallet (Seeker is the first such device),
built **on top of** — not replacing — the official Mobile Wallet Adapter (MWA)
libraries.

Where generic MWA centers on a "pick a wallet" chooser, Seeker Connect skips that
disambiguation in favor of Seeker-Connect-owned UI and copy, using the MWA spec's
existing Endpoint-specific URI (Android App Link) mechanism. It is a UX/DX layer,
not a protocol reimplementation.

## Targets

Three dapp-side targets, built in this order:

1. **Web** (`js/`) — custom Wallet Standard implementation over the low-level MWA protocol package.
2. **React Native** (`js/`) — over the MWA native module.
3. **Android Kotlin** (`android/`) — gated on an upstream MWA patch (see [`docs/upstream-tasks.md`](docs/upstream-tasks.md)).

## Repository layout

```
skr-connect/
├── js/          JS/TS monorepo (web + React Native) — pnpm workspaces + Turborepo + vitest
│   ├── packages/
│   │   ├── core/             SeekerLink port, shared types, error taxonomy, contract-test suite
│   │   ├── wallet-standard/  Wallet Standard implementation — the first MVP
│   │   ├── ui/               Seeker-Connect-owned UI (Lit): progress overlay + error dialogs
│   │   └── web/              imperative web SDK for dapps not using Wallet Standard
│   └── examples/
│       └── example-web/      Vite + React demo consuming Wallet Standard directly,
│                             plus the browser E2E harness (`pnpm e2e`)
└── android/     Android Kotlin SDK (Gradle) — added in the Android phase
```

The Wallet Standard package is non-negotiable: whatever other entry points
ship, a Wallet-Standard-compatible package is always provided.

The polyglot layout mirrors the reference MWA repo at
`/home/martini/mwa/mobile-wallet-adapter`, which is the ground-truth source for
`@solana-mobile/*` / `com.solanamobile:*` API behavior.

## Design principles

- **Legacy-MWA dependency is isolated** behind an internal per-platform port
  (working name `SeekerLink`), so the eventual swap to the not-yet-built
  `mwa-core` (Kotlin Multiplatform) rewrite is a contained change. A shared
  contract-test suite guards that boundary.
- **Nostr relay transport is the primary connection path.** Local WebSocket is a
  post-MVP fallback; the custom reflector protocol is not used at all.
- **Automated tests are the release gate** — protocol-level tests (no Android) plus
  emulator E2E against Mock Wallet — not manual QA.

## JS development

```sh
cd js
corepack pnpm install
corepack pnpm build
corepack pnpm test          # protocol-level + unit suites (no browser, no Android)
corepack pnpm lint
corepack pnpm format:check
```

Browser E2E (real Chromium via agent-browser; fake wallet over a real Nostr
relay — requires network access to the relay):

```sh
cd js/examples/example-web
corepack pnpm e2e
```

The example app itself: `corepack pnpm dev` in `js/examples/example-web`
(config via URL params — see `src/config.ts`).
