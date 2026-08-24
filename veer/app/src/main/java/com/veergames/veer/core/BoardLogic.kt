package com.veergames.veer.core

/**
 * Collision, freedom and hint queries. Pure Kotlin.
 *
 * Escape semantics ("streaming"): a tapped arrow slides along its own path
 * and leaves through the straight ray in front of its head. It is free iff
 * that ray is clear of every other remaining arrow - and of the part of its
 * own body that has not vacated yet: by the time the head reaches ray step
 * j the body has advanced j cells, so its own cell at body index k is clear
 * exactly when k < j. That rule is what makes hook and spiral shapes legal.
 */
object BoardLogic {

    /** Distance from [mover]'s head to the nearest [obstacle] cell on the
     *  exit ray, or null if the ray is clear of it. [bound] limits the march
     *  to the board; callers with no board hand in a generous default. */
    fun blockDistance(mover: ArrowPath, obstacle: ArrowPath, bound: Int = 64): Int? {
        val d = mover.headDir
        val (hx, hy) = mover.head
        for (t in 1..bound) {
            if (ArrowPath.key(hx + d.dx * t, hy + d.dy * t) in obstacle.coveredSet) return t
        }
        return null
    }

    /** True if the arrow's own trailing body still blocks its exit ray. */
    fun selfBlocks(mover: ArrowPath, cols: Int = 0, rows: Int = 0): Boolean {
        val d = mover.headDir
        val (hx, hy) = mover.head
        var t = 1
        while (true) {
            val x = hx + d.dx * t
            val y = hy + d.dy * t
            if (cols > 0 && (x < 0 || y < 0 || x >= cols || y >= rows)) return false
            if (cols == 0 && t > 64) return false
            val k = mover.coveredIndex[ArrowPath.key(x, y)]
            if (k != null && k >= t) return true
            t++
        }
    }

    fun isFree(mover: ArrowPath, remaining: List<ArrowPath>): Boolean {
        if (selfBlocks(mover)) return false
        return remaining.none { it !== mover && blockDistance(mover, it) != null }
    }

    /** Nearest blocker and its distance, or null if the arrow is free. */
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
     * A genuinely safe arrow for the hint button, chosen from live state.
     * Prefers arrows that unblock the most others (the move that actually
     * opens the board), then longer ones, with a rotating tiebreak so
     * repeated hints do not point at the same arrow.
     */
    fun pickHint(remaining: List<ArrowPath>, salt: Int): ArrowPath? {
        val free = freeSet(remaining)
        if (free.isEmpty()) return null
        val scored = free.map { a ->
            val without = remaining.filter { it !== a }
            val opened = without.count { !isFree(it, remaining) && isFree(it, without) }
            Triple(a, opened, a.bodyLen)
        }.sortedWith(compareByDescending<Triple<ArrowPath, Int, Int>> { it.second }
            .thenByDescending { it.third })
        val top = scored.filter { it.second == scored[0].second }
        return top[salt.mod(top.size)].first
    }
}
