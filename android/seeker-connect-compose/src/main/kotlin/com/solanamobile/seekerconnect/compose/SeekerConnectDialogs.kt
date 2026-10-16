package com.solanamobile.seekerconnect.compose

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import com.solanamobile.seekerconnect.SeekerConnectException
import com.solanamobile.seekerconnect.SeekerConnectException.Code
import com.solanamobile.seekerconnect.SeekerConnectPresenter

/**
 * [SeekerConnectPresenter] whose UI [SeekerConnectDialogs] draws: a progress
 * card while a wallet interaction is in flight, and an error card when one
 * fails. Dismissing the progress card cancels the interaction.
 */
class SeekerConnectDialogState : SeekerConnectPresenter {
    internal var shown: Shown? by mutableStateOf(null)

    override fun interactionStarted(cancel: () -> Unit): () -> Unit {
        val progress = Shown.Progress(cancel)
        shown = progress
        return { if (shown === progress) shown = null }
    }

    override fun interactionFailed(error: SeekerConnectException) {
        shown = Shown.Error(error.code)
    }

    /** Closes whatever card is shown; closing the progress card cancels its interaction. */
    internal fun dismiss() {
        (shown as? Shown.Progress)?.cancel?.invoke()
        shown = null
    }

    internal sealed interface Shown {
        class Progress(val cancel: () -> Unit) : Shown

        class Error(val code: Code) : Shown
    }
}

/** Draws the cards [state] calls for; place it once, anywhere in the composition. */
@Composable
fun SeekerConnectDialogs(state: SeekerConnectDialogState, darkTheme: Boolean = isSystemInDarkTheme()) {
    when (val shown = state.shown) {
        is SeekerConnectDialogState.Shown.Progress -> Card(
            title = "Continue in your Seeker Wallet",
            body = "Accept the connection request in your wallet",
            darkTheme = darkTheme,
            onDismiss = state::dismiss,
        ) { foreground -> Spinner(foreground) }
        is SeekerConnectDialogState.Shown.Error -> {
            val copy = errorCopy(shown.code)
            Card(copy.title, copy.body, darkTheme, onDismiss = state::dismiss) { foreground ->
                BrandVector(
                    paths = if (copy.declined) DECLINED_ICON_PATHS else GLOBE_ICON_PATHS,
                    viewBox = Rect(168f, 347f, 232f, 411f),
                    color = foreground,
                    modifier = Modifier.size(64.dp),
                    strokeWidth = 5.33333f,
                )
            }
        }
        null -> Unit
    }
}

internal class ErrorCopy(val title: String, val body: String, val declined: Boolean)

internal fun errorCopy(code: Code) = when (code) {
    Code.ASSOCIATION_FAILED, Code.NO_WALLET_FOUND ->
        ErrorCopy("We can’t find your Seeker", "Make sure your Seeker Wallet is setup and try again.", declined = false)
    Code.AUTHORIZATION_DECLINED ->
        ErrorCopy("Connection declined", "You declined the connection in your Seeker Wallet.", declined = true)
    Code.REQUEST_DECLINED ->
        ErrorCopy("Request declined", "You declined the request in your Seeker Wallet.", declined = true)
    Code.SESSION_CLOSED ->
        ErrorCopy("Connection lost", "The connection to your Seeker Wallet was interrupted.", declined = false)
    Code.CANCELLED, Code.WALLET_ERROR ->
        ErrorCopy("Something went wrong", "Your Seeker Wallet ran into an unexpected error.", declined = false)
}

@Composable
private fun Spinner(foreground: Color) {
    val rotation by rememberInfiniteTransition(label = "spinner").animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(tween(1_400, easing = LinearEasing), RepeatMode.Restart),
        label = "arc",
    )
    val viewBox = Rect(138f, 317f, 262f, 441f)
    Box(Modifier.size(124.dp)) {
        BrandVector(listOf(S_MARK_PATH), viewBox, foreground, Modifier.fillMaxSize())
        BrandVector(
            listOf(S_MARK_ARC_PATH),
            viewBox,
            foreground,
            Modifier.fillMaxSize().graphicsLayer { rotationZ = rotation },
            strokeWidth = 3.99911f,
        )
    }
}

@Composable
private fun Card(
    title: String,
    body: String,
    darkTheme: Boolean,
    onDismiss: () -> Unit,
    icon: @Composable (foreground: Color) -> Unit,
) {
    val foreground = if (darkTheme) Color.White else Color.Black
    Dialog(onDismissRequest = onDismiss) {
        Box(
            Modifier
                .widthIn(max = 352.dp)
                .background(if (darkTheme) Color(0xFF0E0E0E) else Color(0xFFF5F6F6), CardShape)
                .border(1.dp, if (darkTheme) Color(0xFF2D2D2D) else Color(0xFFABACAC), CardShape)
                .semantics { contentDescription = title },
        ) {
            Column(
                Modifier.verticalScroll(rememberScrollState()).padding(bottom = 14.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Box(Modifier.padding(top = 69.dp).height(124.dp), contentAlignment = Alignment.Center) { icon(foreground) }
                Text(
                    title,
                    Modifier.padding(start = 24.dp, top = 40.dp, end = 24.dp),
                    color = foreground,
                    style = TextStyle(fontSize = 20.sp, lineHeight = 26.sp, fontWeight = FontWeight.Medium, textAlign = TextAlign.Center),
                )
                Text(
                    body,
                    Modifier.padding(start = 32.dp, top = 12.dp, end = 32.dp),
                    color = Color(0xFF6C6C6C),
                    style = TextStyle(fontSize = 14.sp, lineHeight = 21.sp, fontFamily = FontFamily.Monospace, textAlign = TextAlign.Center),
                )
                OutlinedButton(
                    onClick = onDismiss,
                    modifier = Modifier.padding(top = 40.dp).sizeIn(minWidth = 160.dp, minHeight = 42.dp),
                    shape = RoundedCornerShape(12.dp),
                    border = BorderStroke(1.dp, foreground),
                ) {
                    Text("Close", color = foreground, fontSize = 15.sp, fontWeight = FontWeight.Medium)
                }
                Spacer(Modifier.height(41.dp))
                BrandVector(
                    FOOTER_WORDMARK_PATHS,
                    Rect(140f, 671f, 260f, 681f),
                    Color(0xFFB4B4B4),
                    Modifier.width(120.dp).height(10.dp).semantics { contentDescription = "Solana Mobile" },
                )
            }
            BrandVector(
                listOf(CLOSE_X_PATH),
                Rect(337.833f, 268.833f, 354.167f, 285.167f),
                foreground,
                Modifier
                    .align(Alignment.TopEnd)
                    .padding(top = 15.dp, end = 15.dp)
                    .size(28.dp)
                    .clickable(role = Role.Button, onClickLabel = "Close", onClick = onDismiss)
                    .padding(5.5.dp)
                    .semantics { contentDescription = "Close" },
            )
        }
    }
}

private val CardShape = RoundedCornerShape(24.dp)
