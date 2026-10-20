package com.solanamobile.seekerconnect.example

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.viewModelScope
import com.funkatronics.encoders.Base58
import com.solana.networking.KtorNetworkDriver
import com.solana.publickey.SolanaPublicKey
import com.solana.rpc.SolanaRpcClient
import com.solana.transaction.Blockhash
import com.solanamobile.seekerconnect.DappIdentity
import com.solanamobile.seekerconnect.SeekerConnect
import com.solanamobile.seekerconnect.SeekerConnectConfig
import com.solanamobile.seekerconnect.SeekerConnectException
import com.solanamobile.seekerconnect.SeekerSignInPayload
import com.solanamobile.seekerconnect.android.MwaSeekerLink
import com.solanamobile.seekerconnect.android.SharedPreferencesAuthorizationCache
import com.solanamobile.seekerconnect.compose.SeekerConnectDialogState
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.io.IOException
import java.util.concurrent.atomic.AtomicBoolean

class MainViewModel(application: Application) : AndroidViewModel(application) {
    data class UiState(
        /** The connected account's key; null while disconnected. */
        val account: SolanaPublicKey? = null,
        val busy: Boolean = false,
        /** Results of past actions, newest last. */
        val log: List<String> = emptyList(),
    )

    /** The Seeker Connect progress and error cards; drawn by the screen. */
    val dialogs = SeekerConnectDialogState()

    private val seekerConnect = SeekerConnect(
        SeekerConnectConfig(
            identity = DappIdentity("Seeker Connect Example", "https://solanamobile.com", "favicon.ico"),
            chain = "solana:devnet",
        ),
        MwaSeekerLink(application),
        SharedPreferencesAuthorizationCache(application),
        dialogs,
    )
    private val rpc = SolanaRpcClient(RPC_URL, KtorNetworkDriver())

    private val actionRunning = AtomicBoolean(false)

    private val _uiState = MutableStateFlow(UiState())
    val uiState: StateFlow<UiState> = _uiState.asStateFlow()

    init {
        seekerConnect.authorization
            .onEach { authorization ->
                _uiState.update { it.copy(account = authorization?.accounts?.first()?.let { account -> SolanaPublicKey(account.publicKey) }) }
            }
            .launchIn(viewModelScope)
        viewModelScope.launch {
            seekerConnect.restore()?.let { log("restored ${it.accounts.first().address}") }
        }
    }

    fun connect(host: ComponentActivity) = run(host.lifecycleScope, "connect") {
        seekerConnect.connect(host).accounts.first().address
    }

    fun signIn(host: ComponentActivity) = run(host.lifecycleScope, "signIn") {
        seekerConnect.signIn(host, SeekerSignInPayload(statement = "Sign in to the example")).address
    }

    fun signMessage(host: ComponentActivity) = run(host.lifecycleScope, "signMessage") {
        val signed = seekerConnect.signMessages(host, listOf(account().base58()), listOf(MESSAGE.encodeToByteArray()))
        "${signed.single().size} bytes"
    }

    fun signTransaction(host: ComponentActivity) = run(host.lifecycleScope, "signTransaction") {
        val transaction = memoTransaction(account(), latestBlockhash(), MEMO)
        "${seekerConnect.signTransactions(host, listOf(transaction)).single().size} bytes"
    }

    fun signAndSendTransaction(host: ComponentActivity) = run(host.lifecycleScope, "signAndSendTransaction") {
        val transaction = memoTransaction(account(), latestBlockhash(), MEMO)
        Base58.encodeToString(seekerConnect.signAndSendTransactions(host, listOf(transaction)).single())
    }

    fun disconnect() = run(viewModelScope, "disconnect") {
        seekerConnect.disconnect()
        "done"
    }

    private fun account() = checkNotNull(_uiState.value.account) { "not connected" }

    private suspend fun latestBlockhash(): Blockhash {
        val response = rpc.getLatestBlockhash()
        val blockhash = response.result?.blockhash ?: throw IOException("getLatestBlockhash failed: ${response.error?.message}")
        return Blockhash.from(blockhash)
    }

    /**
     * Runs [action] unless another action is running. Actions that launch the
     * wallet run in the host's lifecycleScope, so a destroyed activity cancels
     * them instead of launching the wallet from it later.
     */
    private fun run(scope: CoroutineScope, name: String, action: suspend () -> String) {
        if (!actionRunning.compareAndSet(false, true)) return
        _uiState.update { it.copy(busy = true) }
        scope.launch {
            log(
                try {
                    "$name: ${action()}"
                } catch (e: CancellationException) {
                    throw e
                } catch (e: SeekerConnectException) {
                    "$name failed: ${e.code}"
                } catch (e: Exception) {
                    "$name failed: ${e.message}"
                },
            )
        }.invokeOnCompletion {
            // Runs even when the scope was already cancelled and the action never started.
            actionRunning.set(false)
            _uiState.update { it.copy(busy = false) }
        }
    }

    private fun log(line: String) = _uiState.update { it.copy(log = it.log + line) }

    private companion object {
        const val RPC_URL = "https://api.devnet.solana.com"
        const val MESSAGE = "Hello from the example"
        const val MEMO = "Seeker Connect example"
    }
}
