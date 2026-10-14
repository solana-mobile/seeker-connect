package com.solanamobile.seekerconnect.reactnative

import android.util.Base64
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.solanamobile.seekerconnect.DEFAULT_ASSOCIATION_TIMEOUT_MS
import com.solanamobile.seekerconnect.DEFAULT_FIRST_CONNECT_WALLET_BASE_URI
import com.solanamobile.seekerconnect.DEFAULT_SEEKER_CHAIN
import com.solanamobile.seekerconnect.DappIdentity
import com.solanamobile.seekerconnect.SeekerAccount
import com.solanamobile.seekerconnect.SeekerConnectConfig
import com.solanamobile.seekerconnect.SeekerSignAndSendOptions
import com.solanamobile.seekerconnect.SeekerSignInPayload
import com.solanamobile.seekerconnect.SeekerSignInResult
import com.solanamobile.seekerconnect.StoredAuthorization

/** Builds the values the module resolves with; native-backed in an app, plain maps in tests. */
internal class BridgeValues(
    val newMap: () -> WritableMap,
    val newArray: () -> WritableArray,
) {
    fun authorization(authorization: StoredAuthorization): WritableMap = newMap().apply {
        putArray("accounts", newArray().apply { authorization.accounts.forEach { pushMap(account(it)) } })
        putString("authToken", authorization.authToken)
        putString("walletUriBase", authorization.walletUriBase)
        putString("chain", authorization.chain)
        putMap("capabilities", newMap().apply {
            authorization.capabilities.maxMessagesPerRequest?.let { putInt("maxMessagesPerRequest", it) }
            authorization.capabilities.maxTransactionsPerRequest?.let { putInt("maxTransactionsPerRequest", it) }
            putArray("supportedTransactionVersions", newArray().apply {
                authorization.capabilities.supportedTransactionVersions.forEach { version ->
                    if (version is Number) pushInt(version.toInt()) else pushString(version.toString())
                }
            })
            putArray("features", newArray().apply { authorization.capabilities.features.forEach(::pushString) })
            putBoolean("supportsSignAndSendTransactions", authorization.capabilities.supportsSignAndSendTransactions)
        })
    }

    fun signInResult(result: SeekerSignInResult): WritableMap = newMap().apply {
        putString("address", result.address)
        putString("publicKey", result.publicKey.base64())
        putString("signedMessage", result.signedMessage.base64())
        putString("signature", result.signature.base64())
    }

    fun bytesArray(values: List<ByteArray>): WritableArray = newArray().apply { values.forEach { pushString(it.base64()) } }

    private fun account(account: SeekerAccount): WritableMap = newMap().apply {
        putString("address", account.address)
        putString("publicKey", account.publicKey.base64())
        putString("label", account.label)
    }
}

internal fun seekerConnectConfig(config: ReadableMap): SeekerConnectConfig {
    val identity = config.requiredMap("identity")
    return SeekerConnectConfig(
        identity = DappIdentity(identity.requiredString("name"), identity.requiredString("uri"), identity.optionalString("icon")),
        chain = config.optionalString("chain") ?: DEFAULT_SEEKER_CHAIN,
        firstConnectWalletBaseUri = config.optionalString("firstConnectWalletBaseUri") ?: DEFAULT_FIRST_CONNECT_WALLET_BASE_URI,
        associationTimeoutMs = if (config.hasKey("associationTimeoutMs")) {
            config.getDouble("associationTimeoutMs").toLong()
        } else {
            DEFAULT_ASSOCIATION_TIMEOUT_MS
        },
    )
}

internal fun signInPayload(payload: ReadableMap?): SeekerSignInPayload = SeekerSignInPayload(
    domain = payload?.optionalString("domain"),
    address = payload?.optionalString("address"),
    statement = payload?.optionalString("statement"),
    uri = payload?.optionalString("uri"),
    version = payload?.optionalString("version"),
    chainId = payload?.optionalString("chainId"),
    nonce = payload?.optionalString("nonce"),
    issuedAt = payload?.optionalString("issuedAt"),
    expirationTime = payload?.optionalString("expirationTime"),
    notBefore = payload?.optionalString("notBefore"),
    requestId = payload?.optionalString("requestId"),
    resources = payload?.takeIf { it.hasKey("resources") }?.getArray("resources")?.strings(),
)

internal fun signAndSendOptions(options: ReadableMap?): SeekerSignAndSendOptions? = options?.let {
    SeekerSignAndSendOptions(
        minContextSlot = if (it.hasKey("minContextSlot")) it.getInt("minContextSlot") else null,
        commitment = it.optionalString("commitment"),
        skipPreflight = if (it.hasKey("skipPreflight")) it.getBoolean("skipPreflight") else null,
        maxRetries = if (it.hasKey("maxRetries")) it.getInt("maxRetries") else null,
        waitForCommitmentToSendNextTransaction =
            if (it.hasKey("waitForCommitmentToSendNextTransaction")) it.getBoolean("waitForCommitmentToSendNextTransaction") else null,
    )
}

internal fun ReadableArray.strings(): List<String> = List(size()) { index -> getString(index) }

internal fun ReadableArray.bytes(): List<ByteArray> = strings().map { Base64.decode(it, Base64.NO_WRAP) }

internal fun ReadableMap.requiredArray(key: String): ReadableArray =
    requireNotNull(takeIf { hasKey(key) }?.getArray(key)) { "Missing array: $key" }

internal fun ReadableMap.requiredMap(key: String): ReadableMap =
    requireNotNull(takeIf { hasKey(key) }?.getMap(key)) { "Missing object: $key" }

private fun ReadableMap.requiredString(key: String): String =
    requireNotNull(optionalString(key)) { "Missing string: $key" }

private fun ReadableMap.optionalString(key: String): String? = if (hasKey(key) && !isNull(key)) getString(key) else null

private fun ByteArray.base64(): String = Base64.encodeToString(this, Base64.NO_WRAP)
