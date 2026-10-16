package com.solanamobile.seekerconnect.android

import android.net.Uri
import com.solana.mobilewalletadapter.clientlib.protocol.MobileWalletAdapterClient
import com.solana.mobilewalletadapter.common.ProtocolContract
import com.solana.mobilewalletadapter.common.protocol.SessionProperties.ProtocolVersion
import com.solana.mobilewalletadapter.common.signin.SignInWithSolana
import com.solana.mobilewalletadapter.common.util.Base58
import com.solana.mobilewalletadapter.common.util.NotifyOnCompleteFuture
import com.solanamobile.seekerconnect.SeekerAccount
import com.solanamobile.seekerconnect.SeekerAuthorization
import com.solanamobile.seekerconnect.SeekerConnectConfig
import com.solanamobile.seekerconnect.SeekerConnectException
import com.solanamobile.seekerconnect.SeekerConnectException.Code
import com.solanamobile.seekerconnect.SeekerSignAndSendOptions
import com.solanamobile.seekerconnect.SeekerSignInPayload
import com.solanamobile.seekerconnect.SeekerSignInResult
import com.solanamobile.seekerconnect.SeekerWallet
import com.solanamobile.seekerconnect.SeekerWalletCapabilities
import java.io.IOException

/** [SeekerWallet] over one established clientlib session. */
internal class MwaSeekerWallet(
    private val client: MobileWalletAdapterClient,
    private val protocolVersion: ProtocolVersion,
    private val config: SeekerConnectConfig,
) : SeekerWallet {
    private val identityUri = Uri.parse(config.identity.uri)
    private val iconUri = config.identity.icon?.let(Uri::parse)
    private val identityName = config.identity.name

    override suspend fun authorize(
        chain: String?,
        authToken: String?,
        signInPayload: SeekerSignInPayload?,
    ): SeekerAuthorization {
        val chain = chain ?: config.chain
        val siws = signInPayload?.toMwa()
        val result = call {
            if (protocolVersion == ProtocolVersion.LEGACY) {
                // Pre-2.0 wallets: a token is reused through `reauthorize`, and the chain is a cluster name.
                if (authToken != null) {
                    client.reauthorize(identityUri, iconUri, identityName, authToken)
                } else {
                    @Suppress("DEPRECATION")
                    client.authorize(identityUri, iconUri, identityName, LEGACY_CLUSTERS[chain] ?: chain)
                }
            } else {
                client.authorize(identityUri, iconUri, identityName, chain, authToken, null, null, siws)
            }
        }
        val signInResult = siws?.let { payload ->
            result.signInResult?.let { SeekerSignInResult(Base58.encode(it.publicKey), it.publicKey, it.signedMessage, it.signature) }
                ?: signInWithMessage(payload, result.accounts.first().publicKey)
        }
        return SeekerAuthorization(
            accounts = result.accounts.map { SeekerAccount(Base58.encode(it.publicKey), it.publicKey, it.accountLabel) },
            authToken = result.authToken,
            walletUriBase = result.walletUriBase?.toString(),
            signInResult = signInResult,
        )
    }

    override suspend fun deauthorize(authToken: String) {
        call { client.deauthorize(authToken) }
    }

    override suspend fun getCapabilities(): SeekerWalletCapabilities {
        val capabilities = call { client.capabilities }
        return SeekerWalletCapabilities(
            // 0 on the wire: no limit.
            maxMessagesPerRequest = capabilities.maxMessagesPerSigningRequest.takeIf { it > 0 },
            maxTransactionsPerRequest = capabilities.maxTransactionsPerSigningRequest.takeIf { it > 0 },
            supportedTransactionVersions = capabilities.supportedTransactionVersions.toList(),
            features = capabilities.supportedOptionalFeatures.toList(),
            supportsSignAndSendTransactions = capabilities.supportsSignAndSendTransactions,
        )
    }

    // signMessagesDetached splits the signed payloads; SeekerWallet returns them whole.
    @Suppress("DEPRECATION")
    override suspend fun signMessages(addresses: List<String>, payloads: List<ByteArray>): List<ByteArray> =
        call { client.signMessages(payloads.toTypedArray(), addresses.map(Base58::decode).toTypedArray()) }
            .signedPayloads.toList()

    override suspend fun signTransactions(payloads: List<ByteArray>): List<ByteArray> =
        call { client.signTransactions(payloads.toTypedArray()) }.signedPayloads.toList()

    override suspend fun signAndSendTransactions(
        payloads: List<ByteArray>,
        options: SeekerSignAndSendOptions?,
    ): List<ByteArray> = call {
        client.signAndSendTransactions(
            payloads.toTypedArray(),
            options?.minContextSlot,
            options?.commitment,
            options?.skipPreflight,
            options?.maxRetries,
            options?.waitForCommitmentToSendNextTransaction,
        )
    }.signatures.toList()

    /** Sign-In-With-Solana for wallets that return no sign-in result: the SIWS message, signed with `sign_messages`. */
    private suspend fun signInWithMessage(payload: SignInWithSolana.Payload, account: ByteArray): SeekerSignInResult {
        val address = payload.addressRaw ?: account
        val message = payload.prepareMessage(address).encodeToByteArray()
        val signed = call { client.signMessagesDetached(arrayOf(message), arrayOf(address)) }.messages.first()
        return SeekerSignInResult(Base58.encode(address), address, signed.message, signed.signatures.first())
    }

    private fun SeekerSignInPayload.toMwa() = SignInWithSolana.Payload(
        domain ?: identityUri.host,
        address?.let(Base58::decode),
        statement,
        uri?.let(Uri::parse),
        version,
        chainId,
        nonce,
        issuedAt,
        expirationTime,
        notBefore,
        requestId,
        resources?.map(Uri::parse)?.toTypedArray(),
    )

    /** Sends one request; failing to send means the session is gone. */
    private suspend fun <T> call(request: () -> NotifyOnCompleteFuture<T>): T {
        val future = try {
            request()
        } catch (e: IOException) {
            throw SeekerConnectException(Code.SESSION_CLOSED, "The wallet session ended", e)
        }
        return future.await()
    }

    private companion object {
        val LEGACY_CLUSTERS = mapOf(
            ProtocolContract.CHAIN_SOLANA_MAINNET to ProtocolContract.CLUSTER_MAINNET_BETA,
            ProtocolContract.CHAIN_SOLANA_TESTNET to ProtocolContract.CLUSTER_TESTNET,
            ProtocolContract.CHAIN_SOLANA_DEVNET to ProtocolContract.CLUSTER_DEVNET,
        )
    }
}
