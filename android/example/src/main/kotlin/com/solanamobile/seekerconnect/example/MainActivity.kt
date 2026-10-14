package com.solanamobile.seekerconnect.example

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
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
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.solanamobile.seekerconnect.compose.SeekerConnectButton
import com.solanamobile.seekerconnect.compose.SeekerConnectButtonVariant
import com.solanamobile.seekerconnect.compose.SeekerConnectDialogs

class MainActivity : ComponentActivity() {
    private val viewModel: MainViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { ExampleScreen(this, viewModel) }
    }
}

@Composable
private fun ExampleScreen(host: ComponentActivity, viewModel: MainViewModel) {
    val darkTheme = isSystemInDarkTheme()
    val foreground = if (darkTheme) Color.White else Color.Black
    val state by viewModel.uiState.collectAsState()

    Column(
        Modifier
            .fillMaxSize()
            .background(if (darkTheme) Color(0xFF0D1615) else Color.White)
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        val account = state.account
        if (account == null) {
            SeekerConnectButton(onClick = { viewModel.connect(host) }, enabled = !state.busy)
        } else {
            Text("Connected as ${account.base58()}", color = foreground)
        }
        SeekerConnectButton(
            onClick = { viewModel.signIn(host) },
            variant = SeekerConnectButtonVariant.SIGN_IN,
            enabled = !state.busy,
        )
        if (account != null) {
            Action("Sign message", state.busy, foreground) { viewModel.signMessage(host) }
            Action("Sign transaction", state.busy, foreground) { viewModel.signTransaction(host) }
            Action("Sign and send transaction", state.busy, foreground) { viewModel.signAndSendTransaction(host) }
            Action("Disconnect", state.busy, foreground) { viewModel.disconnect() }
        }
        state.log.asReversed().forEach { Text(it, color = foreground, fontFamily = FontFamily.Monospace, fontSize = 12.sp) }
    }
    SeekerConnectDialogs(viewModel.dialogs, darkTheme)
}

@Composable
private fun Action(label: String, busy: Boolean, foreground: Color, onClick: () -> Unit) {
    OutlinedButton(onClick = onClick, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
        Text(label, color = foreground)
    }
}
