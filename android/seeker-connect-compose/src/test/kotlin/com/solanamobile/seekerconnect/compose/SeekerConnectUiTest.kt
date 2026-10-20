package com.solanamobile.seekerconnect.compose

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.runComposeUiTest
import com.solanamobile.seekerconnect.SeekerConnectException
import com.solanamobile.seekerconnect.SeekerConnectException.Code
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

@OptIn(ExperimentalTestApi::class)
@RunWith(RobolectricTestRunner::class)
class SeekerConnectUiTest {
    @Test
    fun `the progress card's Close cancels the interaction`() = runComposeUiTest {
        val state = SeekerConnectDialogState()
        var cancelled = 0
        state.interactionStarted { cancelled++ }
        mainClock.autoAdvance = false // the spinner animates forever
        setContent { SeekerConnectDialogs(state, darkTheme = true) }
        mainClock.advanceTimeBy(700)
        onNodeWithText("Continue in your Seeker Wallet").assertIsDisplayed()
        onNodeWithText("Close").performClick()
        mainClock.advanceTimeByFrame()
        assertEquals(1, cancelled)
        assertNull(state.shown)
    }

    @Test
    fun `the X closes an error card`() = runComposeUiTest {
        val state = SeekerConnectDialogState()
        state.interactionFailed(SeekerConnectException(Code.AUTHORIZATION_DECLINED, "declined"))
        setContent { SeekerConnectDialogs(state, darkTheme = false) }
        onNodeWithText("Connection declined").assertIsDisplayed()
        onNodeWithContentDescription("Solana Mobile").assertIsDisplayed()
        onNodeWithContentDescription("Close").performClick()
        waitForIdle()
        assertNull(state.shown)
    }

    @Test
    fun `error cards show the code's copy`() = runComposeUiTest {
        val state = SeekerConnectDialogState()
        state.interactionFailed(SeekerConnectException(Code.SESSION_CLOSED, "closed"))
        setContent { SeekerConnectDialogs(state) }
        onNodeWithText("Connection lost").assertIsDisplayed()
        onNodeWithText("The connection to your Seeker Wallet was interrupted.").assertIsDisplayed()
    }

    @Test
    fun `nothing is shown without an interaction, or once it is dismissed`() = runComposeUiTest {
        val state = SeekerConnectDialogState()
        setContent { SeekerConnectDialogs(state) }
        onNodeWithText("Close").assertDoesNotExist()
        state.interactionFailed(SeekerConnectException(Code.WALLET_ERROR, "boom"))
        onNodeWithText("Something went wrong").assertIsDisplayed()
        onNodeWithText("Close").performClick()
        onNodeWithText("Something went wrong").assertDoesNotExist()
        onNodeWithText("Close").assertDoesNotExist()
    }

    @Test
    fun `the button shows its variant's label and reports clicks`() = runComposeUiTest {
        var clicks = 0
        setContent { SeekerConnectButton(onClick = { clicks++ }) }
        onNodeWithText("Connect with Seeker").performClick()
        assertEquals(1, clicks)
    }

    @Test
    fun `a disabled sign-in button does not click`() = runComposeUiTest {
        var clicks = 0
        setContent {
            SeekerConnectButton(onClick = { clicks++ }, variant = SeekerConnectButtonVariant.SIGN_IN, enabled = false, darkTheme = false)
        }
        onNodeWithText("Sign in with Seeker").assertIsNotEnabled().performClick()
        assertEquals(0, clicks)
    }
}
