package com.solanamobile.seekerconnect.compose

import com.solanamobile.seekerconnect.SeekerConnectException
import com.solanamobile.seekerconnect.SeekerConnectException.Code
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull

class SeekerConnectDialogStateTest {
    private val state = SeekerConnectDialogState()

    @Test
    fun `shows progress until the interaction settles`() {
        val settle = state.interactionStarted {}
        assertIs<SeekerConnectDialogState.Shown.Progress>(state.shown)
        settle()
        assertNull(state.shown)
    }

    @Test
    fun `a failure replaces the progress and outlives the settle`() {
        val settle = state.interactionStarted {}
        state.interactionFailed(SeekerConnectException(Code.SESSION_CLOSED, "closed"))
        settle()
        assertEquals(Code.SESSION_CLOSED, (state.shown as SeekerConnectDialogState.Shown.Error).code)
    }

    @Test
    fun `dismissing the progress cancels the interaction`() {
        var cancelled = 0
        state.interactionStarted { cancelled++ }
        state.dismiss()
        assertEquals(1, cancelled)
        assertNull(state.shown)
    }

    @Test
    fun `dismissing an error just closes it`() {
        state.interactionFailed(SeekerConnectException(Code.WALLET_ERROR, "boom"))
        state.dismiss()
        assertNull(state.shown)
    }

    @Test
    fun `every code has copy, and only declines use the declined icon`() {
        assertEquals(setOf(Code.AUTHORIZATION_DECLINED, Code.REQUEST_DECLINED), Code.entries.filter { errorCopy(it).declined }.toSet())
        assertEquals(errorCopy(Code.ASSOCIATION_FAILED).title, errorCopy(Code.NO_WALLET_FOUND).title)
    }
}
