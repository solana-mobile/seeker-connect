package com.solanamobile.seekerconnect.android

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import com.solana.mobilewalletadapter.clientlib.scenario.LocalAssociationIntentCreator
import com.solana.mobilewalletadapter.clientlib.scenario.LocalAssociationScenario
import com.solana.mobilewalletadapter.clientlib.scenario.Scenario
import com.solana.mobilewalletadapter.common.AssociationContract
import com.solanamobile.seekerconnect.SeekerConnectConfig
import com.solanamobile.seekerconnect.SeekerConnectException
import com.solanamobile.seekerconnect.SeekerConnectException.Code
import com.solanamobile.seekerconnect.SeekerLink
import com.solanamobile.seekerconnect.SeekerWallet
import com.solanamobile.seekerconnect.WalletAvailability
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.util.UUID
import java.util.concurrent.Executor

/**
 * [SeekerLink] over MWA local association: the wallet serves a WebSocket on
 * localhost and the dapp connects to it.
 */
class MwaSeekerLink internal constructor(
    context: Context,
    private val newScenario: () -> LocalAssociationScenario,
) : SeekerLink<ComponentActivity> {
    constructor(context: Context) : this(context, { LocalAssociationScenario(Scenario.DEFAULT_CLIENT_TIMEOUT_MS) })

    private val packageManager = context.applicationContext.packageManager

    override fun walletAvailability(config: SeekerConnectConfig): WalletAvailability = when {
        walletFor(config.firstConnectWalletBaseUri) != null -> WalletAvailability.CERTIFIED
        mwaWallets().isNotEmpty() -> WalletAvailability.OTHER
        else -> WalletAvailability.NONE
    }

    override suspend fun <T> transact(
        host: ComponentActivity,
        config: SeekerConnectConfig,
        walletUriBase: String?,
        block: suspend (SeekerWallet) -> T,
    ): T {
        val (endpointPrefix, walletPackage) = target(config, walletUriBase)
        val scenario = newScenario()
        val intent = LocalAssociationIntentCreator
            .createAssociationIntent(endpointPrefix, scenario.port, scenario.session)
            .setPackage(walletPackage)
        var launcher: ActivityResultLauncher<Intent>? = null
        // Main thread only: the wallet was launched and its result has not come back; the session has ended.
        var awaitingResult = false
        var ended = false
        try {
            val established = scenario.start()
            // Registered even if the caller is cancelled mid-switch, so the finally block can unregister it.
            val registered = withContext(NonCancellable) {
                onMain {
                    host.activityResultRegistry.register(
                        "seeker-connect-${UUID.randomUUID()}",
                        ActivityResultContracts.StartActivityForResult(),
                    ) {
                        awaitingResult = false
                        // The wallet returned before associating; association can no longer complete.
                        if (!established.isDone) scenario.close()
                        // Posted: the registry forgets a launched key only after this callback returns.
                        if (ended) mainHandler.post { launcher?.unregister() }
                    }
                }
            }
            launcher = registered
            onMain {
                try {
                    registered.launch(intent)
                    awaitingResult = true
                } catch (e: ActivityNotFoundException) {
                    throw SeekerConnectException(Code.NO_WALLET_FOUND, "No wallet handles the association intent", e)
                }
            }
            val client = withTimeoutOrNull(config.associationTimeoutMs) { established.await() }
                ?: throw SeekerConnectException(
                    Code.ASSOCIATION_FAILED,
                    "No wallet completed association within ${config.associationTimeoutMs} ms",
                )
            return block(MwaSeekerWallet(client, scenario.session.sessionProperties.protocolVersion, config))
        } finally {
            withContext(NonCancellable) {
                withTimeoutOrNull(CLOSE_TIMEOUT_MS) { scenario.close().await() }
                launcher?.let {
                    onMain {
                        ended = true
                        // Unregistering mid-launch strands the key and the late result in the host's registry,
                        // so a launch still out is unregistered by its callback once the result arrives.
                        if (!awaitingResult) it.unregister()
                    }
                }
            }
        }
    }

    /**
     * Where to launch: [walletUriBase], then the first-connect URI, each only
     * when the system opens it in an MWA wallet; then any MWA wallet through
     * the generic scheme.
     */
    private fun target(config: SeekerConnectConfig, walletUriBase: String?): Pair<Uri?, String?> {
        for (baseUri in listOfNotNull(walletUriBase, config.firstConnectWalletBaseUri)) {
            walletFor(baseUri)?.let { return Uri.parse(baseUri) to it }
        }
        if (mwaWallets().isEmpty()) {
            throw SeekerConnectException(Code.NO_WALLET_FOUND, "No Mobile Wallet Adapter wallet is installed")
        }
        return null to null
    }

    /**
     * The wallet the system opens for [baseUri]'s association URI. Resolution
     * honors App Link verification: an https URI resolves to a wallet only when
     * that wallet is its verified (or user-approved) handler; otherwise it
     * resolves to a browser or the chooser, which are not MWA wallets.
     */
    private fun walletFor(baseUri: String): String? =
        packageManager.resolveActivity(viewIntent(associationUri(Uri.parse(baseUri))), PackageManager.MATCH_DEFAULT_ONLY)
            ?.activityInfo?.packageName
            ?.takeIf { it in mwaWallets() }

    private fun mwaWallets(): Set<String> = packageManager
        .queryIntentActivities(viewIntent(associationUri(null)), PackageManager.MATCH_DEFAULT_ONLY)
        .map { it.activityInfo.packageName }
        .toSet()

    private fun viewIntent(uri: Uri) = Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)

    /** The local association URI as clientlib builds it, minus the per-session query; null [endpointPrefix] is the generic scheme. */
    private fun associationUri(endpointPrefix: Uri?): Uri =
        (endpointPrefix?.buildUpon()?.clearQuery()?.fragment(null)
            ?: Uri.Builder().scheme(AssociationContract.SCHEME_MOBILE_WALLET_ADAPTER))
            .appendEncodedPath(AssociationContract.LOCAL_PATH_SUFFIX)
            .build()

    private companion object {
        const val CLOSE_TIMEOUT_MS = 5_000L

        val mainHandler = Handler(Looper.getMainLooper())
        val mainDispatcher = Executor(mainHandler::post).asCoroutineDispatcher()

        /** Runs [action] on the main thread, as the activity-result APIs require; immediately when already there. */
        suspend fun <R> onMain(action: () -> R): R =
            if (Looper.myLooper() == Looper.getMainLooper()) action() else withContext(mainDispatcher) { action() }
    }
}
