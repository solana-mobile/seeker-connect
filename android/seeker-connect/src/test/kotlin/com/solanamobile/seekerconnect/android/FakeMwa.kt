package com.solanamobile.seekerconnect.android

import android.app.Activity
import android.app.Application
import android.content.ComponentName
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ActivityInfo
import android.content.pm.ResolveInfo
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.test.core.app.ApplicationProvider
import com.solana.mobilewalletadapter.clientlib.protocol.MobileWalletAdapterClient
import com.solana.mobilewalletadapter.clientlib.protocol.MobileWalletAdapterSession
import com.solana.mobilewalletadapter.clientlib.scenario.LocalAssociationScenario
import com.solana.mobilewalletadapter.common.AssociationContract
import com.solana.mobilewalletadapter.common.ProtocolContract
import com.solana.mobilewalletadapter.common.protocol.SessionProperties
import com.solana.mobilewalletadapter.common.protocol.SessionProperties.ProtocolVersion
import com.solana.mobilewalletadapter.common.util.Base58
import com.solana.mobilewalletadapter.common.util.NotifyOnCompleteFuture
import com.solana.mobilewalletadapter.common.util.NotifyingCompletableFuture
import com.solanamobile.seekerconnect.DappIdentity
import com.solanamobile.seekerconnect.SeekerAccount
import com.solanamobile.seekerconnect.SeekerConnectConfig
import com.solanamobile.seekerconnect.SeekerSignInResult
import com.solanamobile.seekerconnect.SeekerWalletCapabilities
import com.solanamobile.seekerconnect.testing.ObservedAuthorizeRequest
import com.solanamobile.seekerconnect.testing.SeekerLinkContractContext
import com.solanamobile.seekerconnect.testing.SeekerLinkContractExpectations
import com.solanamobile.seekerconnect.testing.SeekerLinkContractObservations
import org.json.JSONArray
import org.json.JSONObject
import org.robolectric.Robolectric
import org.robolectric.Shadows.shadowOf
import java.io.Closeable
import java.io.IOException
import java.util.Base64
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/**
 * The adapter's boundary, faked: each association hands the adapter a real
 * clientlib client whose requests are answered from a script. No wallet,
 * socket, or session crypto is involved.
 */
class FakeMwa : SeekerLinkContractContext<ComponentActivity>, SeekerLinkContractObservations, Closeable {
    private val app: Application = ApplicationProvider.getApplicationContext()
    private val packageManager = shadowOf(app.packageManager)
    private val replies = Executors.newSingleThreadExecutor()

    override val host: ComponentActivity = Robolectric.buildActivity(ComponentActivity::class.java).setup().get()
    override val link = MwaSeekerLink(app) { FakeScenario() }
    override val config = SeekerConnectConfig(DappIdentity("Test Dapp", "https://dapp.example.com", "favicon.ico"))
    override val observed: SeekerLinkContractObservations get() = this
    override val expected = SeekerLinkContractExpectations(
        accounts = listOf(SeekerAccount(Base58.encode(PUBLIC_KEY), PUBLIC_KEY, ACCOUNT_LABEL)),
        authToken = "fake-auth-token",
        walletUriBase = "https://wallet.example.com",
        capabilities = SeekerWalletCapabilities(
            maxMessagesPerRequest = 5,
            maxTransactionsPerRequest = 7,
            supportedTransactionVersions = listOf("legacy", 0),
            // clientlib reports sign-and-send support only when it is listed as a feature.
            features = listOf(ProtocolContract.FEATURE_ID_SIGN_TRANSACTIONS, ProtocolContract.FEATURE_ID_SIGN_AND_SEND_TRANSACTIONS),
            supportsSignAndSendTransactions = true,
        ),
        signedPayload = { it + ByteArray(64) { 9 } },
        transactionSignature = { payload -> ByteArray(64) { payload.size.toByte() } },
        messageSignature = { ByteArray(64) { 9 } },
        signInResult = SeekerSignInResult(Base58.encode(PUBLIC_KEY), PUBLIC_KEY, "signed".encodeToByteArray(), ByteArray(64) { 7 }),
    )

    /** The wallet reports 0 (no limit) for both per-request maximums. */
    @Volatile var unlimitedRequests = false

    /** The protocol version every session negotiates. */
    @Volatile var protocolVersion = ProtocolVersion.V1

    /** The wallet drops the session instead of answering signing requests. */
    @Volatile var dropSessionOnSigning = false

    @Volatile private var responsive = true
    @Volatile private var declineNextAuthorize = false
    @Volatile private var declineSigning = false
    @Volatile private var signInSupported = true

    /** Every request the wallet received, in order: method to params. */
    val requests = CopyOnWriteArrayList<Pair<String, JSONObject>>()

    private val opened = AtomicInteger()
    private val started = AtomicInteger()
    private val open = AtomicInteger()
    private val launches = mutableListOf<Intent>()
    private val messageAddresses = CopyOnWriteArrayList<List<String>>()
    private val authorizeRequests = CopyOnWriteArrayList<ObservedAuthorizeRequest>()
    private val deauthorizedTokens = CopyOnWriteArrayList<String>()
    private val installed = mutableSetOf<ComponentName>()
    private val scriptedResolutions = mutableListOf<Pair<Intent, String>>()

    init {
        install(BROWSER, filter("https"))
        scriptInstalledWallets(certified = true, generic = true)
    }

    override fun scriptInstalledWallets(certified: Boolean, generic: Boolean, walletUriBases: Set<String>) {
        installed.filter { it.packageName != BROWSER }.forEach { packageManager.clearIntentFilterForActivity(it) }
        scriptedResolutions.forEach { (intent, packageName) -> packageManager.removeResolveInfosForIntent(intent, packageName) }
        scriptedResolutions.clear()
        val baseUris = walletUriBases + if (certified) setOf(config.firstConnectWalletBaseUri) else emptySet()
        if (baseUris.isNotEmpty()) {
            install(
                CERTIFIED_WALLET,
                filter(AssociationContract.SCHEME_MOBILE_WALLET_ADAPTER),
                *baseUris.map { filter("https", Uri.parse(it).host) }.toTypedArray(),
            )
            baseUris.forEach { systemOpens(it, CERTIFIED_WALLET) }
        }
        if (generic) install(OTHER_WALLET, filter(AssociationContract.SCHEME_MOBILE_WALLET_ADAPTER))
    }

    /** Installs an MWA wallet that declares [baseUri]'s App Link without being its verified handler. */
    fun installUnverifiedWallet(baseUri: String) {
        install(UNVERIFIED_WALLET, filter(AssociationContract.SCHEME_MOBILE_WALLET_ADAPTER), filter("https", Uri.parse(baseUri).host))
        systemOpens(baseUri, BROWSER)
    }

    /**
     * Scripts which app the system opens for [baseUri]'s association URI.
     * App Link verification decides this on a device; Robolectric does not model it.
     */
    private fun systemOpens(baseUri: String, packageName: String) {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(baseUri).buildUpon().appendEncodedPath(AssociationContract.LOCAL_PATH_SUFFIX).build())
            .addCategory(Intent.CATEGORY_BROWSABLE)
        val resolveInfo = ResolveInfo().apply {
            activityInfo = ActivityInfo().apply {
                this.packageName = packageName
                name = "$packageName.MainActivity"
            }
        }
        packageManager.addResolveInfoForIntent(intent, resolveInfo)
        scriptedResolutions += intent to packageName
    }

    override fun scriptAuthorizeDecline() {
        declineNextAuthorize = true
    }

    override fun scriptSigningDecline() {
        declineSigning = true
    }

    override fun scriptNoSignInSupport() {
        signInSupported = false
    }

    override fun scriptUnresponsiveWallet() {
        responsive = false
    }

    override fun sessionsOpened() = opened.get()

    override fun sessionsStarted() = started.get()

    override fun openSessions() = open.get()

    override fun signedMessageAddresses(): List<List<String>> = messageAddresses.toList()

    override fun targetedBaseUris(): List<String?> = launches().map { intent ->
        val uri = intent.data!!
        if (uri.scheme == AssociationContract.SCHEME_MOBILE_WALLET_ADAPTER) {
            null
        } else {
            uri.buildUpon().clearQuery().path(uri.path!!.removeSuffix("/" + AssociationContract.LOCAL_PATH_SUFFIX)).toString()
        }
    }

    /** The package each wallet launch was pinned to, in order; null when the system picks. */
    fun launchedPackages(): List<String?> = launches().map { it.`package` }

    /** Activity-result keys [activity] has registered. */
    fun registeredResultKeys(activity: ComponentActivity = host): List<String> =
        savedRegistry(activity).getStringArrayList("KEY_COMPONENT_ACTIVITY_REGISTERED_KEYS").orEmpty()

    /** The wallet finishes now; true when its result still reaches a session's launcher callback. */
    fun walletResultReachesASession(): Boolean {
        shadowOf(host).receiveResult(launches().last(), Activity.RESULT_CANCELED, null)
        // Results with no callback to take them are parked as pending.
        return savedRegistry(host).getBundle("KEY_COMPONENT_ACTIVITY_PENDING_RESULT")!!.isEmpty
    }

    private fun savedRegistry(activity: ComponentActivity) = Bundle().also(activity.activityResultRegistry::onSaveInstanceState)

    private fun launches(): List<Intent> {
        // Robolectric hands back the newest launch first.
        launches += generateSequence { shadowOf(host).nextStartedActivityForResult?.intent }.toList().asReversed()
        return launches.toList()
    }

    override fun authorizeRequests(): List<ObservedAuthorizeRequest> = authorizeRequests.toList()

    override fun deauthorizedTokens(): List<String> = deauthorizedTokens.toList()

    override fun close() {
        replies.shutdownNow()
    }

    private fun install(packageName: String, vararg filters: IntentFilter) {
        val activity = ComponentName(packageName, "$packageName.MainActivity")
        packageManager.addActivityIfNotPresent(activity)
        installed += activity
        filters.forEach { packageManager.addIntentFilterForActivity(activity, it) }
    }

    private fun filter(scheme: String, host: String? = null) = IntentFilter(Intent.ACTION_VIEW).apply {
        addCategory(Intent.CATEGORY_DEFAULT)
        addCategory(Intent.CATEGORY_BROWSABLE)
        addDataScheme(scheme)
        host?.let { addDataAuthority(it, null) }
    }

    private inner class FakeScenario : LocalAssociationScenario(CLIENT_TIMEOUT_MS) {
        private val client = MobileWalletAdapterClient(CLIENT_TIMEOUT_MS)
        private val established = NotifyingCompletableFuture<MobileWalletAdapterClient>()
        private val fakeSession = object : MobileWalletAdapterSession(client, null) {
            override fun getSessionProperties() = SessionProperties(protocolVersion)
        }
        private var running = false
        private var closed = false
        @Volatile private var dropped = false

        override fun getSession() = fakeSession

        @Synchronized
        override fun start(): NotifyOnCompleteFuture<MobileWalletAdapterClient> {
            running = true
            started.incrementAndGet()
            open.incrementAndGet()
            if (responsive) {
                client.receiverConnected { message ->
                    if (dropped) throw IOException("disconnected")
                    answer(JSONObject(message.decodeToString()))
                }
                opened.incrementAndGet()
                established.complete(client)
            }
            return established
        }

        @Synchronized
        override fun close(): NotifyOnCompleteFuture<Void> {
            if (running && !closed) open.decrementAndGet()
            closed = true
            established.completeExceptionally(ConnectionFailedException("Scenario closed while connecting"))
            return NotifyingCompletableFuture<Void>().apply { complete(null) }
        }

        private fun answer(request: JSONObject) {
            val method = request.getString("method")
            val params = request.optJSONObject("params") ?: JSONObject()
            requests += method to params
            if (dropSessionOnSigning && method.startsWith("sign_")) {
                dropped = true
                replies.execute { client.receiverDisconnected() }
                return
            }
            val reply = JSONObject().put("jsonrpc", "2.0").put("id", request.getInt("id"))
            when (val result = respond(method, params)) {
                is Int -> reply.put("error", JSONObject().put("code", result).put("message", "scripted"))
                else -> reply.put("result", result)
            }
            replies.execute { client.receiverMessageReceived(reply.toString().encodeToByteArray()) }
        }
    }

    /** The scripted reply: a JSON result, or an Int MWA error code. */
    private fun respond(method: String, params: JSONObject): Any = when (method) {
        ProtocolContract.METHOD_AUTHORIZE -> {
            authorizeRequests += ObservedAuthorizeRequest(
                params.optStringOrNull(ProtocolContract.PARAMETER_AUTH_TOKEN),
                params.optStringOrNull(ProtocolContract.PARAMETER_CHAIN),
                params.has(ProtocolContract.PARAMETER_SIGN_IN_PAYLOAD),
            )
            if (declineNextAuthorize) {
                declineNextAuthorize = false
                ProtocolContract.ERROR_AUTHORIZATION_FAILED
            } else {
                authorization(signIn = params.has(ProtocolContract.PARAMETER_SIGN_IN_PAYLOAD) && signInSupported)
            }
        }
        ProtocolContract.METHOD_REAUTHORIZE -> {
            authorizeRequests += ObservedAuthorizeRequest(params.getString(ProtocolContract.PARAMETER_AUTH_TOKEN), null, false)
            authorization(signIn = false)
        }
        ProtocolContract.METHOD_DEAUTHORIZE -> {
            deauthorizedTokens += params.getString(ProtocolContract.PARAMETER_AUTH_TOKEN)
            JSONObject()
        }
        ProtocolContract.METHOD_GET_CAPABILITIES -> JSONObject()
            .put(ProtocolContract.RESULT_MAX_TRANSACTIONS_PER_REQUEST, if (unlimitedRequests) 0 else expected.capabilities.maxTransactionsPerRequest)
            .put(ProtocolContract.RESULT_MAX_MESSAGES_PER_REQUEST, if (unlimitedRequests) 0 else expected.capabilities.maxMessagesPerRequest)
            .put(ProtocolContract.RESULT_SUPPORTED_TRANSACTION_VERSIONS, JSONArray(expected.capabilities.supportedTransactionVersions))
            .put(ProtocolContract.RESULT_SUPPORTED_FEATURES, JSONArray(expected.capabilities.features))
            .put(ProtocolContract.RESULT_SUPPORTS_SIGN_AND_SEND_TRANSACTIONS, true)
        ProtocolContract.METHOD_SIGN_MESSAGES, ProtocolContract.METHOD_SIGN_TRANSACTIONS ->
            if (declineSigning) {
                ProtocolContract.ERROR_NOT_SIGNED
            } else {
                if (method == ProtocolContract.METHOD_SIGN_MESSAGES) {
                    val addresses = params.getJSONArray(ProtocolContract.PARAMETER_ADDRESSES)
                    messageAddresses += List(addresses.length()) { Base58.encode(Base64.getDecoder().decode(addresses.getString(it))) }
                }
                JSONObject().put(ProtocolContract.RESULT_SIGNED_PAYLOADS, payloads(params).map(expected.signedPayload).toBase64Array())
            }
        ProtocolContract.METHOD_SIGN_AND_SEND_TRANSACTIONS ->
            if (declineSigning) {
                ProtocolContract.ERROR_NOT_SIGNED
            } else {
                JSONObject().put(ProtocolContract.RESULT_SIGNATURES, payloads(params).map(expected.transactionSignature).toBase64Array())
            }
        else -> error("unscripted method $method")
    }

    private fun authorization(signIn: Boolean) = JSONObject()
        .put(ProtocolContract.RESULT_AUTH_TOKEN, expected.authToken)
        .put(
            ProtocolContract.RESULT_ACCOUNTS,
            JSONArray().put(
                JSONObject()
                    .put(ProtocolContract.RESULT_ACCOUNTS_ADDRESS, PUBLIC_KEY.toBase64())
                    .put(ProtocolContract.RESULT_ACCOUNTS_LABEL, ACCOUNT_LABEL),
            ),
        )
        .put(ProtocolContract.RESULT_WALLET_URI_BASE, expected.walletUriBase)
        .apply {
            if (signIn) {
                put(
                    ProtocolContract.RESULT_SIGN_IN,
                    JSONObject()
                        .put(ProtocolContract.RESULT_SIGN_IN_ADDRESS, expected.signInResult.publicKey.toBase64())
                        .put(ProtocolContract.RESULT_SIGN_IN_SIGNED_MESSAGE, expected.signInResult.signedMessage.toBase64())
                        .put(ProtocolContract.RESULT_SIGN_IN_SIGNATURE, expected.signInResult.signature.toBase64())
                        .put(ProtocolContract.RESULT_SIGN_IN_SIGNATURE_TYPE, "ed25519"),
                )
            }
        }

    private fun payloads(params: JSONObject): List<ByteArray> {
        val payloads = params.getJSONArray(ProtocolContract.PARAMETER_PAYLOADS)
        return List(payloads.length()) { Base64.getDecoder().decode(payloads.getString(it)) }
    }

    private fun ByteArray.toBase64(): String = Base64.getEncoder().encodeToString(this)

    private fun List<ByteArray>.toBase64Array() = JSONArray(map { it.toBase64() })

    private fun JSONObject.optStringOrNull(key: String) = if (has(key)) getString(key) else null

    companion object {
        val PUBLIC_KEY = ByteArray(32) { it.toByte() }
        const val ACCOUNT_LABEL = "Test Account"
        const val CLIENT_TIMEOUT_MS = 5_000
        private const val CERTIFIED_WALLET = "com.example.certifiedwallet"
        private const val OTHER_WALLET = "com.example.otherwallet"
        private const val UNVERIFIED_WALLET = "com.example.unverifiedwallet"
        private const val BROWSER = "com.example.browser"
    }
}
