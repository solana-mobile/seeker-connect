package com.solanamobile.seekerconnect

/**
 * An account the wallet authorized for this dapp.
 *
 * @property address Base58-encoded account address.
 * @property publicKey The raw public key bytes underlying [address].
 * @property label Display label the wallet assigned to the account, when it provides one.
 */
class SeekerAccount(
    val address: String,
    val publicKey: ByteArray,
    val label: String? = null,
) {
    override fun equals(other: Any?): Boolean =
        other is SeekerAccount && address == other.address &&
            publicKey.contentEquals(other.publicKey) && label == other.label

    override fun hashCode(): Int = address.hashCode()

    override fun toString(): String = "SeekerAccount(address=$address, label=$label)"
}

/**
 * Sign-in-with-Solana payload forwarded to the wallet inside `authorize`
 * (MWA `sign_in_payload`). Field semantics follow the SIWS input spec; [domain]
 * defaults to the host of [DappIdentity.uri].
 */
data class SeekerSignInPayload(
    val domain: String? = null,
    val address: String? = null,
    val statement: String? = null,
    val uri: String? = null,
    val version: String? = null,
    val chainId: String? = null,
    val nonce: String? = null,
    val issuedAt: String? = null,
    val expirationTime: String? = null,
    val notBefore: String? = null,
    val requestId: String? = null,
    val resources: List<String>? = null,
)

/**
 * The wallet's proof for a sign-in request.
 *
 * @property address Base58 address of the account that signed in.
 * @property publicKey Raw public key bytes underlying [address].
 * @property signedMessage The full signed sign-in message bytes.
 * @property signature Signature over [signedMessage].
 */
class SeekerSignInResult(
    val address: String,
    val publicKey: ByteArray,
    val signedMessage: ByteArray,
    val signature: ByteArray,
) {
    override fun equals(other: Any?): Boolean =
        other is SeekerSignInResult && address == other.address &&
            publicKey.contentEquals(other.publicKey) &&
            signedMessage.contentEquals(other.signedMessage) &&
            signature.contentEquals(other.signature)

    override fun hashCode(): Int = address.hashCode()

    override fun toString(): String = "SeekerSignInResult(address=$address)"
}

/**
 * Result of a successful `authorize`, fresh or token-based.
 *
 * @property accounts Accounts the wallet authorized.
 * @property authToken Opaque token that reauthorizes without fresh user consent.
 * @property walletUriBase Endpoint-specific base URI from the wallet (MWA spec
 *   "Endpoint-specific URIs"); targets the same wallet directly on later connections.
 * @property signInResult Present when the `authorize` carried a sign-in payload.
 */
data class SeekerAuthorization(
    val accounts: List<SeekerAccount>,
    val authToken: String,
    val walletUriBase: String? = null,
    val signInResult: SeekerSignInResult? = null,
)

/**
 * The wallet's `get_capabilities` response.
 *
 * @property supportedTransactionVersions Wire values, e.g. `"legacy"` and `0`.
 * @property features Optional-feature identifiers, e.g. `solana:signTransactions`.
 */
data class SeekerWalletCapabilities(
    val maxMessagesPerRequest: Int? = null,
    val maxTransactionsPerRequest: Int? = null,
    val supportedTransactionVersions: List<Any> = emptyList(),
    val features: List<String> = emptyList(),
    val supportsSignAndSendTransactions: Boolean = false,
)

/** Options for `sign_and_send_transactions`, field-for-field. */
data class SeekerSignAndSendOptions(
    val minContextSlot: Int? = null,
    val commitment: String? = null,
    val skipPreflight: Boolean? = null,
    val maxRetries: Int? = null,
    val waitForCommitmentToSendNextTransaction: Boolean? = null,
)

/**
 * What a dapp persists between interactions. Holding one is what makes a
 * dapp "connected" without any live session or wallet launch.
 */
data class StoredAuthorization(
    val accounts: List<SeekerAccount>,
    val authToken: String,
    val walletUriBase: String?,
    val chain: String,
    val capabilities: SeekerWalletCapabilities,
)
