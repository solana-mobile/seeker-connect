package com.solanamobile.seekerconnect.compose

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Which label [SeekerConnectButton] shows. */
enum class SeekerConnectButtonVariant(internal val label: String) {
    CONNECT("Connect with Seeker"),
    SIGN_IN("Sign in with Seeker"),
}

/**
 * The "Connect with Seeker" / "Sign in with Seeker" button. Black on a light
 * screen, white on a dark one ([darkTheme] names the screen's scheme).
 */
@Composable
fun SeekerConnectButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    variant: SeekerConnectButtonVariant = SeekerConnectButtonVariant.CONNECT,
    enabled: Boolean = true,
    darkTheme: Boolean = isSystemInDarkTheme(),
) {
    val background = if (darkTheme) Color.White else Color.Black
    val foreground = if (darkTheme) Color.Black else Color.White
    Button(
        onClick = onClick,
        modifier = modifier.widthIn(max = 368.dp).fillMaxWidth().height(56.dp),
        enabled = enabled,
        shape = RoundedCornerShape(16.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = background,
            contentColor = foreground,
            disabledContainerColor = background.copy(alpha = 0.4f),
            disabledContentColor = foreground.copy(alpha = 0.4f),
        ),
    ) {
        BrandVector(
            S_GLYPH_MONO_PATHS,
            Rect(88.4f, 449f, 106.6f, 473f),
            if (enabled) foreground else foreground.copy(alpha = 0.4f),
            Modifier.padding(end = 19.dp).size(width = 18.2.dp, height = 24.dp),
        )
        Text(variant.label, fontSize = 20.sp, fontWeight = FontWeight.Medium)
    }
}
