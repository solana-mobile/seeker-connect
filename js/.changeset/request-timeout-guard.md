---
'@solana-mobile/seeker-connect-core': patch
'@solana-mobile/seeker-connect-web': patch
---

Reject wallet requests with `session-closed` when the wallet does not respond within `requestTimeoutMs` (default 2 minutes), instead of hanging when the relay session drops.
