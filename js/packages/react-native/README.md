# @solana-mobile/seeker-connect-react-native

The React Native SDK for [Seeker Connect](https://github.com/solana-mobile/seeker-connect):
a native module over the
[Android Seeker Connect SDK](https://github.com/solana-mobile/seeker-connect/tree/main/android/seeker-connect).

## Install

```sh
npm install @solana-mobile/seeker-connect-react-native
```

## Identity

`identity.uri` is your dapp's URI, which wallets use to verify and show who is asking. Mobile Wallet Adapter requires
an absolute, hierarchical URI. Use your dapp's `https` URL: the Seeker wallet has been seen ending the session for a
custom-scheme URI such as `myapp://`.

```ts
SeekerConnect.configure({
	identity: { name: 'My Dapp', uri: 'https://mydapp.example.com', icon: 'favicon.ico' },
});
```

## Requirements

For now: React Native 0.81 or later (Expo SDK 54 or later), with the Android
app on compileSdk 36, Android Gradle plugin 8.9.1 or later, and Kotlin 2.0 or
later.
