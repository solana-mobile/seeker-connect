# example

Android example dapp: connect (restored silently on launch), Sign-In-With-Solana,
sign message, sign transaction, sign and send, disconnect. Transactions are
hand-built devnet memo transactions; the recent blockhash comes from the
public devnet RPC.

```sh
cd android
./gradlew :example:installDebug
```

Needs an MWA wallet on the device or emulator.
