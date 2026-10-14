package com.solanamobile.seekerconnect.example

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.solanamobile.seekerconnect.DappIdentity
import com.solanamobile.seekerconnect.SeekerConnect
import com.solanamobile.seekerconnect.SeekerConnectConfig
import com.solanamobile.seekerconnect.SeekerConnectException
import com.solanamobile.seekerconnect.SeekerSignInPayload
import com.solanamobile.seekerconnect.android.MwaSeekerLink
import com.solanamobile.seekerconnect.android.SharedPreferencesAuthorizationCache
import com.solanamobile.seekerconnect.compose.SeekerConnectButton
import com.solanamobile.seekerconnect.compose.SeekerConnectButtonVariant
import com.solanamobile.seekerconnect.compose.SeekerConnectDialogState
import com.solanamobile.seekerconnect.compose.SeekerConnectDialogs
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val dialogs = SeekerConnectDialogState()

    private val seekerConnect by lazy {
        SeekerConnect(
            SeekerConnectConfig(
                identity = DappIdentity("Seeker Connect Example", "https://solanamobile.com", "favicon.ico"),
                chain = "solana:devnet",
            ),
            MwaSeekerLink(this),
            SharedPreferencesAuthorizationCache(this),
            dialogs,
        )
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { ExampleScreen(this, seekerConnect, dialogs) }
    }
}

@Composable
private fun ExampleScreen(
    activity: ComponentActivity,
    seekerConnect: SeekerConnect<ComponentActivity>,
    dialogs: SeekerConnectDialogState,
) {
    val darkTheme = isSystemInDarkTheme()
    val foreground = if (darkTheme) Color.White else Color.Black
    val authorization by seekerConnect.authorization.collectAsState()
    val log = remember { mutableStateListOf<String>() }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        seekerConnect.restore()?.let { log += "restored ${it.accounts.first().address}" }
    }

    fun run(name: String, action: suspend () -> String) {
        scope.launch {
            busy = true
            log += try {
                "$name: ${action()}"
            } catch (e: SeekerConnectException) {
                "$name failed: ${e.code}"
            } finally {
                busy = false
            }
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(if (darkTheme) Color(0xFF0D1615) else Color.White)
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        val account = authorization?.accounts?.first()
        if (account == null) {
            SeekerConnectButton(onClick = {
                run("connect") { seekerConnect.connect(activity).accounts.first().address }
            }, enabled = !busy)
            SeekerConnectButton(
                onClick = { run("signIn") { seekerConnect.signIn(activity, SeekerSignInPayload(statement = "Sign in to the example")).address } },
                variant = SeekerConnectButtonVariant.SIGN_IN,
                enabled = !busy,
            )
        } else {
            Text("Connected as ${account.address}", color = foreground)
            Action("Sign message", busy, foreground) {
                run("signMessage") {
                    val signed = seekerConnect.signMessages(activity, listOf(account.address), listOf("Hello from the example".encodeToByteArray()))
                    "${signed.single().size} bytes"
                }
            }
            Action("Sign transaction", busy, foreground) {
                run("signTransaction") {
                    val transaction = buildMemoTransaction(account.publicKey, fetchRecentBlockhash(), "Seeker Connect example")
                    "${seekerConnect.signTransactions(activity, listOf(transaction)).single().size} bytes"
                }
            }
            Action("Sign and send transaction", busy, foreground) {
                run("signAndSendTransaction") {
                    val transaction = buildMemoTransaction(account.publicKey, fetchRecentBlockhash(), "Seeker Connect example")
                    base58Encode(seekerConnect.signAndSendTransactions(activity, listOf(transaction)).single())
                }
            }
            Action("Disconnect", busy, foreground) {
                run("disconnect") {
                    seekerConnect.disconnect()
                    "done"
                }
            }
        }
        log.asReversed().forEach { Text(it, color = foreground, fontFamily = FontFamily.Monospace, fontSize = 12.sp) }
    }
    SeekerConnectDialogs(dialogs, darkTheme)
}

@Composable
private fun Action(label: String, busy: Boolean, foreground: Color, onClick: () -> Unit) {
    OutlinedButton(onClick = onClick, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
        Text(label, color = foreground)
    }
}
