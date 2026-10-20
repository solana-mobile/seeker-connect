package com.solanamobile.seekerconnect.android

import android.content.Context
import android.util.Base64
import com.solanamobile.seekerconnect.AuthorizationCache
import com.solanamobile.seekerconnect.SeekerAccount
import com.solanamobile.seekerconnect.SeekerWalletCapabilities
import com.solanamobile.seekerconnect.StoredAuthorization
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/** [AuthorizationCache] in `SharedPreferences`; survives process death. */
class SharedPreferencesAuthorizationCache(
    context: Context,
    name: String = "SeekerConnectAuthorizationCache",
) : AuthorizationCache {
    private val preferences = context.applicationContext.getSharedPreferences(name, Context.MODE_PRIVATE)

    /** The stored authorization; null when none is stored or it is unreadable (corrupt, or another format version). */
    override suspend fun get(): StoredAuthorization? {
        val json = preferences.getString(KEY, null) ?: return null
        return try {
            JSONObject(json).takeIf { it.getInt("version") == VERSION }?.toStoredAuthorization()
        } catch (e: JSONException) {
            null
        } catch (e: IllegalArgumentException) {
            null // bad base64
        }
    }

    override suspend fun set(authorization: StoredAuthorization) {
        preferences.edit().putString(KEY, authorization.toJson().toString()).apply()
    }

    override suspend fun clear() {
        preferences.edit().remove(KEY).apply()
    }

    private companion object {
        const val KEY = "authorization"
        const val VERSION = 1

        fun StoredAuthorization.toJson() = JSONObject()
            .put("version", VERSION)
            .put("accounts", JSONArray(accounts.map {
                JSONObject()
                    .put("address", it.address)
                    .put("publicKey", Base64.encodeToString(it.publicKey, Base64.NO_WRAP))
                    .putOpt("label", it.label)
            }))
            .put("authToken", authToken)
            .putOpt("walletUriBase", walletUriBase)
            .put("chain", chain)
            .put("capabilities", JSONObject()
                .putOpt("maxMessagesPerRequest", capabilities.maxMessagesPerRequest)
                .putOpt("maxTransactionsPerRequest", capabilities.maxTransactionsPerRequest)
                .put("supportedTransactionVersions", JSONArray(capabilities.supportedTransactionVersions))
                .put("features", JSONArray(capabilities.features))
                .put("supportsSignAndSendTransactions", capabilities.supportsSignAndSendTransactions))

        fun JSONObject.toStoredAuthorization(): StoredAuthorization {
            val capabilities = getJSONObject("capabilities")
            return StoredAuthorization(
                accounts = getJSONArray("accounts").objects().map {
                    SeekerAccount(
                        it.getString("address"),
                        Base64.decode(it.getString("publicKey"), Base64.NO_WRAP),
                        it.optStringOrNull("label"),
                    )
                },
                authToken = getString("authToken"),
                walletUriBase = optStringOrNull("walletUriBase"),
                chain = getString("chain"),
                capabilities = SeekerWalletCapabilities(
                    maxMessagesPerRequest = capabilities.optIntOrNull("maxMessagesPerRequest"),
                    maxTransactionsPerRequest = capabilities.optIntOrNull("maxTransactionsPerRequest"),
                    supportedTransactionVersions = capabilities.getJSONArray("supportedTransactionVersions").let { versions ->
                        List(versions.length()) { versions.get(it) }
                    },
                    features = capabilities.getJSONArray("features").let { features ->
                        List(features.length()) { features.getString(it) }
                    },
                    supportsSignAndSendTransactions = capabilities.getBoolean("supportsSignAndSendTransactions"),
                ),
            )
        }

        fun JSONArray.objects() = List(length()) { getJSONObject(it) }

        fun JSONObject.optStringOrNull(key: String) = if (has(key)) getString(key) else null

        fun JSONObject.optIntOrNull(key: String) = if (has(key)) getInt(key) else null
    }
}
