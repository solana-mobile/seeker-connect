package com.solanamobile.seekerconnect

import com.solanamobile.seekerconnect.SeekerConnectException.Code
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.job
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlin.concurrent.Volatile

/**
 * The Seeker Connect client.
 *
 * "Connected" means holding a wallet-issued authorization; there is no
 * long-lived transport. Every wallet interaction runs in its own short-lived
 * session via [SeekerLink.transact], authorizing silently with the stored
 * auth token so the user is not re-prompted for consent.
 *
 * Wallet and transport failures throw [SeekerConnectException]; cancelling the
 * calling coroutine closes the session and propagates the cancellation.
 *
 * @param H What [link] needs to launch the wallet; on Android, a `ComponentActivity`.
 */
class SeekerConnect<H>(
    private val config: SeekerConnectConfig,
    private val link: SeekerLink<H>,
    private val authorizationCache: AuthorizationCache = MemoryAuthorizationCache(),
    private val presenter: SeekerConnectPresenter = SeekerConnectPresenter.None,
) {
    private val state = MutableStateFlow<StoredAuthorization?>(null)
    private val connectLock = Mutex()

    /** Bumped on disconnect; interactions started before the bump must not adopt late results. */
    @Volatile
    private var generation = 0

    /** The held authorization; null while disconnected. */
    val authorization: StateFlow<StoredAuthorization?> = state.asStateFlow()

    /** Which wallet a connection would reach right now, without launching anything. */
    fun walletAvailability(): WalletAvailability = link.walletAvailability(config)

    /** Restores the cached authorization without launching the wallet; null when there is none. */
    suspend fun restore(): StoredAuthorization? =
        state.value ?: authorizationCache.get()?.also { state.value = it }

    /**
     * Restores the cached authorization, or authorizes in a fresh session.
     * Concurrent calls launch the wallet at most once.
     */
    suspend fun connect(host: H): StoredAuthorization = connectLock.withLock {
        restore() ?: run {
            val generation = generation
            interact(host, null) { it.establish(null, null, generation).first }
        }
    }

    /**
     * Forgets the authorization without launching the wallet; interactions in
     * flight end with [Code.CANCELLED]. To also revoke the token with the
     * wallet, call `transact { deauthorize(it.authToken) }` first.
     */
    suspend fun disconnect() {
        generation++
        forget()
    }

    /** Signs in with Sign-In-With-Solana, connecting in the same session when not yet connected. */
    suspend fun signIn(host: H, payload: SeekerSignInPayload = SeekerSignInPayload()): SeekerSignInResult {
        val cached = restore()
        val generation = generation
        val (_, authorization) = interact(host, cached?.walletUriBase) {
            it.establish(cached, payload, generation)
        }
        return authorization.signInResult
            ?: throw SeekerConnectException(Code.WALLET_ERROR, "The wallet returned no sign-in result")
    }

    /**
     * Runs [block] against one wallet session, after authorizing in that same
     * session: silently with the stored token, or with fresh consent when not
     * yet connected. Every request in [block] shares the one wallet launch.
     */
    suspend fun <T> transact(host: H, block: suspend SeekerWallet.(StoredAuthorization) -> T): T {
        val cached = restore()
        val generation = generation
        return interact(host, cached?.walletUriBase) { wallet ->
            wallet.block(wallet.establish(cached, null, generation).first)
        }
    }

    /** Signs every payload with each of [addresses] (base58). Returns one signed message per payload. */
    suspend fun signMessages(host: H, addresses: List<String>, payloads: List<ByteArray>): List<ByteArray> =
        transact(host) { signMessages(addresses, payloads) }

    /** Returns the signed transaction bytes, one per payload. */
    suspend fun signTransactions(host: H, payloads: List<ByteArray>): List<ByteArray> =
        transact(host) { signTransactions(payloads) }

    /** Returns the raw signature bytes of each submitted transaction. */
    suspend fun signAndSendTransactions(
        host: H,
        payloads: List<ByteArray>,
        options: SeekerSignAndSendOptions? = null,
    ): List<ByteArray> = transact(host) { signAndSendTransactions(payloads, options) }

    /**
     * Authorizes in this session, with the cached token when there is one,
     * learning capabilities in the same session when they are not yet known.
     */
    private suspend fun SeekerWallet.establish(
        cached: StoredAuthorization?,
        signInPayload: SeekerSignInPayload?,
        generation: Int,
    ): Pair<StoredAuthorization, SeekerAuthorization> {
        val authorization = try {
            authorize(config.chain, cached?.authToken, signInPayload)
        } catch (e: SeekerConnectException) {
            // The token is no longer honored. Transport failures and a declined
            // sign-in say nothing about the token and must not wipe it.
            if (cached != null && signInPayload == null && e.code == Code.AUTHORIZATION_DECLINED &&
                generation == this@SeekerConnect.generation
            ) {
                forget()
            }
            throw e
        }
        val stored = StoredAuthorization(
            accounts = authorization.accounts,
            authToken = authorization.authToken,
            walletUriBase = authorization.walletUriBase ?: cached?.walletUriBase,
            chain = config.chain,
            capabilities = cached?.capabilities ?: getCapabilities(),
        )
        if (generation != this@SeekerConnect.generation) throw disconnected(null)
        authorizationCache.set(stored)
        state.value = stored
        return stored to authorization
    }

    /** One wallet interaction: presenter-wrapped, cancellable from the presenter, disconnect-aware. */
    private suspend fun <T> interact(
        host: H,
        walletUriBase: String?,
        block: suspend (SeekerWallet) -> T,
    ): T {
        val generation = generation
        val cancelledByUser = CompletableDeferred<Unit>()
        try {
            // Failures are handled outside the scope so its child-failure rules can't replace what we throw.
            return coroutineScope {
                val session = coroutineContext.job
                val settle = presenter.interactionStarted {
                    if (cancelledByUser.complete(Unit)) session.cancel()
                }
                try {
                    link.transact(host, config, walletUriBase, block)
                } finally {
                    settle()
                }
            }
        } catch (e: SeekerConnectException) {
            if (generation != this.generation) throw disconnected(e)
            presenter.interactionFailed(e)
            throw e
        } catch (e: CancellationException) {
            // Only a presenter cancel becomes an error; the caller's own cancellation propagates.
            if (cancelledByUser.isCompleted && currentCoroutineContext().isActive) {
                throw SeekerConnectException(Code.CANCELLED, "The wallet interaction was cancelled", e)
            }
            throw e
        }
    }

    private suspend fun forget() {
        authorizationCache.clear()
        state.value = null
    }

    private fun disconnected(cause: Throwable?) =
        SeekerConnectException(Code.CANCELLED, "Disconnected while the wallet interaction was in flight", cause)
}
