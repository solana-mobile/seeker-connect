package com.solanamobile.seekerconnect.android

import com.solana.mobilewalletadapter.clientlib.protocol.JsonRpc20Client.JsonRpc20RemoteException
import com.solana.mobilewalletadapter.clientlib.scenario.LocalAssociationScenario
import com.solana.mobilewalletadapter.common.ProtocolContract
import com.solana.mobilewalletadapter.common.util.NotifyOnCompleteFuture
import com.solanamobile.seekerconnect.SeekerConnectException
import com.solanamobile.seekerconnect.SeekerConnectException.Code
import kotlinx.coroutines.suspendCancellableCoroutine
import java.io.IOException
import java.util.concurrent.CancellationException
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeoutException

/**
 * Suspends until the future completes, without blocking a thread. Cancelling
 * the caller cancels the future; failures surface as [SeekerConnectException].
 */
internal suspend fun <T> NotifyOnCompleteFuture<T>.await(): T = suspendCancellableCoroutine { continuation ->
    continuation.invokeOnCancellation { cancel(true) }
    notifyOnComplete { future ->
        continuation.resumeWith(
            try {
                Result.success(future.get()) // complete, so this never blocks
            } catch (e: ExecutionException) {
                Result.failure((e.cause ?: e).toSeekerConnectException())
            } catch (e: CancellationException) {
                Result.failure(e.toSeekerConnectException())
            },
        )
    }
}

/** Maps a clientlib failure onto the Seeker Connect error taxonomy. */
internal fun Throwable.toSeekerConnectException(): SeekerConnectException = when (this) {
    is SeekerConnectException -> this
    is JsonRpc20RemoteException -> when (code) {
        ProtocolContract.ERROR_AUTHORIZATION_FAILED -> SeekerConnectException(Code.AUTHORIZATION_DECLINED, "The wallet declined authorization", this)
        ProtocolContract.ERROR_NOT_SIGNED, ProtocolContract.ERROR_NOT_SUBMITTED -> SeekerConnectException(Code.REQUEST_DECLINED, "The wallet declined the request", this)
        else -> SeekerConnectException(Code.WALLET_ERROR, "The wallet reported error $code: $message", this)
    }
    is LocalAssociationScenario.ConnectionFailedException -> SeekerConnectException(Code.ASSOCIATION_FAILED, "No wallet completed association", this)
    is IOException, is TimeoutException, is CancellationException -> SeekerConnectException(Code.SESSION_CLOSED, "The wallet session ended", this)
    else -> SeekerConnectException(Code.WALLET_ERROR, "The wallet request failed: $message", this)
}
