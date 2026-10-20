package com.solanamobile.seekerconnect.android

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Bundle
import android.os.Looper
import androidx.activity.ComponentActivity
import com.solana.mobilewalletadapter.common.ProtocolContract
import com.solana.mobilewalletadapter.common.protocol.SessionProperties.ProtocolVersion
import com.solanamobile.seekerconnect.SeekerConnectException
import com.solanamobile.seekerconnect.SeekerConnectException.Code
import com.solanamobile.seekerconnect.SeekerSignAndSendOptions
import com.solanamobile.seekerconnect.SeekerSignInPayload
import com.solanamobile.seekerconnect.WalletAvailability
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlin.test.AfterTest
import kotlin.test.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Adapter mapping beyond the shared contract. */
@RunWith(RobolectricTestRunner::class)
class MwaSeekerLinkTest {
    private val mwa = FakeMwa()

    @AfterTest
    fun tearDown() = mwa.close()

    private suspend fun <T> transact(block: suspend (com.solanamobile.seekerconnect.SeekerWallet) -> T) =
        mwa.link.transact(mwa.host, mwa.config, null, block)

    @Test
    fun `an unverified wallet declaring the first-connect App Link is not treated as certified`() = runBlocking {
        mwa.scriptInstalledWallets(certified = false, generic = true)
        mwa.installUnverifiedWallet(mwa.config.firstConnectWalletBaseUri)
        assertEquals(WalletAvailability.OTHER, mwa.link.walletAvailability(mwa.config))
        transact { }
        assertEquals(listOf<String?>(null), mwa.targetedBaseUris())
    }

    @Test
    fun `pins the launch to the wallet the URI resolved to`() = runBlocking {
        transact { }
        mwa.scriptInstalledWallets(certified = false, generic = true)
        transact { }
        assertEquals(listOf("com.example.certifiedwallet", null), mwa.launchedPackages())
    }

    @Test
    fun `sends the dapp identity, chain, and sign-in payload`() = runBlocking {
        val address = mwa.expected.accounts.first().address
        transact {
            it.authorize(
                signInPayload = SeekerSignInPayload(
                    address = address,
                    statement = "hi",
                    uri = "https://dapp.example.com/login",
                    version = "1",
                    chainId = "solana:mainnet",
                    nonce = "12345678",
                    issuedAt = "2026-10-16T00:00:00Z",
                    expirationTime = "2026-10-17T00:00:00Z",
                    notBefore = "2026-10-15T00:00:00Z",
                    requestId = "request-1",
                    resources = listOf("https://dapp.example.com/terms", "https://dapp.example.com/privacy"),
                ),
            )
        }
        val (method, params) = mwa.requests.single()
        assertEquals(ProtocolContract.METHOD_AUTHORIZE, method)
        val identity = params.getJSONObject(ProtocolContract.PARAMETER_IDENTITY)
        assertEquals("Test Dapp", identity.getString(ProtocolContract.PARAMETER_IDENTITY_NAME))
        assertEquals("https://dapp.example.com", identity.getString(ProtocolContract.PARAMETER_IDENTITY_URI))
        assertEquals("favicon.ico", identity.getString(ProtocolContract.PARAMETER_IDENTITY_ICON))
        assertEquals("solana:mainnet", params.getString(ProtocolContract.PARAMETER_CHAIN))
        val signIn = params.getJSONObject(ProtocolContract.PARAMETER_SIGN_IN_PAYLOAD)
        assertEquals(
            mapOf(
                "domain" to "dapp.example.com",
                "address" to address,
                "statement" to "hi",
                "uri" to "https://dapp.example.com/login",
                "version" to "1",
                "chainId" to "solana:mainnet",
                "nonce" to "12345678",
                "issuedAt" to "2026-10-16T00:00:00Z",
                "expirationTime" to "2026-10-17T00:00:00Z",
                "notBefore" to "2026-10-15T00:00:00Z",
                "requestId" to "request-1",
            ),
            (signIn.keys().asSequence() - "resources").associateWith(signIn::getString),
        )
        val resources = signIn.getJSONArray("resources")
        assertEquals(listOf("https://dapp.example.com/terms", "https://dapp.example.com/privacy"), List(resources.length(), resources::getString))
    }

    @Test
    fun `sends the sign-and-send options`() = runBlocking {
        transact {
            it.authorize()
            it.signAndSendTransactions(
                listOf(byteArrayOf(1)),
                SeekerSignAndSendOptions(
                    minContextSlot = 7,
                    commitment = "confirmed",
                    skipPreflight = true,
                    maxRetries = 3,
                    waitForCommitmentToSendNextTransaction = true,
                ),
            )
        }
        val options = mwa.requests.last().second.getJSONObject(ProtocolContract.PARAMETER_OPTIONS)
        assertEquals(7, options.getInt(ProtocolContract.PARAMETER_OPTIONS_MIN_CONTEXT_SLOT))
        assertEquals("confirmed", options.getString(ProtocolContract.PARAMETER_OPTIONS_COMMITMENT))
        assertEquals(true, options.getBoolean(ProtocolContract.PARAMETER_OPTIONS_SKIP_PREFLIGHT))
        assertEquals(3, options.getInt(ProtocolContract.PARAMETER_OPTIONS_MAX_RETRIES))
        assertEquals(true, options.getBoolean(ProtocolContract.PARAMETER_OPTIONS_WAIT_FOR_COMMITMENT))
    }

    @Test
    fun `reads a zero per-request maximum as no limit`() = runBlocking {
        mwa.unlimitedRequests = true
        val capabilities = transact { it.getCapabilities() }
        assertNull(capabilities.maxMessagesPerRequest)
        assertNull(capabilities.maxTransactionsPerRequest)
    }

    @Test
    fun `talks to legacy wallets with reauthorize and cluster names`() = runBlocking {
        mwa.protocolVersion = ProtocolVersion.LEGACY
        for (chain in listOf("solana:mainnet", "solana:testnet", "solana:devnet", "solana:custom")) {
            transact { it.authorize(chain) }
        }
        assertEquals(
            listOf("mainnet-beta", "testnet", "devnet", "solana:custom"),
            mwa.requests.map { it.second.getString(ProtocolContract.PARAMETER_CLUSTER) },
        )
        transact { it.authorize(authToken = mwa.expected.authToken) }
        assertEquals(ProtocolContract.METHOD_REAUTHORIZE, mwa.requests.last().first)
    }

    @Test
    fun `signs in on legacy wallets by signing the sign-in message`() = runBlocking {
        mwa.protocolVersion = ProtocolVersion.LEGACY
        val result = transact { it.authorize(signInPayload = SeekerSignInPayload(statement = "hi")) }.signInResult
        assertNotNull(result)
        assertTrue(result.signedMessage.decodeToString().startsWith("dapp.example.com wants you to sign in"))
    }

    @Test
    fun `fails fast with association-failed when the wallet returns before associating`() = runBlocking {
        mwa.scriptUnresponsiveWallet()
        val session = async(SupervisorJob()) {
            mwa.link.transact(mwa.host, mwa.config.copy(associationTimeoutMs = 60_000), null) { }
        }
        var launched = shadowOf(mwa.host).nextStartedActivityForResult
        while (launched == null) {
            delay(5)
            launched = shadowOf(mwa.host).nextStartedActivityForResult
        }
        shadowOf(mwa.host).receiveResult(launched.intent, Activity.RESULT_CANCELED, null)
        // Well inside the association timeout: the return itself ends the attempt.
        val error = assertFailsWith<SeekerConnectException> { withTimeout(5_000) { session.await() } }
        assertEquals(Code.ASSOCIATION_FAILED, error.code)
        assertEquals(0, mwa.openSessions())
        assertEquals(emptyList(), mwa.resultRegistryEntries())
    }

    @Test
    fun `leaves nothing in the host's result registry once the wallet returns after the session`() = runBlocking {
        assertEquals(1, transact { mwa.resultRegistryEntries() }.size)
        mwa.walletReturns()
        assertEquals(emptyList(), mwa.resultRegistryEntries())
    }

    @Test
    fun `leaves nothing in the host's result registry when the wallet returns during the session`() = runBlocking {
        transact { mwa.walletReturns() }
        assertEquals(emptyList(), mwa.resultRegistryEntries())
    }

    @Test
    fun `leaves nothing in the host's result registry after an association timeout`() = runBlocking {
        mwa.scriptUnresponsiveWallet()
        assertFailsWith<SeekerConnectException> {
            mwa.link.transact(mwa.host, mwa.config.copy(associationTimeoutMs = 100), null) { }
        }
        mwa.walletReturns()
        assertEquals(emptyList(), mwa.resultRegistryEntries())
    }

    @Test
    fun `leaves nothing in the host's result registry after cancellation`() = runBlocking {
        mwa.scriptUnresponsiveWallet()
        val session = async(start = CoroutineStart.UNDISPATCHED) { transact { } }
        while (mwa.resultRegistryEntries().isEmpty()) delay(10)
        session.cancel()
        assertFailsWith<CancellationException> { session.await() }
        mwa.walletReturns()
        assertEquals(emptyList(), mwa.resultRegistryEntries())
    }

    @Test
    fun `fails with no-wallet-found and tears down when the wallet cannot be launched`() = runBlocking {
        val host = Robolectric.buildActivity(UnlaunchableActivity::class.java).setup().get()
        val error = assertFailsWith<SeekerConnectException> { mwa.link.transact(host, mwa.config, null) { } }
        assertEquals(Code.NO_WALLET_FOUND, error.code)
        assertEquals(1, mwa.sessionsStarted())
        assertEquals(0, mwa.openSessions())
        assertEquals(emptyList(), mwa.resultRegistryEntries(host))
    }

    @Test
    fun `launches the wallet on the main thread when called off it`() = runBlocking {
        val host = Robolectric.buildActivity(LaunchThreadActivity::class.java).setup().get()
        val session = async(Dispatchers.Default) {
            assertTrue(Looper.myLooper() != Looper.getMainLooper())
            mwa.link.transact(host, mwa.config, null) { "done" }
        }
        while (!session.isCompleted) {
            shadowOf(Looper.getMainLooper()).idle()
            delay(5)
        }
        assertEquals("done", session.await())
        assertEquals(Looper.getMainLooper().thread, host.launchThread)
    }

    @Test
    fun `fails with session-closed when the wallet drops the session mid-request`() = runBlocking {
        mwa.dropSessionOnSigning = true
        val error = assertFailsWith<SeekerConnectException> {
            transact {
                it.authorize()
                it.signTransactions(listOf(byteArrayOf(1)))
            }
        }
        assertEquals(Code.SESSION_CLOSED, error.code)
    }

    @Test
    fun `fails with session-closed when a request is sent after the session ended`() = runBlocking {
        mwa.dropSessionOnSigning = true
        val error = assertFailsWith<SeekerConnectException> {
            transact {
                it.authorize()
                runCatching { it.signTransactions(listOf(byteArrayOf(1))) }
                it.getCapabilities()
            }
        }
        assertEquals(Code.SESSION_CLOSED, error.code)
    }

    /** No wallet can be launched from it, as when the wallet is uninstalled after the pre-check. */
    class UnlaunchableActivity : ComponentActivity() {
        @Deprecated("Deprecated in Java")
        override fun startActivityForResult(intent: Intent, requestCode: Int, options: Bundle?) {
            throw ActivityNotFoundException()
        }
    }

    /** Records the thread the wallet launch ran on. */
    class LaunchThreadActivity : ComponentActivity() {
        @Volatile var launchThread: Thread? = null

        @Deprecated("Deprecated in Java")
        override fun startActivityForResult(intent: Intent, requestCode: Int, options: Bundle?) {
            launchThread = Thread.currentThread()
            @Suppress("DEPRECATION")
            super.startActivityForResult(intent, requestCode, options)
        }
    }
}
