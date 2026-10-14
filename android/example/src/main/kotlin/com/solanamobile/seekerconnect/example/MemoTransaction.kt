package com.solanamobile.seekerconnect.example

import com.funkatronics.encoders.Base58
import com.solana.programs.MemoProgram
import com.solana.publickey.SolanaPublicKey
import com.solana.transaction.Blockhash
import com.solana.transaction.Message
import com.solana.transaction.Transaction
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONException
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

const val RPC_URL = "https://api.devnet.solana.com"

/** Stands in for a recent blockhash when the RPC is unreachable; a cluster rejects it. */
val PLACEHOLDER_BLOCKHASH = Blockhash(ByteArray(32) { 1 })

/** An unsigned transaction carrying one memo instruction, signed by [feePayer], in wire format. */
fun memoTransaction(feePayer: ByteArray, blockhash: Blockhash): ByteArray {
    val payer = SolanaPublicKey(feePayer)
    val message = Message.Builder()
        .addInstruction(MemoProgram.publishMemo(payer, "Seeker Connect example"))
        .setRecentBlockhash(blockhash)
        .build()
    return Transaction(message).serialize()
}

/** The latest devnet blockhash; throws [IOException] when the RPC is unreachable or answers unexpectedly. */
suspend fun fetchRecentBlockhash(): Blockhash = withContext(Dispatchers.IO) {
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
        Blockhash(Base58.decode(JSONObject(body).getJSONObject("result").getJSONObject("value").getString("blockhash")))
    } catch (e: JSONException) {
        throw IOException("unexpected RPC response", e)
    }
}
