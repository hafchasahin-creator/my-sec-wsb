package com.veergames.veer.core

/**
 * Rules/state for one level attempt. Pure Kotlin; the view layer owns
 * animation and calls [tap] with arrow ids, advancing [tick] each frame.
 */
class GameController(val spec: LevelSpec, private val maxHearts: Int = 3) {

    enum class State { PLAYING, COMPLETE, FAILED }

    sealed class TapResult {
        /** Arrow escapes; already removed from the remaining set. */
        data class Escaped(val arrow: ArrowPath, val remainingCount: Int, val last: Boolean) : TapResult()
        /** Blocked: [gap] = cells until impact with [blocker]. */
        data class Blocked(val arrow: ArrowPath, val blocker: ArrowPath, val gap: Int, val heartsLeft: Int, val failed: Boolean) : TapResult()
        object Ignored : TapResult()
    }

    var state = State.PLAYING; private set
    var hearts = maxHearts; private set
    var mistakes = 0; private set
    var elapsedMs = 0L; private set
    var escapedCount = 0; private set

    private val remainingList = ArrayList(spec.arrows)
    private val blockedCooldownUntil = HashMap<Int, Long>()
    private var hintSalt = 0

    val remaining: List<ArrowPath> get() = remainingList
    val remainingCount: Int get() = remainingList.size

    fun tick(dtMs: Long) {
        if (state == State.PLAYING) elapsedMs += dtMs
    }

    fun tap(arrowId: Int): TapResult {
        if (state != State.PLAYING) return TapResult.Ignored
        val arrow = remainingList.firstOrNull { it.id == arrowId } ?: return TapResult.Ignored
        val now = elapsedMs
        if (now < (blockedCooldownUntil[arrowId] ?: 0L)) return TapResult.Ignored

        val blocker = BoardLogic.firstBlocker(arrow, remainingList)
        return if (blocker == null) {
            remainingList.remove(arrow)
            escapedCount++
            val last = remainingList.isEmpty()
            if (last) state = State.COMPLETE
            TapResult.Escaped(arrow, remainingList.size, last)
        } else {
            mistakes++
            hearts--
            blockedCooldownUntil[arrowId] = now + 450
            val failed = hearts <= 0
            if (failed) state = State.FAILED
            TapResult.Blocked(arrow, blocker.first, blocker.second, hearts, failed)
        }
    }

    /** Safe arrow to glow for the hint button, or null if none remain. */
    fun hint(): ArrowPath? = BoardLogic.pickHint(remainingList, hintSalt++)

    fun stars(): Int = when {
        mistakes == 0 -> 3
        mistakes == 1 -> 2
        else -> 1
    }
}
