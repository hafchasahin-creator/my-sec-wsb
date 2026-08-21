package com.imran.recorder.overlay

import kotlin.math.cos
import kotlin.math.sin

/**
 * Geometry for the floating button's arc menu, kept free of Android types so it can be
 * reasoned about and unit-tested on its own.
 */
object ArcLayout {

    /** Top-left placement for one row, plus the pivot its animation should scale about. */
    data class Placement(
        val left: Int,
        val top: Int,
        val pivotX: Float,
        val pivotY: Float
    )

    const val START_DEG = -68.0
    const val END_DEG = 68.0

    /**
     * Places item [index] of [count] on an arc of [radius] around the button centre
     * ([cx], [cy]), fanning toward whichever side has room. The row is positioned so its
     * icon centre — not its bounding box — lands on the arc, then clamped on screen.
     */
    fun place(
        index: Int,
        count: Int,
        cx: Int,
        cy: Int,
        radius: Float,
        fanLeft: Boolean,
        itemWidth: Int,
        itemHeight: Int,
        iconHalf: Int,
        screenWidth: Int,
        screenHeight: Int
    ): Placement {
        val t = if (count <= 1) 0.5 else index.toDouble() / (count - 1)
        val angle = Math.toRadians(START_DEG + (END_DEG - START_DEG) * t)
        val dirX = if (fanLeft) -1 else 1

        val iconCx = cx + dirX * radius * cos(angle)
        val iconCy = cy + radius * sin(angle)

        val rawLeft = if (fanLeft) iconCx - (itemWidth - iconHalf) else iconCx - iconHalf
        val rawTop = iconCy - itemHeight / 2.0

        val left = rawLeft.toInt().coerceIn(0, (screenWidth - itemWidth).coerceAtLeast(0))
        val top = rawTop.toInt().coerceIn(0, (screenHeight - itemHeight).coerceAtLeast(0))

        val pivotX = if (fanLeft) (itemWidth - iconHalf).toFloat() else iconHalf.toFloat()
        return Placement(left, top, pivotX, itemHeight / 2f)
    }

    /**
     * Picks the fan side by whether a full row actually fits, not merely by which half of
     * the screen the button is on. The widest reach is at angle 0, where a row needs the
     * whole radius plus its own width; without this check a centred button gets its rows
     * clamped against the edge and the arc collapses.
     */
    fun fanLeft(fabCentreX: Int, screenWidth: Int, itemWidth: Int, radius: Float): Boolean {
        val need = radius.toInt() + itemWidth
        val roomLeft = fabCentreX
        val roomRight = screenWidth - fabCentreX
        return when {
            roomLeft >= need && roomRight < need -> true
            roomRight >= need && roomLeft < need -> false
            else -> roomLeft > roomRight
        }
    }
}
