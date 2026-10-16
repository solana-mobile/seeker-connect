package com.solanamobile.seekerconnect

import kotlinx.coroutines.awaitCancellation

val FAKE_CAPABILITIES = SeekerWalletCapabilities(
    maxMessagesPerRequest = 10,
    maxTransactionsPerRequest = 10,
    supportedTransactionVersions = listOf("legacy", 0),
    features = listOf("solana:signTransactions"),
    supportsSignAndSendTransactions = true,
)

val FAKE_ACCOUNT = SeekerAccount("FakeAddress1111", byteArrayOf(1, 2, 3, 4), "Fake Account")

/** payload ‖ 64-byte fake signature. */
fun fakeSignedPayload(payload: ByteArray) = payload + ByteArray(64) { 9 }

fun fakeTransactionSignature(payload: ByteArray) = ByteArray(64) { payload.size.toByte() }

/**
 * In-memory [SeekerLink] for client tests. Implements the port directly;
 * protocol correctness is covered by the adapter's contract tests, not here.
 */
class FakeSeekerLink : SeekerLink<Unit> {
    var accounts = listOf(FAKE_ACCOUNT)
    var authToken = "fake-auth-token"
    var walletUriBase: String? = "https://fake-wallet.example.com"
    var capabilities = FAKE_CAPABILITIES
    var availability = WalletAvailability.CERTIFIED

    /** When set, `authorize` throws it. */
    var authorizeError: SeekerConnectException? = null

    /** When set, `transact` itself throws it (association never happened). */
    var transactError: SeekerConnectException? = null

    /** When true, authorize returns no sign-in result. */
    var omitSignInResult = false

    /** When true, `transact` never completes unless cancelled. */
    var hang = false

    /** Runs inside every session, before the block. */
    var onSession: suspend () -> Unit = {}

    /** The walletUriBase of every transact call, in order. */
    val transactCalls = mutableListOf<String?>()

    /** Every wallet request, in order: method name to its params. */
    val requests = mutableListOf<Pair<String, Any?>>()

    val authorizeRequests get() = requests.filter { it.first == "authorize" }.map { it.second as AuthorizeParams }

    data class AuthorizeParams(val chain: String?, val authToken: String?, val signInPayload: SeekerSignInPayload?)

    override fun walletAvailability(config: SeekerConnectConfig) = availability

    override suspend fun <T> transact(
        host: Unit,
        config: SeekerConnectConfig,
        walletUriBase: String?,
        block: suspend (SeekerWallet) -> T,
    ): T {
        transactCalls += walletUriBase
        transactError?.let { throw it }
        if (hang) awaitCancellation()
        onSession()
        return block(wallet)
    }

    private val wallet = object : SeekerWallet {
        override suspend fun authorize(chain: String?, authToken: String?, signInPayload: SeekerSignInPayload?): SeekerAuthorization {
            requests += "authorize" to AuthorizeParams(chain, authToken, signInPayload)
            authorizeError?.let { throw it }
            val account = accounts.first()
            return SeekerAuthorization(
                accounts = accounts,
                authToken = this@FakeSeekerLink.authToken,
                walletUriBase = walletUriBase,
                signInResult = if (signInPayload == null || omitSignInResult) null else SeekerSignInResult(
                    account.address,
                    account.publicKey,
                    "signed".encodeToByteArray(),
                    ByteArray(64) { 7 },
                ),
            )
        }

        override suspend fun deauthorize(authToken: String) {
            requests += "deauthorize" to authToken
        }

        override suspend fun getCapabilities(): SeekerWalletCapabilities {
            requests += "get_capabilities" to null
            return capabilities
        }

        override suspend fun signMessages(addresses: List<String>, payloads: List<ByteArray>): List<ByteArray> {
            requests += "sign_messages" to addresses
            return payloads.map(::fakeSignedPayload)
        }

        override suspend fun signTransactions(payloads: List<ByteArray>): List<ByteArray> {
            requests += "sign_transactions" to null
            return payloads.map(::fakeSignedPayload)
        }

        override suspend fun signAndSendTransactions(
            payloads: List<ByteArray>,
            options: SeekerSignAndSendOptions?,
        ): List<ByteArray> {
            requests += "sign_and_send_transactions" to options
            return payloads.map(::fakeTransactionSignature)
        }
    }
}
