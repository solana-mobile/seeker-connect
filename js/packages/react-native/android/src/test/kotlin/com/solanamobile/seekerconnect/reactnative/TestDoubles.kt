package com.solanamobile.seekerconnect.reactnative

import androidx.activity.ComponentActivity
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.WritableMap
import com.solanamobile.seekerconnect.SeekerAccount
import com.solanamobile.seekerconnect.SeekerAuthorization
import com.solanamobile.seekerconnect.SeekerConnectConfig
import com.solanamobile.seekerconnect.SeekerConnectException
import com.solanamobile.seekerconnect.SeekerLink
import com.solanamobile.seekerconnect.SeekerSignAndSendOptions
import com.solanamobile.seekerconnect.SeekerSignInPayload
import com.solanamobile.seekerconnect.SeekerSignInResult
import com.solanamobile.seekerconnect.SeekerWallet
import com.solanamobile.seekerconnect.SeekerWalletCapabilities
import com.solanamobile.seekerconnect.WalletAvailability
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

val ACCOUNT = SeekerAccount("Addr1", byteArrayOf(1, 2, 3), "Main")

val CAPABILITIES = SeekerWalletCapabilities(
    maxMessagesPerRequest = 3,
    maxTransactionsPerRequest = 4,
    supportedTransactionVersions = listOf("legacy", 0),
    features = listOf("solana:signTransactions"),
    supportsSignAndSendTransactions = true,
)

/** A [SeekerLink] whose wallet answers from a script and records what it was asked. */
class ScriptedLink : SeekerLink<ComponentActivity> {
    var availability = WalletAvailability.CERTIFIED

    /** When set, every session fails with it. */
    var failure: SeekerConnectException? = null

    val hosts = CopyOnWriteArrayList<ComponentActivity>()
    val signedAddresses = CopyOnWriteArrayList<List<String>>()
    val signInPayloads = CopyOnWriteArrayList<SeekerSignInPayload?>()
    val sendOptions = CopyOnWriteArrayList<SeekerSignAndSendOptions?>()
    var sessions = 0

    override fun walletAvailability(config: SeekerConnectConfig) = availability

    override suspend fun <T> transact(
        host: ComponentActivity,
        config: SeekerConnectConfig,
        walletUriBase: String?,
        block: suspend (SeekerWallet) -> T,
    ): T {
        hosts += host
        sessions++
        failure?.let { throw it }
        return block(wallet)
    }

    private val wallet = object : SeekerWallet {
        override suspend fun authorize(chain: String?, authToken: String?, signInPayload: SeekerSignInPayload?): SeekerAuthorization {
            signInPayloads += signInPayload
            return SeekerAuthorization(
                accounts = listOf(ACCOUNT),
                authToken = "token",
                walletUriBase = "https://wallet.example.com",
                signInResult = signInPayload?.let {
                    SeekerSignInResult("Addr1", byteArrayOf(1, 2, 3), byteArrayOf(4, 5), byteArrayOf(6, 7))
                },
            )
        }

        override suspend fun deauthorize(authToken: String) {}

        override suspend fun getCapabilities() = CAPABILITIES

        override suspend fun signMessages(addresses: List<String>, payloads: List<ByteArray>): List<ByteArray> {
            signedAddresses += addresses
            return payloads.map { it + 1 }
        }

        override suspend fun signTransactions(payloads: List<ByteArray>) = payloads.map { it + 2 }

        override suspend fun signAndSendTransactions(payloads: List<ByteArray>, options: SeekerSignAndSendOptions?): List<ByteArray> {
            sendOptions += options
            return payloads.map { byteArrayOf(9, it.size.toByte()) }
        }
    }
}

/** A [Promise] that records how it settled; [await] blocks until it does. */
class RecordingPromise : Promise {
    private val settled = CountDownLatch(1)

    @Volatile var value: Any? = null
    @Volatile var code: String? = null
    @Volatile var rejected = false

    fun await(): RecordingPromise {
        check(settled.await(5, TimeUnit.SECONDS)) { "The promise never settled" }
        return this
    }

    override fun resolve(value: Any?) {
        this.value = value
        settled.countDown()
    }

    private fun fail(code: String?) {
        this.code = code
        rejected = true
        settled.countDown()
    }

    override fun reject(code: String?, message: String?) = fail(code)

    override fun reject(code: String?, throwable: Throwable?) = fail(code)

    override fun reject(code: String?, message: String?, throwable: Throwable?) = fail(code)

    override fun reject(throwable: Throwable) = fail(null)

    override fun reject(throwable: Throwable, userInfo: WritableMap) = fail(null)

    override fun reject(code: String?, userInfo: WritableMap) = fail(code)

    override fun reject(code: String?, throwable: Throwable?, userInfo: WritableMap) = fail(code)

    override fun reject(code: String?, message: String?, userInfo: WritableMap) = fail(code)

    override fun reject(code: String?, message: String?, throwable: Throwable?, userInfo: WritableMap?) = fail(code)

    @Deprecated("Deprecated in Java")
    override fun reject(message: String) = fail(null)
}
