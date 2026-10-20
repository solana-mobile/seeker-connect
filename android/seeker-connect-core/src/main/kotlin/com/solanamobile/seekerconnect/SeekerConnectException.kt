package com.solanamobile.seekerconnect

/** The only exception Seeker Connect throws for wallet and transport failures. */
class SeekerConnectException(
    val code: Code,
    message: String,
    cause: Throwable? = null,
) : Exception(message, cause) {
    enum class Code {
        /** No MWA wallet is installed. */
        NO_WALLET_FOUND,

        /** No wallet completed the association (timeout, wallet closed, connection failed). */
        ASSOCIATION_FAILED,

        /** The wallet declined authorization (MWA `ERROR_AUTHORIZATION_FAILED`). */
        AUTHORIZATION_DECLINED,

        /** The wallet declined to sign or submit (MWA `ERROR_NOT_SIGNED`/`ERROR_NOT_SUBMITTED`). */
        REQUEST_DECLINED,

        /** The session ended before the interaction completed. */
        SESSION_CLOSED,

        /** The user cancelled from Seeker Connect UI, or disconnected mid-interaction. */
        CANCELLED,

        /** Any other wallet-reported error. */
        WALLET_ERROR,
    }
}
