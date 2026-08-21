package com.imran.recorder

import com.imran.recorder.ui.intro.IntroTimeline as T
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The launch sequence has a budget and a running order; both are asserted here. */
class IntroTimelineTest {

    @Test fun `whole sequence fits inside three seconds`() {
        assertTrue("intro runs $T.T_END s", T.T_END <= 3.0f)
    }

    @Test fun `beats run in the intended order`() {
        val beats = listOf(
            T.T_DRIFT_END, T.T_RING_IN, T.T_TRAVEL_END, T.T_ASSEMBLE_IN,
            T.T_WORD_IN, T.T_ASSEMBLE_OUT, T.T_SUB_IN, T.T_PULSE, T.T_PORTAL, T.T_END
        )
        assertEquals(beats.sorted(), beats)
    }

    @Test fun `each beat lands in its window`() {
        assertTrue(T.T_DRIFT_END in 0.3f..0.5f)                 // stars settled
        assertTrue(T.T_TRAVEL_END in 1.0f..1.3f)                // travel done
        assertTrue(T.T_RING_IN in 1.1f..1.3f)                   // ring forms
        assertTrue(T.T_ASSEMBLE_OUT in 1.8f..2.0f)              // mark whole
        assertTrue(T.T_WORD_IN in 1.8f..2.1f)                   // wordmark reveal
        assertTrue(T.T_PORTAL in 2.3f..2.5f)                    // dive begins
    }

    @Test fun `the mark is whole before the pulse hits it`() {
        assertTrue(T.T_PULSE > T.T_ASSEMBLE_OUT - 0.001f)
    }

    @Test fun `the dive is long enough to read as a transition`() {
        assertTrue(T.T_END - T.T_PORTAL >= 0.4f)
    }

    @Test fun `smooth clamps outside its span`() {
        assertEquals(0f, T.smooth(1f, 2f, 0.5f), 1e-6f)
        assertEquals(0f, T.smooth(1f, 2f, 1f), 1e-6f)
        assertEquals(0.5f, T.smooth(1f, 2f, 1.5f), 1e-6f)
        assertEquals(1f, T.smooth(1f, 2f, 2f), 1e-6f)
        assertEquals(1f, T.smooth(1f, 2f, 9f), 1e-6f)
    }

    @Test fun `easings pin to zero and one`() {
        for (f in listOf(T::easeIn, T::easeOut, T::easeInOut)) {
            assertEquals(0f, f.invoke(0f), 1e-5f)
            assertEquals(1f, f.invoke(1f), 1e-5f)
        }
        // easeInOut is symmetric about its midpoint
        assertEquals(0.5f, T.easeInOut(0.5f), 1e-5f)
        assertEquals(1f, T.easeInOut(0.25f) + T.easeInOut(0.75f), 1e-4f)
    }

    @Test fun `camera drifts, accelerates, eases off, then dives`() {
        val drift = T.speedAt(0.2f)
        val travel = T.speedAt(T.T_TRAVEL_END - 0.01f)
        val hold = T.speedAt(T.T_PORTAL - 0.01f)
        val dive = T.speedAt(T.T_END)

        assertTrue("drift $drift < travel $travel", drift < travel)
        assertTrue("hold $hold < travel $travel", hold < travel)
        assertTrue("hold $hold > 0", hold > 0f)
        assertTrue("dive $dive > travel $travel", dive > travel * 3f)
    }

    @Test fun `speed never reverses or stalls`() {
        var t = 0f
        while (t <= T.T_END) {
            assertTrue("speed at $t", T.speedAt(t) > 0f)
            t += 0.01f
        }
    }

    @Test fun `portal progress spans the dive only`() {
        assertEquals(0f, T.portalProgress(0f), 1e-6f)
        assertEquals(0f, T.portalProgress(T.T_PORTAL), 1e-6f)
        assertEquals(1f, T.portalProgress(T.T_END), 1e-6f)
        assertEquals(1f, T.portalProgress(T.T_END + 5f), 1e-6f)
        assertTrue(T.portalProgress((T.T_PORTAL + T.T_END) / 2f) in 0.4f..0.6f)
    }

    @Test fun `skipping jumps to the dive and still ends cleanly`() {
        val skipAt = 0.8f
        assertEquals("no skip is a passthrough", 0.8f, T.skipTime(0.8f, -1f), 1e-6f)

        // the instant of the tap already sits at the start of the dive
        assertEquals(T.T_PORTAL, T.skipTime(skipAt, skipAt), 1e-5f)

        // and it runs forward to the end without overshooting
        var prev = -1f
        var raw = skipAt
        while (raw <= skipAt + 2f) {
            val t = T.skipTime(raw, skipAt)
            assertTrue("t=$t stays in the dive", t >= T.T_PORTAL - 1e-4f && t <= T.T_END)
            assertTrue("t=$t is monotonic", t >= prev)
            prev = t
            raw += 0.01f
        }
        assertEquals("a skip terminates", T.T_END, prev, 1e-4f)
    }

    @Test fun `a late skip never rewinds the clock`() {
        val skipAt = T.T_PORTAL + 0.3f
        assertTrue(T.skipTime(skipAt, skipAt) >= skipAt)
    }
}
