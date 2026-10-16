package com.solanamobile.seekerconnect.android

import com.solana.mobilewalletadapter.clientlib.protocol.JsonRpc20Client.JsonRpc20InvalidResponseException
import com.solana.mobilewalletadapter.clientlib.protocol.JsonRpc20Client.JsonRpc20RemoteException
import com.solana.mobilewalletadapter.clientlib.scenario.LocalAssociationScenario
import com.solana.mobilewalletadapter.common.ProtocolContract
import com.solana.mobilewalletadapter.common.util.NotifyingCompletableFuture
import com.solanamobile.seekerconnect.SeekerConnectException
import com.solanamobile.seekerconnect.SeekerConnectException.Code
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import java.io.IOException
import java.util.concurrent.CancellationException
import java.util.concurrent.TimeoutException
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertSame
import kotlin.test.assertTrue

class MwaFuturesTest {
    @Test
    fun `maps clientlib failures onto the error taxonomy`() {
        val cases = mapOf(
            JsonRpc20RemoteException(ProtocolContract.ERROR_AUTHORIZATION_FAILED, "declined", null) to Code.AUTHORIZATION_DECLINED,
            JsonRpc20RemoteException(ProtocolContract.ERROR_NOT_SIGNED, "not signed", null) to Code.REQUEST_DECLINED,
            JsonRpc20RemoteException(ProtocolContract.ERROR_NOT_SUBMITTED, "not submitted", null) to Code.REQUEST_DECLINED,
            JsonRpc20RemoteException(ProtocolContract.ERROR_TOO_MANY_PAYLOADS, "too many", null) to Code.WALLET_ERROR,
            LocalAssociationScenario.ConnectionFailedException("no wallet") to Code.ASSOCIATION_FAILED,
            IOException("gone") to Code.SESSION_CLOSED,
            TimeoutException("slow") to Code.SESSION_CLOSED,
            CancellationException("cancelled") to Code.SESSION_CLOSED,
            JsonRpc20InvalidResponseException("garbled") to Code.WALLET_ERROR,
        )
        for ((failure, code) in cases) {
            val mapped = failure.toSeekerConnectException()
            assertEquals(code, mapped.code, "$failure")
            assertSame(failure, mapped.cause)
        }
        val error = SeekerConnectException(Code.CANCELLED, "already mapped")
        assertSame(error, error.toSeekerConnectException())
    }

    @Test
    fun `await returns the result`() = runTest {
        val future = NotifyingCompletableFuture<String>()
        future.complete("result")
        assertEquals("result", future.await())
    }

    @Test
    fun `await maps the failure`() = runTest {
        val future = NotifyingCompletableFuture<String>()
        future.completeExceptionally(IOException("gone"))
        assertEquals(Code.SESSION_CLOSED, assertFailsWith<SeekerConnectException> { future.await() }.code)
    }

    @Test
    fun `await reports a future cancelled elsewhere as session-closed`() = runTest {
        val future = NotifyingCompletableFuture<String>()
        future.cancel(true)
        assertEquals(Code.SESSION_CLOSED, assertFailsWith<SeekerConnectException> { future.await() }.code)
    }

    @Test
    fun `cancelling the caller cancels the future`() = runTest {
        val future = NotifyingCompletableFuture<String>()
        val awaiting = async(start = CoroutineStart.UNDISPATCHED) { future.await() }
        awaiting.cancel()
        assertTrue(future.isCancelled)
    }
}
