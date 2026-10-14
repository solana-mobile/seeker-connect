package com.solanamobile.seekerconnect.example

import com.solana.programs.MemoProgram
import com.solana.publickey.SolanaPublicKey
import com.solana.transaction.Blockhash
import com.solana.transaction.Message
import com.solana.transaction.Transaction

/** An unsigned transaction carrying one memo instruction, signed by [feePayer], in wire format. */
fun memoTransaction(feePayer: SolanaPublicKey, blockhash: Blockhash, memo: String): ByteArray {
    val message = Message.Builder()
        .addInstruction(MemoProgram.publishMemo(feePayer, memo))
        .setRecentBlockhash(blockhash)
        .build()
    return Transaction(message).serialize()
}
