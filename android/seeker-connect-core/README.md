# seeker-connect-core

Platform-agnostic Seeker Connect core, in plain Kotlin with no Android or MWA
dependencies:

- the `SeekerConnect` client (cached authorization, silent reauthorization,
  presenter hooks, multi-operation `transact`);
- configuration, models, and the `SeekerConnectException` error taxonomy;
- the `SeekerLink` port each platform implements over MWA;
- `AuthorizationCache` and `SeekerConnectPresenter` interfaces.

## Contract suite

The `testFixtures` source set holds `SeekerLinkContractTest`, the behavioral
bar for every `SeekerLink` implementation. Subclass it in the implementation's
tests and supply a `SeekerLinkContractContext`:

```groovy
testImplementation testFixtures(project(':seeker-connect-core'))
```
