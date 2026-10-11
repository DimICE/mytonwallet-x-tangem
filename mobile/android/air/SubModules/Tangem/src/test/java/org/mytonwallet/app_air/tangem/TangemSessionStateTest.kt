package org.mytonwallet.app_air.tangem

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TangemSessionStateTest {
    @Test
    fun cancellationInvalidatesLateSignatureAndAllowsAnotherSession() {
        val state = TangemSessionState<String>()
        val results = mutableListOf<String>()
        val first = state.begin { results.add(it) }!!
        assertNull(state.begin { results.add("unexpected") })
        state.cancel("cancelled")
        val second = state.begin { results.add(it) }!!
        assertFalse(state.isActive(first))
        assertFalse(state.finish(first, "stale signature"))
        assertTrue(state.isActive(second))
        assertTrue(state.finish(second, "verified signature"))
        assertFalse(state.finish(second, "duplicate callback"))
        state.cancel("late cancellation")
        assertEquals(listOf("cancelled", "verified signature"), results)
    }

    @Test
    fun completionMayStartNextSessionWithoutLosingIt() {
        val state = TangemSessionState<String>()
        var next: Long? = null
        val first = state.begin { next = state.begin {} }!!
        state.finish(first, "done")
        assertTrue(state.isActive(next!!))
    }
}
