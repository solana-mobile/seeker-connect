package com.solanamobile.seekerconnect.reactnative

import android.view.View
import android.view.ViewGroup
import androidx.activity.ComponentActivity
import androidx.compose.ui.platform.ComposeView
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.solanamobile.seekerconnect.SeekerConnect
import com.solanamobile.seekerconnect.SeekerConnectException
import com.solanamobile.seekerconnect.SeekerWallet
import com.solanamobile.seekerconnect.android.MwaSeekerLink
import com.solanamobile.seekerconnect.android.SharedPreferencesAuthorizationCache
import com.solanamobile.seekerconnect.compose.SeekerConnectDialogState
import com.solanamobile.seekerconnect.compose.SeekerConnectDialogs
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * The `SeekerConnect` native module: a thin bridge to the Android Seeker
 * Connect SDK. Byte payloads cross the bridge as base64 strings.
 */
class SeekerConnectModule internal constructor(
    reactContext: ReactApplicationContext,
    private val newClient: (config: ReadableMap) -> SeekerConnect<ComponentActivity>,
    private val values: BridgeValues,
) : ReactContextBaseJavaModule(reactContext) {
    constructor(reactContext: ReactApplicationContext) : this(
        reactContext,
        newClient = { config -> newSdkClient(reactContext, config) },
        values = BridgeValues(Arguments::createMap, Arguments::createArray),
    )

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var client: SeekerConnect<ComponentActivity>? = null

    override fun getName() = NAME

    @ReactMethod
    fun configure(config: ReadableMap, promise: Promise) {
        client = newClient(config)
        promise.resolve(null)
    }

    @ReactMethod
    fun walletAvailability(promise: Promise) = call(promise) { client ->
        client.walletAvailability().name
    }

    @ReactMethod
    fun restore(promise: Promise) = call(promise) { client ->
        client.restore()?.let(values::authorization)
    }

    @ReactMethod
    fun connect(promise: Promise) = callWithHost(promise) { client, host ->
        values.authorization(client.connect(host))
    }

    @ReactMethod
    fun signIn(payload: ReadableMap?, promise: Promise) = callWithHost(promise) { client, host ->
        values.signInResult(client.signIn(host, signInPayload(payload)))
    }

    @ReactMethod
    fun signMessages(addresses: ReadableArray, payloads: ReadableArray, promise: Promise) =
        callWithHost(promise) { client, host ->
            values.bytesArray(client.signMessages(host, addresses.strings(), payloads.bytes()))
        }

    @ReactMethod
    fun signTransactions(payloads: ReadableArray, promise: Promise) = callWithHost(promise) { client, host ->
        values.bytesArray(client.signTransactions(host, payloads.bytes()))
    }

    @ReactMethod
    fun signAndSendTransactions(payloads: ReadableArray, options: ReadableMap?, promise: Promise) =
        callWithHost(promise) { client, host ->
            values.bytesArray(client.signAndSendTransactions(host, payloads.bytes(), signAndSendOptions(options)))
        }

    /** Runs every request in one wallet session; resolves with one result per request, in order. */
    @ReactMethod
    fun transact(requests: ReadableArray, promise: Promise) = callWithHost(promise) { client, host ->
        val results = client.transact(host) {
            List(requests.size()) { index -> execute(requireNotNull(requests.getMap(index)) { "Request $index is not an object" }) }
        }
        values.newArray().apply { results.forEach(::pushArray) }
    }

    @ReactMethod
    fun disconnect(promise: Promise) = call(promise) { client ->
        client.disconnect()
        null
    }

    override fun invalidate() {
        scope.cancel()
        super.invalidate()
    }

    private suspend fun SeekerWallet.execute(request: ReadableMap): WritableArray = when (val method = request.getString("method")) {
        "signMessages" -> values.bytesArray(
            signMessages(request.requiredArray("addresses").strings(), request.requiredArray("payloads").bytes()),
        )
        "signTransactions" -> values.bytesArray(signTransactions(request.requiredArray("payloads").bytes()))
        "signAndSendTransactions" -> values.bytesArray(
            signAndSendTransactions(
                request.requiredArray("payloads").bytes(),
                signAndSendOptions(request.takeIf { it.hasKey("options") }?.getMap("options")),
            ),
        )
        else -> throw IllegalArgumentException("Unsupported transact request: $method")
    }

    private fun call(promise: Promise, action: suspend (SeekerConnect<ComponentActivity>) -> Any?) {
        val client = client ?: return promise.reject(NOT_CONFIGURED, "Call configure() first")
        scope.launch {
            try {
                promise.resolve(action(client))
            } catch (e: SeekerConnectException) {
                promise.reject(e.code.name, e.message, e)
            } catch (e: IllegalArgumentException) {
                promise.reject(INVALID_ARGUMENT, e.message, e)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                // Anything else (a mistyped bridge value, a bug) still settles the promise instead of crashing the app.
                promise.reject(UNEXPECTED_ERROR, e.message, e)
            }
        }
    }

    private fun callWithHost(
        promise: Promise,
        action: suspend (SeekerConnect<ComponentActivity>, ComponentActivity) -> Any?,
    ) {
        val host = reactApplicationContext.currentActivity as? ComponentActivity
            ?: return promise.reject(NO_ACTIVITY, "No foreground activity to launch the wallet from")
        host.runOnUiThread { attachDialogs(host) }
        call(promise) { client -> action(client, host) }
    }

    /** Hosts the Seeker Connect cards over the app's content, once per activity. */
    private fun attachDialogs(host: ComponentActivity) {
        val content = host.findViewById<ViewGroup>(android.R.id.content)
        if (content.findViewWithTag<View>(DIALOGS_TAG) != null) return
        content.addView(ComposeView(host).apply {
            tag = DIALOGS_TAG
            setContent { SeekerConnectDialogs(dialogs) }
        })
    }

    companion object {
        const val NAME = "SeekerConnect"
        const val NOT_CONFIGURED = "NOT_CONFIGURED"
        const val NO_ACTIVITY = "NO_ACTIVITY"
        const val INVALID_ARGUMENT = "INVALID_ARGUMENT"
        const val UNEXPECTED_ERROR = "UNEXPECTED_ERROR"
        private const val DIALOGS_TAG = "SeekerConnectDialogs"

        /** Shared by every client this module creates; drawn by the attached ComposeView. */
        internal val dialogs = SeekerConnectDialogState()

        private fun newSdkClient(context: ReactApplicationContext, config: ReadableMap) = SeekerConnect(
            seekerConnectConfig(config),
            MwaSeekerLink(context),
            SharedPreferencesAuthorizationCache(context),
            dialogs,
        )
    }
}
