package com.veergames.veer.core

enum class Difficulty(val label: String) { EASY("Easy"), NORMAL("Normal"), HARD("Hard") }

class LevelSpec(
    val num: Int,
    val title: String,
    val difficulty: Difficulty,
    /** lattice points per side: x in 0..cols-1, y in 0..rows-1 */
    val cols: Int,
    val rows: Int,
    arrowPoints: List<IntArray>,
) {
    val arrows: List<ArrowPath> = arrowPoints.mapIndexed { i, flat ->
        require(flat.size >= 4 && flat.size % 2 == 0) { "level $num arrow $i: bad point list" }
        ArrowPath(i, List(flat.size / 2) { flat[it * 2] to flat[it * 2 + 1] })
    }

    /**
     * Full structural validation. Throws IllegalStateException on any defect.
     * Returns the greedy rounds (each round = ids removable simultaneously),
     * which also proves solvability: by monotonicity, removing a free arrow
     * never breaks solvability, so greedy success == solvable, and every
     * free arrow is always a safe move.
     */
    fun validate(): List<List<Int>> {
        val owner = HashMap<Int, Int>()
        for (a in arrows) {
            for (k in a.covered) {
                val x = k shr 8
                val y = k and 0xff
                check(x in 0 until cols && y in 0 until rows) {
                    "level $num arrow ${a.id}: point ($x,$y) outside ${cols}x$rows"
                }
                val prev = owner.put(k, a.id)
                check(prev == null) { "level $num: arrows $prev and ${a.id} share ($x,$y)" }
            }
        }
        for (a in arrows) { // head must not point into own body
            var x = a.head.first + a.headDir.dx
            var y = a.head.second + a.headDir.dy
            while (x in 0 until cols && y in 0 until rows) {
                check(ArrowPath.key(x, y) !in a.coveredSet) {
                    "level $num arrow ${a.id}: head points into own body"
                }
                x += a.headDir.dx; y += a.headDir.dy
            }
        }
        val rounds = ArrayList<List<Int>>()
        var remaining = arrows
        while (remaining.isNotEmpty()) {
            val free = remaining.filter { a -> BoardLogic.isFree(a, remaining) }
            check(free.isNotEmpty()) {
                "level $num UNSOLVABLE: stuck with ${remaining.map { it.id }}"
            }
            rounds.add(free.map { it.id })
            remaining = remaining.filter { it !in free }
        }
        return rounds
    }
}
