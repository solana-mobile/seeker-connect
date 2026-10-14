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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlin.test.AfterTest
import kotlin.test.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
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
    fun `the public constructor checks the device's wallets`() {
        assertEquals(WalletAvailability.CERTIFIED, MwaSeekerLink(mwa.host).walletAvailability(mwa.config))
    }

    @Test
    fun `an unverified wallet declaring the first-connect App Link is not treated as certified`() = runBlocking {
        mwa.scriptInstalledWallets(certified = false, generic = true)
        mwa.installUnverifiedWallet(mwa.config.firstConnectWalletBaseUri)
        assertEquals(WalletAvailability.OTHER, mwa.link.walletAvailability(mwa.config))
        transact { }
        assertEquals(listOf<String?>(null), mwa.targetedBaseUris())
    }

    @Test
    fun `sends the dapp identity, chain, and sign-in payload`() = runBlocking {
        transact { it.authorize(signInPayload = SeekerSignInPayload(statement = "hi", resources = listOf("https://dapp.example.com/terms"))) }
        val (method, params) = mwa.requests.single()
        assertEquals(ProtocolContract.METHOD_AUTHORIZE, method)
        val identity = params.getJSONObject(ProtocolContract.PARAMETER_IDENTITY)
        assertEquals("Test Dapp", identity.getString(ProtocolContract.PARAMETER_IDENTITY_NAME))
        assertEquals("https://dapp.example.com", identity.getString(ProtocolContract.PARAMETER_IDENTITY_URI))
        assertEquals("favicon.ico", identity.getString(ProtocolContract.PARAMETER_IDENTITY_ICON))
        assertEquals("solana:mainnet", params.getString(ProtocolContract.PARAMETER_CHAIN))
        val signIn = params.getJSONObject(ProtocolContract.PARAMETER_SIGN_IN_PAYLOAD)
        assertEquals("dapp.example.com", signIn.getString("domain"))
        assertEquals("hi", signIn.getString("statement"))
    }

    @Test
    fun `sends the sign-and-send options`() = runBlocking {
        transact {
            it.authorize()
            it.signAndSendTransactions(listOf(byteArrayOf(1)), SeekerSignAndSendOptions(minContextSlot = 7, commitment = "confirmed"))
        }
        val options = mwa.requests.last().second.getJSONObject(ProtocolContract.PARAMETER_OPTIONS)
        assertEquals(7, options.getInt(ProtocolContract.PARAMETER_OPTIONS_MIN_CONTEXT_SLOT))
        assertEquals("confirmed", options.getString(ProtocolContract.PARAMETER_OPTIONS_COMMITMENT))
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
        assertEquals(Code.ASSOCIATION_FAILED, assertFailsWith<SeekerConnectException> { session.await() }.code)
    }

    @Test
    fun `fails with no-wallet-found when the wallet cannot be launched`() = runBlocking {
        val host = Robolectric.buildActivity(UnlaunchableActivity::class.java).setup().get()
        val error = assertFailsWith<SeekerConnectException> { mwa.link.transact(host, mwa.config, null) { } }
        assertEquals(Code.NO_WALLET_FOUND, error.code)
    }

    @Test
    fun `works when called off the main thread`() = runBlocking {
        val session = async(Dispatchers.Default) { transact { "done" } }
        while (!session.isCompleted) {
            shadowOf(Looper.getMainLooper()).idle()
            delay(5)
        }
        assertEquals("done", session.await())
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
}
