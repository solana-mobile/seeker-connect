# seeker-connect-compose

Seeker-Connect-owned UI for Jetpack Compose: the progress and error cards
shown around wallet interactions, and the "… with Seeker" button.

```kotlin
val dialogs = SeekerConnectDialogState()
val seekerConnect = SeekerConnect(config, MwaSeekerLink(activity), SharedPreferencesAuthorizationCache(activity), dialogs)

setContent {
    SeekerConnectButton(onClick = { scope.launch { seekerConnect.connect(activity) } })
    SeekerConnectDialogs(dialogs)
}
```

- `SeekerConnectDialogState` is the `SeekerConnectPresenter`; `SeekerConnectDialogs`
  draws its cards. Closing the progress card cancels the interaction, which
  then fails with `CANCELLED` and shows no error card.
- `SeekerConnectButton` renders "Connect with Seeker" (`CONNECT`) or "Sign in
  with Seeker" (`SIGN_IN`): black on a light screen, white on a dark one.
- Both follow the system theme; pass `darkTheme` to force one.

Brand vectors are generated from the web UI package and must not be
hand-edited. Text uses the system font.
