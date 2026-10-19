# Seeker Connect React Native example

A React Native dapp using
[`@solana-mobile/seeker-connect-react-native`](../../packages/react-native): connect, Sign-In-With-Solana, and
signing and sending a memo transaction on devnet. It mirrors the
[Android example](../../../android/example).

## Run it

1. Publish the Android SDK to Maven Local: `./gradlew publishToMavenLocal` in `android/`.
2. Install and build the workspace: `pnpm install` and `pnpm build` in `js/`.
3. Start Metro with `pnpm start` in this directory, then install the app with `pnpm android`.
