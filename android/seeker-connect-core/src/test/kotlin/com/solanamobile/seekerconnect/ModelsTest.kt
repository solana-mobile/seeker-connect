package com.solanamobile.seekerconnect

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals

class ModelsTest {
    @Test
    fun `accounts compare by content`() {
        val account = SeekerAccount("addr", byteArrayOf(1, 2), "label")
        assertEquals(account, SeekerAccount("addr", byteArrayOf(1, 2), "label"))
        assertEquals(account.hashCode(), SeekerAccount("addr", byteArrayOf(1, 2), "label").hashCode())
        assertNotEquals(account, SeekerAccount("addr", byteArrayOf(1, 3), "label"))
        assertNotEquals<Any>(account, "addr")
        assertEquals("SeekerAccount(address=addr, label=label)", account.toString())
    }

    @Test
    fun `sign-in results compare by content`() {
        val result = SeekerSignInResult("addr", byteArrayOf(1), byteArrayOf(2), byteArrayOf(3))
        assertEquals(result, SeekerSignInResult("addr", byteArrayOf(1), byteArrayOf(2), byteArrayOf(3)))
        assertEquals(result.hashCode(), SeekerSignInResult("addr", byteArrayOf(1), byteArrayOf(2), byteArrayOf(3)).hashCode())
        assertNotEquals(result, SeekerSignInResult("addr", byteArrayOf(1), byteArrayOf(2), byteArrayOf(4)))
        assertNotEquals<Any>(result, "addr")
        assertEquals("SeekerSignInResult(address=addr)", result.toString())
    }
}
