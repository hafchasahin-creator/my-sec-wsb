package com.veergames.veer.core

/** Ray-based collision + hint/solver helpers. Pure Kotlin. */
object BoardLogic {

    private const val RAY_REACH = 64

    /**
     * Distance in cells from [mover]'s head to the nearest point of
     * [obstacle] lying on the head ray, or null if the ray is clear.
     */
    fun blockDistance(mover: ArrowPath, obstacle: ArrowPath): Int? {
        val d = mover.headDir
        val (hx, hy) = mover.head
        for (t in 1 until RAY_REACH) {
            if (ArrowPath.key(hx + d.dx * t, hy + d.dy * t) in obstacle.coveredSet) return t
        }
        return null
    }

    fun isFree(mover: ArrowPath, remaining: List<ArrowPath>): Boolean =
        remaining.none { it !== mover && blockDistance(mover, it) != null }

    /** Nearest blocker and its distance, or null if free. */
    fun firstBlocker(mover: ArrowPath, remaining: List<ArrowPath>): Pair<ArrowPath, Int>? {
        var best: Pair<ArrowPath, Int>? = null
        for (o in remaining) {
            if (o === mover) continue
            val t = blockDistance(mover, o) ?: continue
            if (best == null || t < best.second) best = o to t
        }
        return best
    }

    fun freeSet(remaining: List<ArrowPath>): List<ArrowPath> =
        remaining.filter { isFree(it, remaining) }

    /**
     * Pick a hint from the current state: a genuinely safe arrow right now.
     * Prefers longer arrows (their freedom is harder to eyeball), breaking
     * ties by a rotating salt so repeated hints vary.
     */
    fun pickHint(remaining: List<ArrowPath>, salt: Int): ArrowPath? {
        val free = freeSet(remaining)
        if (free.isEmpty()) return null
        val sorted = free.sortedByDescending { it.bodyLen }
        return sorted[salt.mod(sorted.size)]
    }
}
