package com.solanamobile.seekerconnect.example

import android.app.Application
import android.content.ComponentName
import android.content.Intent
import android.content.IntentFilter
import android.os.Looper
import androidx.activity.ComponentActivity
import androidx.test.core.app.ApplicationProvider
import kotlin.test.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

@RunWith(RobolectricTestRunner::class)
class MainViewModelTest {
    private val app: Application = ApplicationProvider.getApplicationContext()
    private val host = Robolectric.buildActivity(ComponentActivity::class.java).setup()
    private val viewModel = MainViewModel(app)
    private val log get() = viewModel.uiState.value.log
    private val busy get() = viewModel.uiState.value.busy

    @Test
    fun `reports a Seeker Connect failure by its code`() {
        viewModel.connect(host.get())
        settle { log.isNotEmpty() }
        assertEquals(listOf("connect failed: NO_WALLET_FOUND"), log)
        assertFalse(busy)
    }

    @Test
    fun `reports any other failure by its message`() {
        viewModel.signMessage(host.get())
        settle { log.isNotEmpty() }
        assertEquals(listOf("signMessage failed: not connected"), log)
        assertFalse(busy)
    }

    @Test
    fun `runs one action at a time, and destroying the host cancels its action`() {
        installWallet()
        viewModel.connect(host.get())
        // The wallet is launched but never associates, so connect stays in flight.
        settle { shadowOf(host.get()).peekNextStartedActivityForResult() != null }
        assertTrue(busy)
        viewModel.signMessage(host.get())
        host.pause().stop().destroy()
        settle { !busy }
        // connect was cancelled, which logs nothing, and signMessage never ran.
        assertEquals(emptyList(), log)

        viewModel.signMessage(Robolectric.buildActivity(ComponentActivity::class.java).setup().get())
        settle { log.isNotEmpty() }
        assertEquals(listOf("signMessage failed: not connected"), log)
    }

    /** Installs an app handling the generic Mobile Wallet Adapter scheme. */
    private fun installWallet() {
        val wallet = ComponentName("com.example.wallet", "com.example.wallet.MainActivity")
        val packageManager = shadowOf(app.packageManager)
        packageManager.addActivityIfNotPresent(wallet)
        packageManager.addIntentFilterForActivity(
            wallet,
            IntentFilter(Intent.ACTION_VIEW).apply {
                addCategory(Intent.CATEGORY_DEFAULT)
                addCategory(Intent.CATEGORY_BROWSABLE)
                addDataScheme("solana-wallet")
            },
        )
    }

    /** Runs the main looper until [done], for at most ten seconds. */
    private fun settle(done: () -> Boolean) {
        val deadline = System.currentTimeMillis() + 10_000
        while (!done()) {
            check(System.currentTimeMillis() < deadline) { "timed out" }
            shadowOf(Looper.getMainLooper()).idle()
            Thread.sleep(10)
        }
    }
}
