package com.solanamobile.seekerconnect.testing

import com.solanamobile.seekerconnect.SeekerAccount
import com.solanamobile.seekerconnect.SeekerConnectConfig
import com.solanamobile.seekerconnect.SeekerConnectException
import com.solanamobile.seekerconnect.SeekerLink
import com.solanamobile.seekerconnect.SeekerSignInPayload
import com.solanamobile.seekerconnect.SeekerWalletCapabilities
import com.solanamobile.seekerconnect.WalletAvailability
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/** What the driver's wallet double is scripted to respond with. */
class SeekerLinkContractExpectations(
    /** Accounts the wallet double authorizes. */
    val accounts: List<SeekerAccount>,
    /** Auth token the wallet double issues on authorize. */
    val authToken: String,
    /** The endpoint-specific URI the wallet double hands out. */
    val walletUriBase: String,
    /** The `get_capabilities` response the wallet double reports. */
    val capabilities: SeekerWalletCapabilities,
    /** The deterministic transform the wallet double applies when signing a payload. */
    val signedPayload: (ByteArray) -> ByteArray,
    /** The signature bytes the wallet double reports for a submitted transaction. */
    val transactionSignature: (ByteArray) -> ByteArray,
)

/** One authorize request as the wallet double received it. */
data class ObservedAuthorizeRequest(
    val authToken: String?,
    val chain: String?,
    val hasSignInPayload: Boolean,
)

/** Wallet-double observations the driver must expose to the suite. */
interface SeekerLinkContractObservations {
    /** Sessions ever established, including ones since closed. */
    fun sessionsOpened(): Int

    /** Sessions currently open. */
    fun openSessions(): Int

    /** The wallet base URI targeted by each wallet launch, in order; null for the generic `solana-wallet:` scheme. */
    fun targetedBaseUris(): List<String?>

    fun authorizeRequests(): List<ObservedAuthorizeRequest>

    /** Auth tokens the wallet double has seen deauthorized, in order. */
    fun deauthorizedTokens(): List<String>
}

/** Everything one test needs, created fresh before each test. */
interface SeekerLinkContractContext<H> {
    /** The link under test, wired to the driver's wallet double. */
    val link: SeekerLink<H>

    /** What [link] launches the wallet from. */
    val host: H

    /** A config that connects successfully against the wallet double. */
    val config: SeekerConnectConfig

    val expected: SeekerLinkContractExpectations
    val observed: SeekerLinkContractObservations

    /**
     * Scripts which wallets the device has. By default a certified wallet is
     * installed: it handles the config's first-connect URI and the generic scheme.
     *
     * @param certified A certified wallet handles the first-connect URI.
     * @param generic Some wallet handles the generic `solana-wallet:` scheme.
     * @param walletUriBases Further base URIs a wallet handles, e.g. a learned one.
     */
    fun scriptInstalledWallets(certified: Boolean, generic: Boolean, walletUriBases: Set<String> = emptySet())

    /** Scripts the wallet double to decline the next authorize. */
    fun scriptAuthorizeDecline()

    /** Scripts the wallet double to decline every signing request. */
    fun scriptSigningDecline()

    /** Scripts the wallet double to ignore sign-in payloads, as wallets without Sign-In-With-Solana do. */
    fun scriptNoSignInSupport()

    /** Scripts the wallet double to never complete association. */
    fun scriptUnresponsiveWallet()
}

/**
 * Contract-test suite that every [SeekerLink] implementation must pass.
 * Subclass it in the implementation's tests and supply [createContext].
 */
abstract class SeekerLinkContractTest<H> {
    protected lateinit var context: SeekerLinkContractContext<H>

    /** Creates a fresh link and wallet double; runs before every test. */
    protected abstract fun createContext(): SeekerLinkContractContext<H>

    /** Releases whatever [createContext] created; runs after every test. */
    protected open fun releaseContext() {}

    @BeforeTest
    fun contractSetUp() {
        context = createContext()
    }

    @AfterTest
    fun contractTearDown() {
        releaseContext()
    }

    private suspend fun <T> transact(
        config: SeekerConnectConfig = context.config,
        walletUriBase: String? = null,
        block: suspend (com.solanamobile.seekerconnect.SeekerWallet) -> T,
    ): T = context.link.transact(context.host, config, walletUriBase, block)

    // session lifecycle

    @Test
    fun `runs the block against an established session and returns its result`() = runBlocking {
        assertEquals("block-result", transact { "block-result" })
        assertEquals(1, context.observed.sessionsOpened())
    }

    @Test
    fun `closes the session once the block returns`() = runBlocking {
        transact { }
        assertEquals(0, context.observed.openSessions())
    }

    @Test
    fun `closes the session when the block throws, and rethrows`() = runBlocking {
        val failure = IllegalStateException("block failure")
        // Debug-mode stack-trace recovery may copy the exception, so compare by content.
        assertEquals(failure.message, assertFailsWith<IllegalStateException> { transact { throw failure } }.message)
        assertEquals(0, context.observed.openSessions())
    }

    @Test
    fun `establishes a fresh session for every transact`() = runBlocking {
        transact { }
        transact { }
        assertEquals(2, context.observed.sessionsOpened())
        assertEquals(0, context.observed.openSessions())
    }

    @Test
    fun `cancelling mid-association closes the session and propagates the cancellation`() = runBlocking {
        context.scriptUnresponsiveWallet()
        val session = async(start = CoroutineStart.UNDISPATCHED) { transact { } }
        delay(100)
        session.cancel()
        assertFailsWith<CancellationException> { session.await() }
        assertEquals(0, context.observed.openSessions())
    }

    @Test
    fun `cancelling during the block closes the session`() = runBlocking {
        val session = async(start = CoroutineStart.UNDISPATCHED) { transact { delay(Long.MAX_VALUE) } }
        while (context.observed.sessionsOpened() == 0) delay(10)
        session.cancel()
        assertFailsWith<CancellationException> { session.await() }
        assertEquals(0, context.observed.openSessions())
    }

    // wallet targeting

    @Test
    fun `targets the first-connect URI when a certified wallet handles it`() = runBlocking {
        transact { }
        assertEquals(listOf<String?>(context.config.firstConnectWalletBaseUri), context.observed.targetedBaseUris())
    }

    @Test
    fun `targets a learned wallet URI over the first-connect URI`() = runBlocking {
        val learned = "https://learned.example.com"
        context.scriptInstalledWallets(certified = true, generic = true, walletUriBases = setOf(learned))
        transact(walletUriBase = learned) { }
        assertEquals(listOf<String?>(learned), context.observed.targetedBaseUris())
    }

    @Test
    fun `skips a learned wallet URI that no wallet handles`() = runBlocking {
        transact(walletUriBase = "https://uninstalled.example.com") { }
        assertEquals(listOf<String?>(context.config.firstConnectWalletBaseUri), context.observed.targetedBaseUris())
    }

    @Test
    fun `falls back to the generic scheme when no certified wallet is installed`() = runBlocking {
        context.scriptInstalledWallets(certified = false, generic = true)
        transact { }
        assertEquals(listOf<String?>(null), context.observed.targetedBaseUris())
    }

    @Test
    fun `fails with no-wallet-found, opening no session, when no wallet is installed`() = runBlocking {
        context.scriptInstalledWallets(certified = false, generic = false)
        val error = assertFailsWith<SeekerConnectException> { transact { } }
        assertEquals(SeekerConnectException.Code.NO_WALLET_FOUND, error.code)
        assertEquals(0, context.observed.sessionsOpened())
    }

    @Test
    fun `reports wallet availability without launching anything`() {
        assertEquals(WalletAvailability.CERTIFIED, context.link.walletAvailability(context.config))
        context.scriptInstalledWallets(certified = false, generic = true)
        assertEquals(WalletAvailability.OTHER, context.link.walletAvailability(context.config))
        context.scriptInstalledWallets(certified = false, generic = false)
        assertEquals(WalletAvailability.NONE, context.link.walletAvailability(context.config))
        assertEquals(0, context.observed.sessionsOpened())
    }

    // authorization

    @Test
    fun `returns the wallet-authorized accounts, consumer-shaped`() = runBlocking {
        assertEquals(context.expected.accounts, transact { it.authorize() }.accounts)
    }

    @Test
    fun `returns the wallet's auth token`() = runBlocking {
        assertEquals(context.expected.authToken, transact { it.authorize() }.authToken)
    }

    @Test
    fun `learns the wallet's endpoint-specific base URI`() = runBlocking {
        assertEquals(context.expected.walletUriBase, transact { it.authorize() }.walletUriBase)
    }

    @Test
    fun `forwards the configured chain to the wallet`() = runBlocking {
        transact(config = context.config.copy(chain = "solana:devnet")) { it.authorize() }
        assertEquals("solana:devnet", context.observed.authorizeRequests().single().chain)
    }

    @Test
    fun `forwards an explicit chain over the configured one`() = runBlocking {
        transact { it.authorize(chain = "solana:testnet") }
        assertEquals("solana:testnet", context.observed.authorizeRequests().single().chain)
    }

    @Test
    fun `reauthorizes with a stored auth token`() = runBlocking {
        transact { it.authorize(authToken = context.expected.authToken) }
        assertEquals(context.expected.authToken, context.observed.authorizeRequests().single().authToken)
    }

    @Test
    fun `returns the wallet's sign-in proof for a sign-in payload`() = runBlocking {
        val result = transact { it.authorize(signInPayload = SIGN_IN_PAYLOAD) }.signInResult
        assertSignInProof(result)
        assertEquals(true, context.observed.authorizeRequests().single().hasSignInPayload)
    }

    @Test
    fun `signs the sign-in message itself when the wallet lacks sign-in support`() = runBlocking {
        context.scriptNoSignInSupport()
        assertSignInProof(transact { it.authorize(signInPayload = SIGN_IN_PAYLOAD) }.signInResult)
    }

    @Test
    fun `deauthorizes a token with the wallet`() = runBlocking {
        transact { it.deauthorize(context.expected.authToken) }
        assertEquals(listOf(context.expected.authToken), context.observed.deauthorizedTokens())
    }

    // capabilities

    @Test
    fun `decodes the wallet's capabilities`() = runBlocking {
        assertEquals(context.expected.capabilities, transact { it.getCapabilities() })
    }

    // signing

    @Test
    fun `signMessages returns the signed payload bytes`() = runBlocking {
        val signed = transact {
            it.authorize()
            it.signMessages(listOf(context.expected.accounts.first().address), listOf(MESSAGE))
        }
        assertContentEquals(context.expected.signedPayload(MESSAGE), signed.single())
    }

    @Test
    fun `signTransactions returns the signed transaction bytes`() = runBlocking {
        val signed = transact {
            it.authorize()
            it.signTransactions(listOf(TRANSACTION))
        }
        assertContentEquals(context.expected.signedPayload(TRANSACTION), signed.single())
    }

    @Test
    fun `signAndSendTransactions returns the transaction signatures`() = runBlocking {
        val signatures = transact {
            it.authorize()
            it.signAndSendTransactions(listOf(TRANSACTION))
        }
        assertContentEquals(context.expected.transactionSignature(TRANSACTION), signatures.single())
    }

    // errors

    @Test
    fun `fails with association-failed when no wallet completes association`() = runBlocking {
        context.scriptUnresponsiveWallet()
        val error = assertFailsWith<SeekerConnectException> {
            transact(config = context.config.copy(associationTimeoutMs = 100)) { }
        }
        assertEquals(SeekerConnectException.Code.ASSOCIATION_FAILED, error.code)
        assertEquals(0, context.observed.openSessions())
    }

    @Test
    fun `fails with authorization-declined when the wallet declines`() = runBlocking {
        context.scriptAuthorizeDecline()
        val error = assertFailsWith<SeekerConnectException> { transact { it.authorize() } }
        assertEquals(SeekerConnectException.Code.AUTHORIZATION_DECLINED, error.code)
        assertEquals(0, context.observed.openSessions())
    }

    @Test
    fun `fails with request-declined when the wallet declines to sign`() = runBlocking {
        context.scriptSigningDecline()
        val error = assertFailsWith<SeekerConnectException> {
            transact {
                it.authorize()
                it.signTransactions(listOf(TRANSACTION))
            }
        }
        assertEquals(SeekerConnectException.Code.REQUEST_DECLINED, error.code)
        assertEquals(0, context.observed.openSessions())
    }

    private fun assertSignInProof(result: com.solanamobile.seekerconnect.SeekerSignInResult?) {
        assertNotNull(result)
        val account = context.expected.accounts.first()
        assertEquals(account.address, result.address)
        assertContentEquals(account.publicKey, result.publicKey)
        assertTrue(result.signedMessage.isNotEmpty())
        assertTrue(result.signature.isNotEmpty())
    }

    private companion object {
        val MESSAGE = byteArrayOf(10, 20, 30)
        val TRANSACTION = byteArrayOf(40, 50, 60, 70)
        val SIGN_IN_PAYLOAD = SeekerSignInPayload(domain = "dapp.example.com", statement = "hi")
    }
}
