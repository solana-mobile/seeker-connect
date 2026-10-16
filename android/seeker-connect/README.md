# seeker-connect (Android)

The Seeker Connect Android SDK: a Kotlin-native client for connecting a dapp
to a Solana Mobile certified device's own wallet, built on the official Mobile
Wallet Adapter `clientlib`.

## Requirements

For now, apps using the SDK need compileSdk 36, Android Gradle plugin 8.9.1 or
later, and Kotlin 2.0 or later.

## Transport

Local WebSocket today: the dapp launches the wallet with an association intent
and connects to the WebSocket the wallet serves on localhost. Nostr relay
transport may be added later.

## Quick start

```kotlin
class MainActivity : ComponentActivity() {
    private val seekerConnect by lazy {
        SeekerConnect(
            SeekerConnectConfig(identity = DappIdentity("My Dapp", "https://mydapp.example.com", "favicon.ico")),
            MwaSeekerLink(this),
            SharedPreferencesAuthorizationCache(this),
        )
    }

    fun connect() = lifecycleScope.launch {
        val authorization = seekerConnect.connect(this@MainActivity)
        println("connected as ${authorization.accounts.first().address}")
    }
}
```

"Connected" means holding a wallet-issued authorization; there is no
long-lived transport. Every wallet interaction runs in its own short-lived
session and reauthorizes silently with the stored auth token.

- `restore()` — the cached authorization, without launching the wallet.
- `connect(activity)` — restores, or authorizes in a fresh session. Concurrent calls launch the wallet once.
- `signIn(activity, payload)` — Sign-In-With-Solana, connecting in the same session when needed.
- `signMessages`, `signTransactions`, `signAndSendTransactions` — one request per wallet launch.
- `transact(activity) { authorization -> … }` — several requests in one wallet launch.
- `disconnect()` — forgets the authorization without launching the wallet. To also revoke the token, call `transact { deauthorize(it.authToken) }` first.
- `authorization: StateFlow` — the held authorization, null while disconnected.
- `walletAvailability()` — which wallet a connection would reach, without launching anything.

Calls take the `ComponentActivity` to launch the wallet from; they register
their activity-result launcher on demand, so they can run at any point in the
activity's lifecycle.

## Wallet targeting

Each connection targets, in order:

1. the wallet base URI learned from the wallet's last `authorize` response;
2. `firstConnectWalletBaseUri` (default `https://connect.solanamobile.com`, the
   shared App Link domain of certified wallets);
3. any MWA wallet, through the system chooser for the `solana-wallet:` scheme.

An https URI is used only when the system opens it in an installed MWA wallet,
which requires that wallet to be its verified App Link handler; a browser is
never launched. `walletAvailability()` reports `CERTIFIED`, `OTHER`, or `NONE`
for the same check, e.g. to decide whether to show a "Connect with Seeker"
button.

## Configuration

| `SeekerConnectConfig` | Default | Purpose |
| --- | --- | --- |
| `identity` | — | Dapp name, URI, and icon shown in the wallet's consent UI. |
| `chain` | `solana:mainnet` | Chain requested at authorization. |
| `firstConnectWalletBaseUri` | `https://connect.solanamobile.com` | Wallet base URI for connections before a wallet has been learned. |
| `associationTimeoutMs` | `30000` | How long association may take before `ASSOCIATION_FAILED`. |

`SeekerConnect` also takes an `AuthorizationCache` (default in-memory;
`SharedPreferencesAuthorizationCache` persists across process death) and a
`SeekerConnectPresenter` for UI (see `seeker-connect-compose`).

## Errors

Wallet and transport failures throw `SeekerConnectException` with a `code`:

| Code | Meaning |
| --- | --- |
| `NO_WALLET_FOUND` | No MWA wallet is installed. |
| `ASSOCIATION_FAILED` | No wallet completed association (timeout, or the wallet returned without connecting). |
| `AUTHORIZATION_DECLINED` | The wallet declined authorization; on reauthorization the stored token is discarded. |
| `REQUEST_DECLINED` | The wallet declined to sign or submit. |
| `SESSION_CLOSED` | The session ended before the interaction completed. |
| `CANCELLED` | The user closed Seeker Connect UI, or disconnected mid-interaction. |
| `WALLET_ERROR` | Any other wallet-reported error; `cause` holds the MWA error. |

Cancelling the calling coroutine cancels the interaction and closes the
session; that cancellation propagates as usual and is not an error.
