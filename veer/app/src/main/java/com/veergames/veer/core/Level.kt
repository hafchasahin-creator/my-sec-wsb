package com.veergames.veer.core

enum class Difficulty(val label: String) {
    EASY("Easy"), NORMAL("Normal"), HARD("Hard"), EXPERT("Expert")
}

class LevelSpec(
    val num: Int,
    val title: String,
    private val declaredDifficulty: Difficulty,
    /** lattice points per side: x in 0..cols-1, y in 0..rows-1 */
    val cols: Int,
    val rows: Int,
    arrowPoints: List<IntArray>,
) {
    val arrows: List<ArrowPath> = arrowPoints.mapIndexed { i, flat ->
        require(flat.size >= 4 && flat.size % 2 == 0) { "level $num arrow $i: bad point list" }
        ArrowPath(i, List(flat.size / 2) { flat[it * 2] to flat[it * 2 + 1] })
    }

    /** Difficulty derived from the board itself, so the label can never
     *  disagree with what the player is looking at. */
    val difficulty: Difficulty = when {
        arrows.size <= 8 -> Difficulty.EASY
        arrows.size <= 15 -> Difficulty.NORMAL
        arrows.size <= 24 -> Difficulty.HARD
        else -> Difficulty.EXPERT
    }.let { derived -> if (derived.ordinal >= declaredDifficulty.ordinal) derived else declaredDifficulty }

    /** Hearts scale with the size of the board. */
    val hearts: Int get() = 3 + arrows.size / 10

    /**
     * Full structural validation; throws on any defect. Returns the greedy
     * rounds, which also proves solvability: removing a free arrow never
     * blocks anything (removals only remove obstacles), so greedy success
     * means solvable, and every free arrow is always a safe move.
     */
    fun validate(): List<List<Int>> {
        val owner = HashMap<Int, Int>()
        for (a in arrows) {
            for (k in a.covered) {
                val x = (k shr 9) - 64
                val y = (k and 0x1FF) - 64
                check(x in 0 until cols && y in 0 until rows) {
                    "level $num arrow ${a.id}: point ($x,$y) outside ${cols}x$rows"
                }
                val prev = owner.put(k, a.id)
                check(prev == null) { "level $num: arrows $prev and ${a.id} share ($x,$y)" }
            }
        }
        for (a in arrows) {
            check(!BoardLogic.selfBlocks(a, cols, rows)) {
                "level $num arrow ${a.id}: its own body blocks its exit"
            }
            check(a.bodyLen >= 2) { "level $num arrow ${a.id}: stub of length ${a.bodyLen}" }
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
