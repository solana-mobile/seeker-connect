package com.solanamobile.seekerconnect

/** The chain requested at authorization when [SeekerConnectConfig.chain] is unset. */
const val DEFAULT_SEEKER_CHAIN = "solana:mainnet"

/**
 * Shared App Link domain authorized for every certified wallet; first
 * connections target it so Android opens the installed certified wallet
 * directly, with no disambiguation dialog.
 */
const val DEFAULT_FIRST_CONNECT_WALLET_BASE_URI = "https://connect.solanamobile.com"

/** How long a session may spend associating when [SeekerConnectConfig.associationTimeoutMs] is unset. */
const val DEFAULT_ASSOCIATION_TIMEOUT_MS = 30_000L

/**
 * How the dapp identifies itself to the wallet during authorization
 * (the MWA `authorize` request's identity, shown in the wallet's consent UI).
 *
 * @property name Human-readable dapp name.
 * @property uri Absolute URI of the dapp; wallets use it to verify and display the requester.
 * @property icon Icon path, relative to [uri].
 */
data class DappIdentity(
    val name: String,
    val uri: String,
    val icon: String? = null,
)

/**
 * Configuration accepted by every Seeker Connect entry point.
 *
 * @property identity How the dapp presents itself in the wallet's consent UI.
 * @property chain Chain requested at authorization.
 * @property firstConnectWalletBaseUri Wallet base URI targeted before any wallet has been
 *   learned from an `authorize` response, when a certified wallet handles it.
 * @property associationTimeoutMs How long a session may spend associating (wallet launched
 *   but not yet connected) before failing with [SeekerConnectException.Code.ASSOCIATION_FAILED].
 *   Covers association only, never the interaction itself.
 */
data class SeekerConnectConfig(
    val identity: DappIdentity,
    val chain: String = DEFAULT_SEEKER_CHAIN,
    val firstConnectWalletBaseUri: String = DEFAULT_FIRST_CONNECT_WALLET_BASE_URI,
    val associationTimeoutMs: Long = DEFAULT_ASSOCIATION_TIMEOUT_MS,
)
