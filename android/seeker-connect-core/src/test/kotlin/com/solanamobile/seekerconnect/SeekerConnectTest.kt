package com.solanamobile.seekerconnect

import com.solanamobile.seekerconnect.SeekerConnectException.Code
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertSame

class SeekerConnectTest {
    private val config = SeekerConnectConfig(DappIdentity("Test Dapp", "https://dapp.example.com", "favicon.ico"))
    private val link = FakeSeekerLink()
    private val cache = MemoryAuthorizationCache()
    private val presenter = RecordingPresenter()
    private val client = SeekerConnect(config, link, cache, presenter)

    private val stored = StoredAuthorization(
        accounts = listOf(FAKE_ACCOUNT),
        authToken = "stored-token",
        walletUriBase = "https://stored-wallet.example.com",
        chain = DEFAULT_SEEKER_CHAIN,
        capabilities = FAKE_CAPABILITIES,
    )

    // connect

    @Test
    fun `connect authorizes and learns capabilities in a single interaction`() = runTest {
        val authorization = client.connect(Unit)
        assertEquals(1, link.transactCalls.size)
        assertEquals(listOf("authorize", "get_capabilities"), link.requests.map { it.first })
        assertEquals(listOf(FAKE_ACCOUNT), authorization.accounts)
        assertEquals("fake-auth-token", authorization.authToken)
        assertEquals("https://fake-wallet.example.com", authorization.walletUriBase)
        assertEquals(FAKE_CAPABILITIES, authorization.capabilities)
    }

    @Test
    fun `connect targets no learned wallet URI and requests the configured chain`() = runTest {
        SeekerConnect(config.copy(chain = "solana:devnet"), link, cache).connect(Unit)
        assertEquals(listOf<String?>(null), link.transactCalls)
        assertEquals("solana:devnet", link.authorizeRequests.single().chain)
    }

    @Test
    fun `the chain defaults to mainnet`() = runTest {
        client.connect(Unit)
        assertEquals("solana:mainnet", link.authorizeRequests.single().chain)
    }

    @Test
    fun `connect caches and publishes the authorization`() = runTest {
        val authorization = client.connect(Unit)
        assertEquals(authorization, cache.get())
        assertEquals(authorization, client.authorization.value)
    }

    @Test
    fun `connect restores a cached authorization without launching the wallet`() = runTest {
        cache.set(stored)
        assertEquals(stored, client.connect(Unit))
        assertEquals(0, link.transactCalls.size)
        assertEquals(stored, client.authorization.value)
    }

    @Test
    fun `restore reads only the cache`() = runTest {
        assertNull(client.restore())
        cache.set(stored)
        assertEquals(stored, client.restore())
        assertEquals(0, link.transactCalls.size)
    }

    @Test
    fun `concurrent connects launch the wallet once`() = runTest {
        // The first connect stays in its wallet session until released, so the second overlaps it.
        val release = CompletableDeferred<Unit>()
        link.onSession = { release.await() }
        val connects = List(2) { async { client.connect(Unit) } }
        runCurrent()
        assertEquals(1, link.transactCalls.size)
        release.complete(Unit)
        val results = connects.awaitAll()
        assertEquals(1, link.transactCalls.size)
        assertEquals(results[0], results[1])
    }

    @Test
    fun `walletAvailability asks the link`() {
        link.availability = WalletAvailability.OTHER
        assertEquals(WalletAvailability.OTHER, client.walletAvailability())
    }

    // disconnect

    @Test
    fun `disconnect forgets the authorization without launching the wallet`() = runTest {
        client.connect(Unit)
        client.disconnect()
        assertNull(client.authorization.value)
        assertNull(cache.get())
        assertEquals(1, link.transactCalls.size)
    }

    @Test
    fun `an interaction in flight during disconnect ends cancelled, unreported and unadopted`() = runTest {
        val walletReached = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        link.onSession = {
            walletReached.complete(Unit)
            release.await()
        }
        val connecting = async(SupervisorJob()) { client.connect(Unit) }
        walletReached.await()
        client.disconnect()
        release.complete(Unit)
        assertEquals(Code.CANCELLED, assertFailsWith<SeekerConnectException> { connecting.await() }.code)
        assertNull(client.authorization.value)
        assertNull(cache.get())
        assertEquals(emptyList(), presenter.failures)
    }

    @Test
    fun `a failure arriving after disconnect ends cancelled and unreported`() = runTest {
        val walletReached = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        link.onSession = {
            walletReached.complete(Unit)
            release.await()
            throw SeekerConnectException(Code.SESSION_CLOSED, "closed")
        }
        val connecting = async(SupervisorJob()) { client.connect(Unit) }
        walletReached.await()
        client.disconnect()
        release.complete(Unit)
        val error = assertFailsWith<SeekerConnectException> { connecting.await() }
        assertEquals(Code.CANCELLED, error.code)
        assertEquals(Code.SESSION_CLOSED, (error.cause as SeekerConnectException).code)
        assertEquals(emptyList(), presenter.failures)
    }

    // transact

    @Test
    fun `transact reauthorizes with the stored token, then runs the block, in one interaction`() = runTest {
        cache.set(stored)
        val result = client.transact(Unit) { authorization ->
            signMessages(listOf(authorization.accounts.first().address), listOf(byteArrayOf(1)))
        }
        assertContentEquals(fakeSignedPayload(byteArrayOf(1)), result.single())
        assertEquals(listOf<String?>(stored.walletUriBase), link.transactCalls)
        assertEquals(listOf("authorize", "sign_messages"), link.requests.map { it.first })
        assertEquals("stored-token", link.authorizeRequests.single().authToken)
    }

    @Test
    fun `transact connects in the same session when not yet connected`() = runTest {
        client.transact(Unit) { signTransactions(listOf(byteArrayOf(2))) }
        assertEquals(1, link.transactCalls.size)
        assertEquals(listOf("authorize", "get_capabilities", "sign_transactions"), link.requests.map { it.first })
        assertEquals("fake-auth-token", client.authorization.value?.authToken)
    }

    @Test
    fun `transact persists a rotated auth token`() = runTest {
        cache.set(stored)
        link.authToken = "rotated-token"
        client.transact(Unit) { }
        assertEquals("rotated-token", cache.get()?.authToken)
        assertEquals("rotated-token", client.authorization.value?.authToken)
    }

    @Test
    fun `transact keeps the stored wallet URI when the wallet advertises none`() = runTest {
        cache.set(stored)
        link.walletUriBase = null
        client.transact(Unit) { }
        assertEquals(stored.walletUriBase, cache.get()?.walletUriBase)
    }

    @Test
    fun `transact forgets the authorization when the wallet no longer honors the token`() = runTest {
        cache.set(stored)
        link.authorizeError = SeekerConnectException(Code.AUTHORIZATION_DECLINED, "declined")
        assertEquals(Code.AUTHORIZATION_DECLINED, assertFailsWith<SeekerConnectException> { client.transact(Unit) { } }.code)
        assertNull(client.authorization.value)
        assertNull(cache.get())
    }

    @Test
    fun `transact keeps the authorization when the interaction fails in transit`() = runTest {
        cache.set(stored)
        link.authorizeError = SeekerConnectException(Code.SESSION_CLOSED, "closed")
        assertFailsWith<SeekerConnectException> { client.transact(Unit) { } }
        assertEquals(stored, cache.get())
    }

    // signing helpers

    @Test
    fun `signMessages returns the wallet-signed messages`() = runTest {
        val signed = client.signMessages(Unit, listOf(FAKE_ACCOUNT.address), listOf(byteArrayOf(3)))
        assertContentEquals(fakeSignedPayload(byteArrayOf(3)), signed.single())
        assertEquals(listOf(FAKE_ACCOUNT.address), link.requests.last().second)
    }

    @Test
    fun `signTransactions returns the wallet-signed transactions`() = runTest {
        assertContentEquals(fakeSignedPayload(byteArrayOf(4)), client.signTransactions(Unit, listOf(byteArrayOf(4))).single())
    }

    @Test
    fun `signAndSendTransactions returns the signatures and forwards the options`() = runTest {
        val options = SeekerSignAndSendOptions(minContextSlot = 5, commitment = "confirmed")
        val signatures = client.signAndSendTransactions(Unit, listOf(byteArrayOf(5, 6)), options)
        assertContentEquals(fakeTransactionSignature(byteArrayOf(5, 6)), signatures.single())
        assertEquals(options, link.requests.last().second)
    }

    @Test
    fun `the API defaults omit the optional request fields`() = runTest {
        client.signAndSendTransactions(Unit, listOf(byteArrayOf(7)))
        assertNull(link.requests.last().second)
        client.transact(Unit) {
            authorize()
            signAndSendTransactions(listOf(byteArrayOf(8)))
        }
        assertEquals(FakeSeekerLink.AuthorizeParams(null, null, null), link.authorizeRequests.last())
        assertNull(link.requests.last().second)
    }

    // signIn

    @Test
    fun `signIn without a prior connection signs in and adopts the authorization`() = runTest {
        val payload = SeekerSignInPayload(statement = "Sign in")
        val result = client.signIn(Unit, payload)
        assertEquals(FAKE_ACCOUNT.address, result.address)
        assertEquals(payload, link.authorizeRequests.single().signInPayload)
        assertEquals("fake-auth-token", client.authorization.value?.authToken)
    }

    @Test
    fun `signIn reuses the stored token and wallet when connected`() = runTest {
        cache.set(stored)
        client.signIn(Unit)
        assertEquals("stored-token", link.authorizeRequests.single().authToken)
        assertEquals(listOf<String?>(stored.walletUriBase), link.transactCalls)
    }

    @Test
    fun `signIn fails when the wallet returns no sign-in result`() = runTest {
        link.omitSignInResult = true
        assertEquals(Code.WALLET_ERROR, assertFailsWith<SeekerConnectException> { client.signIn(Unit) }.code)
    }

    @Test
    fun `a declined signIn keeps the stored authorization`() = runTest {
        cache.set(stored)
        link.authorizeError = SeekerConnectException(Code.AUTHORIZATION_DECLINED, "declined")
        assertFailsWith<SeekerConnectException> { client.signIn(Unit) }
        assertEquals(stored, cache.get())
    }

    // presenter

    @Test
    fun `the presenter wraps each wallet interaction`() = runTest {
        client.connect(Unit)
        client.signTransactions(Unit, listOf(byteArrayOf(1)))
        assertEquals(2, presenter.started)
        assertEquals(2, presenter.settled)
    }

    @Test
    fun `the presenter shows nothing for a cache-restored connect`() = runTest {
        cache.set(stored)
        client.connect(Unit)
        assertEquals(0, presenter.started)
    }

    @Test
    fun `the presenter reports failed interactions`() = runTest {
        val failure = SeekerConnectException(Code.ASSOCIATION_FAILED, "no wallet")
        link.transactError = failure
        assertSame(failure, assertFailsWith<SeekerConnectException> { client.connect(Unit) })
        assertEquals(listOf(failure), presenter.failures)
        assertEquals(1, presenter.settled)
    }

    @Test
    fun `cancelling from the presenter ends the interaction cancelled, without a failure report`() = runTest {
        link.hang = true
        val connecting = async(SupervisorJob()) { client.connect(Unit) }
        runCurrent()
        presenter.cancel!!()
        presenter.cancel!!()
        assertEquals(Code.CANCELLED, assertFailsWith<SeekerConnectException> { connecting.await() }.code)
        assertEquals(emptyList(), presenter.failures)
        assertEquals(1, presenter.settled)
    }

    @Test
    fun `cancelling the caller propagates the cancellation, not an error`() = runTest {
        link.hang = true
        val connecting = async(start = CoroutineStart.UNDISPATCHED) { client.connect(Unit) }
        connecting.cancel()
        assertFailsWith<CancellationException> { connecting.await() }
        assertEquals(emptyList(), presenter.failures)
    }

    @Test
    fun `errors from the block pass through unreported`() = runTest {
        val failure = IllegalStateException("dapp bug")
        // Debug-mode stack-trace recovery may copy the exception, so compare by content.
        assertEquals(failure.message, assertFailsWith<IllegalStateException> { client.transact(Unit) { throw failure } }.message)
        assertEquals(emptyList(), presenter.failures)
    }

    @Test
    fun `a decline that arrives after disconnect and reconnect keeps the new authorization`() = runTest {
        cache.set(stored)
        val firstSessionReached = CompletableDeferred<Unit>()
        val releaseFirstSession = CompletableDeferred<Unit>()
        var sessions = 0
        link.onSession = {
            if (++sessions == 1) {
                firstSessionReached.complete(Unit)
                releaseFirstSession.await()
                // The stale session's token is no longer honored.
                link.authorizeError = SeekerConnectException(Code.AUTHORIZATION_DECLINED, "declined")
            }
        }
        val stale = async(SupervisorJob()) { client.transact(Unit) { } }
        firstSessionReached.await()
        client.disconnect()
        val fresh = client.connect(Unit)
        releaseFirstSession.complete(Unit)
        assertEquals(Code.CANCELLED, assertFailsWith<SeekerConnectException> { stale.await() }.code)
        assertEquals(fresh, cache.get())
        assertEquals(fresh, client.authorization.value)
    }

    @Test
    fun `cancelling from the presenter and the caller together propagates the caller's cancellation`() = runTest {
        link.hang = true
        val connecting = async(SupervisorJob()) { client.connect(Unit) }
        runCurrent()
        presenter.cancel!!()
        connecting.cancel()
        assertFailsWith<CancellationException> { connecting.await() }
        assertEquals(emptyList(), presenter.failures)
    }

    private class RecordingPresenter : SeekerConnectPresenter {
        var started = 0
        var settled = 0
        var cancel: (() -> Unit)? = null
        val failures = mutableListOf<SeekerConnectException>()

        override fun interactionStarted(cancel: () -> Unit): () -> Unit {
            started++
            this.cancel = cancel
            return { settled++ }
        }

        override fun interactionFailed(error: SeekerConnectException) {
            failures += error
        }
    }
}
