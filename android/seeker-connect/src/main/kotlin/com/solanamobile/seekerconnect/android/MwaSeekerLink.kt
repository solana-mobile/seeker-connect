package com.solanamobile.seekerconnect.android

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.activity.ComponentActivity
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
        val established = scenario.start()
        val launcher = onMain {
            host.activityResultRegistry.register(
                "seeker-connect-${UUID.randomUUID()}",
                ActivityResultContracts.StartActivityForResult(),
            ) {
                // The wallet returned before associating; association can no longer complete.
                if (!established.isDone) scenario.close()
            }
        }
        try {
            onMain {
                try {
                    launcher.launch(intent)
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
                onMain { launcher.unregister() }
            }
        }
    }

    /**
     * Where to launch: [walletUriBase], then the first-connect URI, each only
     * when a wallet handles it; then any MWA wallet through the generic scheme.
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
     * The wallet that handles [baseUri]'s association URI. Only packages that
     * also handle the MWA scheme count, so a browser never matches; when
     * several do, the first is launched.
     */
    private fun walletFor(baseUri: String): String? {
        val wallets = mwaWallets()
        return handlers(associationUri(Uri.parse(baseUri))).firstOrNull { it in wallets }
    }

    private fun mwaWallets(): Set<String> = handlers(associationUri(null)).toSet()

    private fun handlers(uri: Uri): List<String> = packageManager
        .queryIntentActivities(
            Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE),
            PackageManager.MATCH_DEFAULT_ONLY,
        )
        .map { it.activityInfo.packageName }

    /** The local association URI as clientlib builds it, minus the per-session query; null [endpointPrefix] is the generic scheme. */
    private fun associationUri(endpointPrefix: Uri?): Uri =
        (endpointPrefix?.buildUpon()?.clearQuery()?.fragment(null)
            ?: Uri.Builder().scheme(AssociationContract.SCHEME_MOBILE_WALLET_ADAPTER))
            .appendEncodedPath(AssociationContract.LOCAL_PATH_SUFFIX)
            .build()

    private companion object {
        const val CLOSE_TIMEOUT_MS = 5_000L

        val mainDispatcher = Executor(Handler(Looper.getMainLooper())::post).asCoroutineDispatcher()

        /** Runs [action] on the main thread, as the activity-result APIs require; immediately when already there. */
        suspend fun <R> onMain(action: () -> R): R =
            if (Looper.myLooper() == Looper.getMainLooper()) action() else withContext(mainDispatcher) { action() }
    }
}
