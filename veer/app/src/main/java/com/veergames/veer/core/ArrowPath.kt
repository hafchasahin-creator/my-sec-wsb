package com.veergames.veer.core

/**
 * Core puzzle model. Pure Kotlin (no Android imports) so it runs in JVM tests.
 *
 * Coordinates are integer lattice points: x grows right, y grows DOWN.
 * An arrow is a polyline of axis-aligned segments from tail to head; the
 * head direction is the direction of the last segment.
 *
 * Escape semantics: tapping a free arrow makes the whole path stream out
 * along its own track, exiting through the straight ray in front of the
 * head. An arrow is free iff that ray crosses no remaining path.
 */
enum class Dir(val dx: Int, val dy: Int) {
    RIGHT(1, 0), LEFT(-1, 0), DOWN(0, 1), UP(0, -1);

    companion object {
        fun of(dx: Int, dy: Int): Dir = entries.first {
            it.dx == Integer.signum(dx) && it.dy == Integer.signum(dy)
        }
    }
}

class ArrowPath(val id: Int, val pts: List<Pair<Int, Int>>) {

    val headDir: Dir
    /** Every lattice point the path covers, encoded by [key], tail first. */
    val covered: IntArray
    val coveredSet: HashSet<Int>
    /** key -> index along the body (0 = tail). Used by the streaming rule. */
    val coveredIndex: HashMap<Int, Int>
    /** Number of unit cells the path spans (covered points - 1). */
    val bodyLen: Int get() = covered.size - 1

    init {
        require(pts.size >= 2) { "arrow $id needs at least 2 points" }
        var prev: Dir? = null
        for (i in 0 until pts.size - 1) {
            val (ax, ay) = pts[i]
            val (bx, by) = pts[i + 1]
            require((ax == bx) != (ay == by)) { "arrow $id: segment $i not axis-aligned" }
            val d = Dir.of(bx - ax, by - ay)
            if (prev != null) {
                require(d != prev) { "arrow $id: merge colinear segments at $i" }
                require(d.dx != -prev.dx || d.dy != -prev.dy) { "arrow $id: 180-degree turn at $i" }
            }
            prev = d
        }
        headDir = prev!!
        val cov = ArrayList<Int>()
        for (i in 0 until pts.size - 1) {
            val (ax, ay) = pts[i]
            val (bx, by) = pts[i + 1]
            val d = Dir.of(bx - ax, by - ay)
            var x = ax
            var y = ay
            while (x != bx || y != by) {
                cov.add(key(x, y))
                x += d.dx
                y += d.dy
            }
        }
        cov.add(key(pts.last().first, pts.last().second))
        covered = cov.toIntArray()
        coveredSet = HashSet(cov)
        require(coveredSet.size == covered.size) { "arrow $id overlaps itself" }
        coveredIndex = HashMap(cov.size * 2)
        for (i in cov.indices) coveredIndex[cov[i]] = i
    }

    val head: Pair<Int, Int> get() = pts.last()
    val tail: Pair<Int, Int> get() = pts.first()

    companion object {
        /** Packs a lattice point into an int. Offset keeps negative
         *  coordinates (an exit ray leaving the board) from aliasing. */
        fun key(x: Int, y: Int): Int = ((x + 64) shl 9) or (y + 64)
    }
}
