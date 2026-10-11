package org.mytonwallet.app_air.tangem

/** Owned by the main thread. Invalidates callbacks from cancelled or replaced NFC sessions. */
internal class TangemSessionState<T> {
    private var generation = 0L
    private var pending: Pair<Long, (T) -> Unit>? = null

    fun begin(completion: (T) -> Unit): Long? {
        if (pending != null) return null
        val id = ++generation
        pending = id to completion
        return id
    }

    fun isActive(id: Long): Boolean = pending?.first == id

    fun finish(id: Long, result: T): Boolean {
        val request = pending?.takeIf { it.first == id } ?: return false
        pending = null
        request.second(result)
        return true
    }

    fun cancel(result: T) {
        pending?.let { finish(it.first, result) }
    }
}
