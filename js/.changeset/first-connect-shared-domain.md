---
'@solana-mobile/seeker-connect-core': patch
'@solana-mobile/seeker-connect-web': patch
---

First connections now target the shared App Link domain `https://connect.solanamobile.com` by default instead of the generic `solana-wallet:` scheme, so certified wallets open without a disambiguation dialog. `firstConnectWalletBaseUri` remains available as an override.
