package com.imran.recorder

import com.imran.recorder.overlay.ArcLayout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.hypot

/** Geometry checks for the floating button's arc menu. */
class ArcLayoutTest {

    // A 1080x2400 phone with the button parked on the right edge.
    private val screenW = 1080
    private val screenH = 2400
    private val holder = 288          // 96dp @ 3x
    private val iconHalf = 69         // 23dp @ 3x
    private val itemW = 420
    private val itemH = 138
    private val radius = 372f         // 124dp @ 3x

    private fun iconCentre(p: ArcLayout.Placement, fanLeft: Boolean): Pair<Double, Double> {
        val x = if (fanLeft) p.left + (itemW - iconHalf) else p.left + iconHalf
        return x.toDouble() to (p.top + itemH / 2.0)
    }

    @Test
    fun `items sit on the arc radius around the button`() {
        // Docked right, where a left fan genuinely fits, so nothing gets clamped.
        val cx = screenW - holder / 2
        val cy = 900
        val count = 6
        repeat(count) { i ->
            val p = ArcLayout.place(
                i, count, cx, cy, radius, fanLeft = true,
                itemWidth = itemW, itemHeight = itemH, iconHalf = iconHalf,
                screenWidth = screenW, screenHeight = screenH
            )
            val (ix, iy) = iconCentre(p, true)
            val d = hypot(ix - cx, iy - cy)
            // Integer rounding of the placement costs at most a pixel or two.
            assertTrue("item $i off-radius: $d", kotlin.math.abs(d - radius) < 3.0)
        }
    }

    @Test
    fun `fan runs from above the button to below it`() {
        val cx = screenW - holder / 2
        val cy = 1200
        val count = 6
        val ys = (0 until count).map { i ->
            iconCentre(
                ArcLayout.place(
                    i, count, cx, cy, radius, fanLeft = true,
                    itemWidth = itemW, itemHeight = itemH, iconHalf = iconHalf,
                    screenWidth = screenW, screenHeight = screenH
                ),
                true
            ).second
        }
        assertTrue("first item should be above the button", ys.first() < cy)
        assertTrue("last item should be below the button", ys.last() > cy)
        assertEquals("items should descend monotonically", ys.sorted(), ys)
    }

    @Test
    fun `left fan puts rows left of the button, right fan puts them right`() {
        val cx = 540
        val cy = 1200
        val left = ArcLayout.place(
            2, 6, cx, cy, radius, fanLeft = true,
            itemWidth = itemW, itemHeight = itemH, iconHalf = iconHalf,
            screenWidth = screenW, screenHeight = screenH
        )
        val right = ArcLayout.place(
            2, 6, cx, cy, radius, fanLeft = false,
            itemWidth = itemW, itemHeight = itemH, iconHalf = iconHalf,
            screenWidth = screenW, screenHeight = screenH
        )
        assertTrue(iconCentre(left, true).first < cx)
        assertTrue(iconCentre(right, false).first > cx)
    }

    @Test
    fun `rows are always clamped fully on screen`() {
        // Button jammed into each corner in turn.
        val corners = listOf(0 to 0, screenW - holder to 0, 0 to screenH - holder,
            screenW - holder to screenH - holder)
        for ((fx, fy) in corners) {
            val cx = fx + holder / 2
            val cy = fy + holder / 2
            val fanLeft = ArcLayout.fanLeft(cx, screenW, itemW, radius)
            repeat(6) { i ->
                val p = ArcLayout.place(
                    i, 6, cx, cy, radius, fanLeft,
                    itemWidth = itemW, itemHeight = itemH, iconHalf = iconHalf,
                    screenWidth = screenW, screenHeight = screenH
                )
                assertTrue("left off-screen at corner ($fx,$fy)", p.left >= 0)
                assertTrue("top off-screen at corner ($fx,$fy)", p.top >= 0)
                assertTrue("right edge off-screen", p.left + itemW <= screenW)
                assertTrue("bottom edge off-screen", p.top + itemH <= screenH)
            }
        }
    }

    @Test
    fun `fan direction follows whichever side a full row fits`() {
        // Docked right: only the left has room.
        assertTrue(ArcLayout.fanLeft(screenW - holder / 2, screenW, itemW, radius))
        // Docked left: only the right has room.
        assertTrue(!ArcLayout.fanLeft(holder / 2, screenW, itemW, radius))
        // Centred on a narrow screen neither side fits, so it takes the roomier one.
        assertTrue(ArcLayout.fanLeft(600, screenW, itemW, radius))
        assertTrue(!ArcLayout.fanLeft(480, screenW, itemW, radius))
    }

    @Test
    fun `pivot sits on the icon so rows scale out of the button`() {
        val right = ArcLayout.place(
            0, 6, 540, 1200, radius, fanLeft = false,
            itemWidth = itemW, itemHeight = itemH, iconHalf = iconHalf,
            screenWidth = screenW, screenHeight = screenH
        )
        assertEquals(iconHalf.toFloat(), right.pivotX, 0.01f)

        val left = ArcLayout.place(
            0, 6, 540, 1200, radius, fanLeft = true,
            itemWidth = itemW, itemHeight = itemH, iconHalf = iconHalf,
            screenWidth = screenW, screenHeight = screenH
        )
        assertEquals((itemW - iconHalf).toFloat(), left.pivotX, 0.01f)
    }

    @Test
    fun `a single item is centred on the arc`() {
        val p = ArcLayout.place(
            0, 1, 540, 1200, radius, fanLeft = false,
            itemWidth = itemW, itemHeight = itemH, iconHalf = iconHalf,
            screenWidth = screenW, screenHeight = screenH
        )
        val (_, iy) = iconCentre(p, false)
        assertTrue("single item should sit level with the button", kotlin.math.abs(iy - 1200) < 3)
    }
}
