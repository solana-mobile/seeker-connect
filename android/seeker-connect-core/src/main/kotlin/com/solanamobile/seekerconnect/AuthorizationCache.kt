package com.solanamobile.seekerconnect

/** Persistence for the wallet-issued authorization, injectable per platform. */
interface AuthorizationCache {
    /** The stored authorization, or null when none is stored. */
    suspend fun get(): StoredAuthorization?

    suspend fun set(authorization: StoredAuthorization)

    suspend fun clear()
}

/** In-memory [AuthorizationCache]; nothing survives the process. */
class MemoryAuthorizationCache : AuthorizationCache {
    private var stored: StoredAuthorization? = null

    override suspend fun get() = stored

    override suspend fun set(authorization: StoredAuthorization) {
        stored = authorization
    }

    override suspend fun clear() {
        stored = null
    }
}
