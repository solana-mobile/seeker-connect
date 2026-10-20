package com.solanamobile.seekerconnect.reactnative

import com.facebook.react.bridge.JavaOnlyArray
import com.facebook.react.bridge.JavaOnlyMap
import com.solanamobile.seekerconnect.DEFAULT_ASSOCIATION_TIMEOUT_MS
import com.solanamobile.seekerconnect.DEFAULT_FIRST_CONNECT_WALLET_BASE_URI
import com.solanamobile.seekerconnect.DEFAULT_SEEKER_CHAIN
import com.solanamobile.seekerconnect.DappIdentity
import com.solanamobile.seekerconnect.SeekerConnectConfig
import com.solanamobile.seekerconnect.SeekerSignInPayload
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

@RunWith(RobolectricTestRunner::class)
class BridgeTest {
    @Test
    fun `reads every config field`() {
        val config = JavaOnlyMap.of(
            "identity", JavaOnlyMap.of("name", "Dapp", "uri", "https://dapp.example.com", "icon", "favicon.ico"),
            "chain", "solana:devnet",
            "firstConnectWalletBaseUri", "https://wallet.example.com",
            "associationTimeoutMs", 1500.0,
        )
        assertEquals(
            SeekerConnectConfig(
                DappIdentity("Dapp", "https://dapp.example.com", "favicon.ico"),
                chain = "solana:devnet",
                firstConnectWalletBaseUri = "https://wallet.example.com",
                associationTimeoutMs = 1500,
            ),
            seekerConnectConfig(config),
        )
    }

    @Test
    fun `defaults the optional config fields`() {
        val config = seekerConnectConfig(JavaOnlyMap.of("identity", JavaOnlyMap.of("name", "Dapp", "uri", "https://dapp.example.com")))
        assertNull(config.identity.icon)
        assertEquals(DEFAULT_SEEKER_CHAIN, config.chain)
        assertEquals(DEFAULT_FIRST_CONNECT_WALLET_BASE_URI, config.firstConnectWalletBaseUri)
        assertEquals(DEFAULT_ASSOCIATION_TIMEOUT_MS, config.associationTimeoutMs)
    }

    @Test
    fun `rejects a config without the identity's name or uri`() {
        assertFailsWith<IllegalArgumentException> { seekerConnectConfig(JavaOnlyMap()) }
        assertFailsWith<IllegalArgumentException> { seekerConnectConfig(JavaOnlyMap.of("identity", JavaOnlyMap.of("name", "Dapp"))) }
    }

    @Test
    fun `reads every sign-in field`() {
        val payload = JavaOnlyMap.of(
            "domain", "dapp.example.com",
            "address", "Addr1",
            "statement", "Sign in",
            "uri", "https://dapp.example.com/login",
            "version", "1",
            "chainId", "solana:mainnet",
            "nonce", "abcdefgh12",
            "issuedAt", "2026-10-16T00:00:00Z",
            "expirationTime", "2026-10-17T00:00:00Z",
            "notBefore", "2026-10-16T00:00:00Z",
            "requestId", "req-1",
            "resources", JavaOnlyArray.of("https://dapp.example.com/terms"),
        )
        assertEquals(
            SeekerSignInPayload(
                domain = "dapp.example.com",
                address = "Addr1",
                statement = "Sign in",
                uri = "https://dapp.example.com/login",
                version = "1",
                chainId = "solana:mainnet",
                nonce = "abcdefgh12",
                issuedAt = "2026-10-16T00:00:00Z",
                expirationTime = "2026-10-17T00:00:00Z",
                notBefore = "2026-10-16T00:00:00Z",
                requestId = "req-1",
                resources = listOf("https://dapp.example.com/terms"),
            ),
            signInPayload(payload),
        )
    }

    @Test
    fun `a missing sign-in payload is an empty one`() {
        assertEquals(SeekerSignInPayload(), signInPayload(null))
    }

    @Test
    fun `no sign-and-send options stay absent`() {
        assertNull(signAndSendOptions(null))
    }

    @Test
    fun `rejects a non-string where strings are expected`() {
        assertFailsWith<IllegalArgumentException> { JavaOnlyArray.of(null).strings() }
    }

    @Test
    fun `rejects a request without a required array`() {
        assertFailsWith<IllegalArgumentException> { JavaOnlyMap.of("method", "signTransactions").requiredArray("payloads") }
    }
}
