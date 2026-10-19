package com.solanamobile.seekerconnect.reactnative

import android.util.Base64
import android.view.View
import android.view.ViewGroup
import androidx.activity.ComponentActivity
import androidx.test.core.app.ApplicationProvider
import com.facebook.react.bridge.BridgeReactContext
import com.facebook.react.bridge.JavaOnlyArray
import com.facebook.react.bridge.JavaOnlyMap
import com.solanamobile.seekerconnect.MemoryAuthorizationCache
import com.solanamobile.seekerconnect.SeekerConnect
import com.solanamobile.seekerconnect.SeekerConnectException
import com.solanamobile.seekerconnect.SeekerConnectException.Code
import com.solanamobile.seekerconnect.WalletAvailability
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue

@RunWith(RobolectricTestRunner::class)
class SeekerConnectModuleTest {
    private val context = BridgeReactContext(ApplicationProvider.getApplicationContext())
    private val link = ScriptedLink()
    private val module = SeekerConnectModule(
        context,
        newClient = { config -> SeekerConnect(seekerConnectConfig(config), link, MemoryAuthorizationCache()) },
        values = BridgeValues(::JavaOnlyMap, ::JavaOnlyArray),
    )
    // A React Native activity has its content view set, which is what gives the cards' ComposeView its lifecycle owner.
    private val activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().get().apply { setContentView(View(this)) }

    private val config = JavaOnlyMap.of("identity", JavaOnlyMap.of("name", "Dapp", "uri", "https://dapp.example.com"))

    private fun call(invoke: (RecordingPromise) -> Unit) = RecordingPromise().also(invoke).await()

    private fun b64(vararg bytes: Int) = Base64.encodeToString(ByteArray(bytes.size) { bytes[it].toByte() }, Base64.NO_WRAP)

    @BeforeTest
    fun configure() {
        call { module.configure(config, it) }
        context.onHostResume(activity)
    }

    @Test
    fun `rejects with NOT_CONFIGURED before configure`() {
        val fresh = SeekerConnectModule(context, { error("unused") }, BridgeValues(::JavaOnlyMap, ::JavaOnlyArray))
        assertEquals(SeekerConnectModule.NOT_CONFIGURED, call { fresh.restore(it) }.code)
    }

    @Test
    fun `configure rejects a config without an identity instead of throwing`() {
        assertEquals(SeekerConnectModule.INVALID_ARGUMENT, call { module.configure(JavaOnlyMap(), it) }.code)
    }

    @Test
    fun `reports wallet availability by name`() {
        link.availability = WalletAvailability.OTHER
        assertEquals("OTHER", call { module.walletAvailability(it) }.value)
    }

    @Test
    fun `restore resolves null when nothing is cached`() {
        assertNull(call { module.restore(it) }.value)
    }

    @Test
    fun `connect launches from the current activity and resolves the authorization`() {
        val authorization = call { module.connect(it) }.value as JavaOnlyMap
        assertSame(activity, link.hosts.single())
        assertEquals("token", authorization.getString("authToken"))
        assertEquals("https://wallet.example.com", authorization.getString("walletUriBase"))
        val account = authorization.getArray("accounts")!!.getMap(0)!!
        assertEquals("Addr1", account.getString("address"))
        assertEquals(b64(1, 2, 3), account.getString("publicKey"))
        assertEquals("Main", account.getString("label"))
        val capabilities = authorization.getMap("capabilities")!!
        assertEquals(3, capabilities.getInt("maxMessagesPerRequest"))
        assertEquals(4, capabilities.getInt("maxTransactionsPerRequest"))
        assertEquals("legacy", capabilities.getArray("supportedTransactionVersions")!!.getString(0))
        assertEquals(0, capabilities.getArray("supportedTransactionVersions")!!.getInt(1))
        assertTrue(capabilities.getBoolean("supportsSignAndSendTransactions"))
        // A connected app restores without another wallet session.
        assertEquals("token", (call { module.restore(it) }.value as JavaOnlyMap).getString("authToken"))
        assertEquals(1, link.sessions)
    }

    @Test
    fun `wallet interactions host the Seeker Connect cards over the app's content, once`() {
        call { module.connect(it) }
        call { module.signTransactions(JavaOnlyArray.of(b64(1)), it) }
        val content = activity.findViewById<ViewGroup>(android.R.id.content)
        val hosted = (0 until content.childCount).count { content.getChildAt(it).tag == "SeekerConnectDialogs" }
        assertEquals(1, hosted)
    }

    @Test
    fun `rejects with NO_ACTIVITY when no activity is in the foreground`() {
        context.onHostDestroy()
        assertEquals(SeekerConnectModule.NO_ACTIVITY, call { module.connect(it) }.code)
        assertEquals(0, link.sessions)
    }

    @Test
    fun `rejects with the SDK's error code`() {
        link.failure = SeekerConnectException(Code.AUTHORIZATION_DECLINED, "declined")
        assertEquals("AUTHORIZATION_DECLINED", call { module.connect(it) }.code)
    }

    @Test
    fun `signs in with the payload and resolves the proof`() {
        val payload = JavaOnlyMap.of("statement", "hi", "nonce", "abcdefgh12")
        val result = call { module.signIn(payload, it) }.value as JavaOnlyMap
        assertEquals("hi", link.signInPayloads.single()!!.statement)
        assertEquals("abcdefgh12", link.signInPayloads.single()!!.nonce)
        assertEquals("Addr1", result.getString("address"))
        assertEquals(b64(4, 5), result.getString("signedMessage"))
        assertEquals(b64(6, 7), result.getString("signature"))
    }

    @Test
    fun `decodes payloads and encodes the signed results`() {
        val signed = call { module.signMessages(JavaOnlyArray.of("Addr1"), JavaOnlyArray.of(b64(5)), it) }.value as JavaOnlyArray
        assertEquals(listOf("Addr1"), link.signedAddresses.single())
        assertEquals(b64(5, 1), signed.getString(0))
        val transactions = call { module.signTransactions(JavaOnlyArray.of(b64(7)), it) }.value as JavaOnlyArray
        assertEquals(b64(7, 2), transactions.getString(0))
    }

    @Test
    fun `forwards every sign-and-send option`() {
        val options = JavaOnlyMap.of(
            "minContextSlot", 5,
            "commitment", "confirmed",
            "skipPreflight", true,
            "maxRetries", 2,
            "waitForCommitmentToSendNextTransaction", false,
        )
        val signatures = call { module.signAndSendTransactions(JavaOnlyArray.of(b64(1, 2)), options, it) }.value as JavaOnlyArray
        assertEquals(b64(9, 2), signatures.getString(0))
        val forwarded = link.sendOptions.single()!!
        assertEquals(5, forwarded.minContextSlot)
        assertEquals("confirmed", forwarded.commitment)
        assertEquals(true, forwarded.skipPreflight)
        assertEquals(2, forwarded.maxRetries)
        assertEquals(false, forwarded.waitForCommitmentToSendNextTransaction)
    }

    @Test
    fun `rejects instead of crashing when an option has the wrong type`() {
        val options = JavaOnlyMap.of("skipPreflight", "true")
        val promise = call { module.signAndSendTransactions(JavaOnlyArray.of(b64(1, 2)), options, it) }
        assertEquals(SeekerConnectModule.UNEXPECTED_ERROR, promise.code)
        assertTrue(link.sendOptions.isEmpty())
    }

    @Test
    fun `transact runs every request in one wallet session`() {
        val requests = JavaOnlyArray.of(
            JavaOnlyMap.of("method", "signMessages", "addresses", JavaOnlyArray.of("Addr1"), "payloads", JavaOnlyArray.of(b64(1))),
            JavaOnlyMap.of("method", "signTransactions", "payloads", JavaOnlyArray.of(b64(2))),
            JavaOnlyMap.of("method", "signAndSendTransactions", "payloads", JavaOnlyArray.of(b64(3))),
        )
        val results = call { module.transact(requests, it) }.value as JavaOnlyArray
        assertEquals(1, link.sessions)
        assertEquals(b64(1, 1), results.getArray(0)!!.getString(0))
        assertEquals(b64(2, 2), results.getArray(1)!!.getString(0))
        assertEquals(b64(9, 1), results.getArray(2)!!.getString(0))
        assertNull(link.sendOptions.single())
    }

    @Test
    fun `transact rejects an unknown request method`() {
        val requests = JavaOnlyArray.of(JavaOnlyMap.of("method", "deleteEverything"))
        assertEquals(SeekerConnectModule.INVALID_ARGUMENT, call { module.transact(requests, it) }.code)
    }

    @Test
    fun `disconnect forgets the authorization`() {
        call { module.connect(it) }
        assertNull(call { module.disconnect(it) }.value)
        assertNull(call { module.restore(it) }.value)
    }

    @Test
    fun `payload bytes survive the base64 round trip`() {
        val bytes = byteArrayOf(0, -1, 127, -128)
        assertContentEquals(bytes, JavaOnlyArray.of(Base64.encodeToString(bytes, Base64.NO_WRAP)).bytes().single())
    }
}
