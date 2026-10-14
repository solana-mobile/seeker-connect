package com.solanamobile.seekerconnect.example

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONException
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

const val RPC_URL = "https://api.devnet.solana.com"

private val MEMO_PROGRAM_ID = base58Decode("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr")

/** Solana shortvec: little-endian base-128 varint. */
private fun shortvec(length: Int): ByteArray {
    val out = mutableListOf<Byte>()
    var remaining = length
    while (true) {
        val byte = remaining and 0x7f
        remaining = remaining ushr 7
        if (remaining == 0) return (out + byte.toByte()).toByteArray()
        out += (byte or 0x80).toByte()
    }
}

/** An unsigned legacy transaction carrying one Memo program instruction, in wire format. */
fun buildMemoTransaction(feePayer: ByteArray, recentBlockhash: ByteArray, memo: String): ByteArray {
    val data = memo.encodeToByteArray()
    // Header: 1 required signature, 0 readonly signed, 1 readonly unsigned.
    val message = byteArrayOf(1, 0, 1) + shortvec(2) + feePayer + MEMO_PROGRAM_ID + recentBlockhash +
        shortvec(1) + byteArrayOf(1) + shortvec(0) + shortvec(data.size) + data
    // Signature count, then a zeroed placeholder for the fee payer's signature.
    return shortvec(1) + ByteArray(64) + message
}

/** Stands in for a recent blockhash when the RPC is unreachable; a cluster rejects it. */
val PLACEHOLDER_BLOCKHASH = ByteArray(32) { 1 }

/** The latest devnet blockhash; throws [IOException] when the RPC is unreachable or answers unexpectedly. */
suspend fun fetchRecentBlockhash(): ByteArray = withContext(Dispatchers.IO) {
    val connection = URL(RPC_URL).openConnection() as HttpURLConnection
    connection.connectTimeout = 4_000
    connection.readTimeout = 4_000
    connection.requestMethod = "POST"
    connection.setRequestProperty("content-type", "application/json")
    connection.doOutput = true
    connection.outputStream.use {
        it.write("""{"jsonrpc":"2.0","id":1,"method":"getLatestBlockhash"}""".encodeToByteArray())
    }
    val body = connection.inputStream.use { it.readBytes().decodeToString() }
    try {
        base58Decode(JSONObject(body).getJSONObject("result").getJSONObject("value").getString("blockhash"))
    } catch (e: JSONException) {
        throw IOException("unexpected RPC response", e)
    }
}
