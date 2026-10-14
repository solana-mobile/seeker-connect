package com.solanamobile.seekerconnect.example

import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class HelpersTest {
    @Test
    fun `base58 round-trips, keeping leading zero bytes`() {
        val bytes = byteArrayOf(0, 0, 1, 2, 3, -1)
        val encoded = base58Encode(bytes)
        assertTrue(encoded.startsWith("11"))
        assertContentEquals(bytes, base58Decode(encoded))
    }

    @Test
    fun `base58 decodes a known program id to 32 bytes`() {
        val memoProgram = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
        assertEquals(32, base58Decode(memoProgram).size)
        assertEquals(memoProgram, base58Encode(base58Decode(memoProgram)))
    }

    @Test
    fun `base58 rejects characters outside the alphabet`() {
        assertFailsWith<IllegalArgumentException> { base58Decode("0OIl") }
    }

    @Test
    fun `the memo transaction has the legacy wire layout`() {
        val feePayer = ByteArray(32) { 7 }
        val blockhash = ByteArray(32) { 9 }
        val transaction = buildMemoTransaction(feePayer, blockhash, "hi")
        assertEquals(1, transaction[0].toInt()) // one signature
        assertContentEquals(ByteArray(64), transaction.copyOfRange(1, 65)) // unsigned placeholder
        val message = transaction.copyOfRange(65, transaction.size)
        assertContentEquals(byteArrayOf(1, 0, 1, 2), message.copyOfRange(0, 4)) // header, 2 account keys
        assertContentEquals(feePayer, message.copyOfRange(4, 36))
        assertContentEquals(base58Decode("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"), message.copyOfRange(36, 68))
        assertContentEquals(blockhash, message.copyOfRange(68, 100))
        // 1 instruction: program index 1, no accounts, 2 data bytes
        assertContentEquals(byteArrayOf(1, 1, 0, 2) + "hi".encodeToByteArray(), message.copyOfRange(100, message.size))
    }

    @Test
    fun `long memos use a multi-byte shortvec length`() {
        val transaction = buildMemoTransaction(ByteArray(32), ByteArray(32), "x".repeat(200))
        // 200 = 0xC8: low 7 bits with the continuation bit, then 1.
        assertContentEquals(byteArrayOf(0xC8.toByte(), 1), transaction.copyOfRange(65 + 103, 65 + 105))
    }
}
