package com.solanamobile.seekerconnect.android

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.solanamobile.seekerconnect.SeekerAccount
import com.solanamobile.seekerconnect.SeekerWalletCapabilities
import com.solanamobile.seekerconnect.StoredAuthorization
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import kotlin.test.assertEquals
import kotlin.test.assertNull

@RunWith(RobolectricTestRunner::class)
class SharedPreferencesAuthorizationCacheTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val cache = SharedPreferencesAuthorizationCache(context)

    private val full = StoredAuthorization(
        accounts = listOf(SeekerAccount("Addr1", byteArrayOf(1, 2, 3), "Main"), SeekerAccount("Addr2", byteArrayOf(4))),
        authToken = "token",
        walletUriBase = "https://wallet.example.com",
        chain = "solana:mainnet",
        capabilities = SeekerWalletCapabilities(
            maxMessagesPerRequest = 3,
            maxTransactionsPerRequest = 4,
            supportedTransactionVersions = listOf("legacy", 0),
            features = listOf("solana:signTransactions"),
            supportsSignAndSendTransactions = true,
        ),
    )

    @Test
    fun `stores nothing until set`() = runTest {
        assertNull(cache.get())
    }

    @Test
    fun `round-trips every field, across instances`() = runTest {
        cache.set(full)
        assertEquals(full, SharedPreferencesAuthorizationCache(context).get())
    }

    @Test
    fun `round-trips absent optional fields`() = runTest {
        val minimal = full.copy(walletUriBase = null, capabilities = SeekerWalletCapabilities())
        cache.set(minimal)
        assertEquals(minimal, cache.get())
    }

    @Test
    fun `clear forgets the authorization`() = runTest {
        cache.set(full)
        cache.clear()
        assertNull(cache.get())
    }

    @Test
    fun `separate names are separate caches`() = runTest {
        cache.set(full)
        assertNull(SharedPreferencesAuthorizationCache(context, "other").get())
    }

    @Test
    fun `unreadable data reads as nothing stored`() = runTest {
        val unreadable = listOf(
            "not json",
            """{"version":2}""",
            """{"version":1,"capabilities":{},"accounts":[{"address":"a","publicKey":"a"}]}""",
        )
        for (json in unreadable) {
            preferences().edit().putString("authorization", json).commit()
            assertNull(cache.get(), json)
        }
    }

    private fun preferences() = context.getSharedPreferences("SeekerConnectAuthorizationCache", Context.MODE_PRIVATE)
}
