package com.veergames.veer.core

/**
 * Rules and state for one level attempt. Pure Kotlin; the view layer owns
 * animation and calls [tap] with arrow ids, advancing [tick] each frame.
 */
class GameController(
    val spec: LevelSpec,
    val maxHearts: Int = spec.hearts,
    private val hintBudget: Int = 3,
) {

    enum class State { PLAYING, COMPLETE, FAILED }

    sealed class TapResult {
        /** Arrow escapes; already removed from the remaining set. */
        data class Escaped(val arrow: ArrowPath, val remainingCount: Int,
                           val last: Boolean, val combo: Int) : TapResult()
        /** Blocked: [gap] cells until impact with [blocker]. */
        data class Blocked(val arrow: ArrowPath, val blocker: ArrowPath, val gap: Int,
                           val heartsLeft: Int, val failed: Boolean) : TapResult()
        object Ignored : TapResult()
    }

    var state = State.PLAYING; private set
    var hearts = maxHearts; private set
    var mistakes = 0; private set
    var escapedCount = 0; private set
    var combo = 0; private set
    var hintsLeft = hintBudget; private set

    /** Microseconds, so a 60/90/120 Hz frame does not truncate the clock. */
    private var elapsedUs = 0L
    val elapsedMs: Long get() = elapsedUs / 1000

    private val remainingList = ArrayList(spec.arrows)
    private val blockedCooldownUntil = HashMap<Int, Long>()
    private var lastEscapeUs = -1L
    private var hintSalt = 0

    val remaining: List<ArrowPath> get() = remainingList
    val remainingCount: Int get() = remainingList.size

    fun tick(dtUs: Long) {
        if (state == State.PLAYING) elapsedUs += dtUs
    }

    fun tap(arrowId: Int): TapResult {
        if (state != State.PLAYING) return TapResult.Ignored
        val arrow = remainingList.firstOrNull { it.id == arrowId } ?: return TapResult.Ignored
        val nowMs = elapsedMs
        if (nowMs < (blockedCooldownUntil[arrowId] ?: 0L)) return TapResult.Ignored

        val blocker = BoardLogic.firstBlocker(arrow, remainingList)
        return if (blocker == null && !BoardLogic.selfBlocks(arrow)) {
            remainingList.remove(arrow)
            escapedCount++
            // a chain only counts while the player keeps moving
            combo = if (lastEscapeUs >= 0 && elapsedUs - lastEscapeUs <= COMBO_WINDOW_US)
                combo + 1 else 1
            lastEscapeUs = elapsedUs
            val last = remainingList.isEmpty()
            if (last) state = State.COMPLETE
            TapResult.Escaped(arrow, remainingList.size, last, combo)
        } else {
            mistakes++
            hearts--
            combo = 0
            lastEscapeUs = -1L
            blockedCooldownUntil[arrowId] = nowMs + BLOCK_COOLDOWN_MS
            val failed = hearts <= 0
            if (failed) state = State.FAILED
            val b = blocker ?: (arrow to 1)
            TapResult.Blocked(arrow, b.first, b.second, hearts, failed)
        }
    }

    /** A safe arrow to glow, or null if none remain or the budget is spent. */
    fun hint(): ArrowPath? {
        if (state != State.PLAYING || hintsLeft <= 0) return null
        val a = BoardLogic.pickHint(remainingList, hintSalt++) ?: return null
        hintsLeft--
        return a
    }

    fun stars(): Int {
        val par = maxOf(1, spec.arrows.size / 10)
        return when {
            mistakes == 0 -> 3
            mistakes <= par -> 2
            else -> 1
        }
    }

    companion object {
        const val BLOCK_COOLDOWN_MS = 320L
        const val COMBO_WINDOW_US = 1_600_000L
    }
}
