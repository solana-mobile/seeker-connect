package com.solanamobile.seekerconnect.example

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
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
import androidx.compose.ui.text.font.FontWeight
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

    val muted = foreground.copy(alpha = 0.6f)

    Column(
        Modifier
            .fillMaxSize()
            .background(if (darkTheme) Color(0xFF0D1615) else Color.White)
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column {
            Text("Seeker Connect", color = foreground, fontSize = 22.sp, fontWeight = FontWeight.Medium)
            Text("Example dapp", color = muted, fontSize = 13.sp)
        }
        val account = state.account
        if (account == null) {
            SeekerConnectButton(onClick = { viewModel.connect(host) }, enabled = !state.busy)
            SeekerConnectButton(
                onClick = { viewModel.signIn(host) },
                variant = SeekerConnectButtonVariant.SIGN_IN,
                enabled = !state.busy,
            )
        } else {
            Label("Connected as", muted)
            Text(account.base58(), color = foreground, fontFamily = FontFamily.Monospace, fontSize = 13.sp)
            Action("Sign message", state.busy, foreground) { viewModel.signMessage(host) }
            Action("Sign transaction", state.busy, foreground) { viewModel.signTransaction(host) }
            Action("Sign and send transaction", state.busy, foreground) { viewModel.signAndSendTransaction(host) }
            Action("Sign in", state.busy, foreground) { viewModel.signIn(host) }
            Action("Disconnect", state.busy, foreground) { viewModel.disconnect() }
        }
        Label("Activity", muted)
        if (state.log.isEmpty()) {
            Text("No activity yet.", color = muted, fontSize = 13.sp)
        } else {
            state.log.forEachIndexed { index, line ->
                Text("${index + 1}. $line", color = muted, fontFamily = FontFamily.Monospace, fontSize = 13.sp)
            }
        }
    }
    SeekerConnectDialogs(viewModel.dialogs, darkTheme)
}

@Composable
private fun Label(text: String, color: Color) {
    Text(text.uppercase(), color = color, fontSize = 13.sp, fontWeight = FontWeight.Medium, letterSpacing = 1.sp)
}

@Composable
private fun Action(label: String, busy: Boolean, foreground: Color, onClick: () -> Unit) {
    OutlinedButton(onClick = onClick, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
        Text(label, color = foreground)
    }
}
