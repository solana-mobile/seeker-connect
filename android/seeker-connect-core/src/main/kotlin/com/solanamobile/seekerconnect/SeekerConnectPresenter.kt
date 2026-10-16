package com.solanamobile.seekerconnect

/**
 * Surface for Seeker-Connect-owned UI shown around wallet interactions.
 * Implementations must tolerate any call ordering and never throw.
 */
interface SeekerConnectPresenter {
    /**
     * A wallet interaction has started. [cancel] aborts it (e.g. the user closed
     * the progress UI) and is safe to call at any time. Returns a closer invoked
     * when the interaction settles, success or not.
     */
    fun interactionStarted(cancel: () -> Unit): () -> Unit

    /** A wallet interaction failed in a way the user should be told about. */
    fun interactionFailed(error: SeekerConnectException)

    /** Shows nothing. */
    companion object None : SeekerConnectPresenter {
        override fun interactionStarted(cancel: () -> Unit): () -> Unit = {}

        override fun interactionFailed(error: SeekerConnectException) {}
    }
}
