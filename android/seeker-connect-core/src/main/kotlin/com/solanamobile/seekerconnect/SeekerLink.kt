package com.solanamobile.seekerconnect

/**
 * The wallet endpoint of one live session, valid only inside the
 * [SeekerLink.transact] block that received it.
 */
interface SeekerWallet {
    /**
     * Requests authorization, or reauthorizes silently with a prior [authToken].
     * [chain] defaults to the config's chain.
     */
    suspend fun authorize(
        chain: String? = null,
        authToken: String? = null,
        signInPayload: SeekerSignInPayload? = null,
    ): SeekerAuthorization

    /** Revokes [authToken] so it can no longer reauthorize. */
    suspend fun deauthorize(authToken: String)

    suspend fun getCapabilities(): SeekerWalletCapabilities

    /** Signs every payload with each of [addresses] (base58). Returns one signed message per payload. */
    suspend fun signMessages(addresses: List<String>, payloads: List<ByteArray>): List<ByteArray>

    /** Returns the signed transaction bytes, one per payload. */
    suspend fun signTransactions(payloads: List<ByteArray>): List<ByteArray>

    /** Returns the raw signature bytes of each submitted transaction. */
    suspend fun signAndSendTransactions(
        payloads: List<ByteArray>,
        options: SeekerSignAndSendOptions? = null,
    ): List<ByteArray>
}

/** Which wallet a connection would reach on this device. */
enum class WalletAvailability {
    /** A certified wallet handles the first-connect App Link; it opens directly. */
    CERTIFIED,

    /** No certified wallet, but some MWA wallet; the system chooser opens. */
    OTHER,

    /** No MWA wallet is installed. */
    NONE,
}

/**
 * The port each platform implements to provide wallet connectivity. It
 * isolates the MWA implementation so the move to `mwa-core` replaces only
 * the implementation; the contract test suite in this module's test fixtures
 * proves the replacement behaves the same.
 *
 * MWA sessions are per-interaction: [transact] establishes a session, runs one
 * block against it, and always tears it down. Continuity across interactions
 * comes from the wallet-issued auth token, not from a long-lived transport.
 *
 * @param H What the platform needs to launch the wallet, e.g. an Activity.
 */
interface SeekerLink<in H> {
    /** Which wallet [transact] would reach right now, without launching anything. */
    fun walletAvailability(config: SeekerConnectConfig): WalletAvailability

    /**
     * Establishes one wallet session, runs [block] against it, and closes the
     * session when [block] completes, fails, or is cancelled. Targets, in order:
     * [walletUriBase] when a wallet handles it, the config's first-connect URI
     * when a certified wallet handles it, then any MWA wallet.
     *
     * @throws SeekerConnectException for every wallet or transport failure.
     */
    suspend fun <T> transact(
        host: H,
        config: SeekerConnectConfig,
        walletUriBase: String?,
        block: suspend (SeekerWallet) -> T,
    ): T
}
