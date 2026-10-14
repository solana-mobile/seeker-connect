package com.solanamobile.seekerconnect.example

import java.math.BigInteger

/** Minimal base58 (Bitcoin alphabet) for display and known program ids. */
private const val ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
private val BASE = BigInteger.valueOf(58)

fun base58Encode(bytes: ByteArray): String {
    var value = BigInteger(1, bytes)
    val out = StringBuilder()
    while (value.signum() > 0) {
        val (quotient, remainder) = value.divideAndRemainder(BASE)
        out.append(ALPHABET[remainder.toInt()])
        value = quotient
    }
    repeat(bytes.takeWhile { it == 0.toByte() }.size) { out.append('1') }
    return out.reverse().toString()
}

fun base58Decode(encoded: String): ByteArray {
    var value = BigInteger.ZERO
    for (char in encoded) {
        val index = ALPHABET.indexOf(char)
        require(index >= 0) { "invalid base58 character: $char" }
        value = value * BASE + BigInteger.valueOf(index.toLong())
    }
    val magnitude = value.toByteArray().dropWhile { it == 0.toByte() }
    return ByteArray(encoded.takeWhile { it == '1' }.length) + magnitude.toByteArray()
}
