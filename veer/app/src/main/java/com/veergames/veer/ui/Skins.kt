package com.veergames.veer.ui

/**
 * Arrow skins. A skin re-themes the whole screen (board, chrome and effects)
 * and can attach a per-frame effect layer - Flame is the showcase.
 *
 * Equipping writes the skin's colours into [Palette], which every view reads
 * at draw time, so a switch is instant and global.
 */
class Skin(
    val id: String,
    val displayName: String,
    val tagline: String,
    // board
    val bgTop: Int,
    val bgBottom: Int,
    val dot: Int,
    val boardTint: Int,          // faint wash behind the board, 0 = none
    // arrows
    val inkTail: Int,
    val inkHead: Int,
    val glowColor: Int,          // 0 = no resting glow
    val glowWidth: Float,        // fraction of a cell
    val shadow: Boolean,
    // chrome
    val text: Int,
    val textDim: Int,
    val card: Int,
    val cardEdge: Int,
    val accent: Int,
    val accent2: Int,
    val accent3: Int,
    val heartEmpty: Int,
    // chrome that must follow a dark skin instead of staying light
    val scrim: Int,
    val chip: Int,
    val toggleOff: Int,
    val knob: Int,
    val onOverlay: Int,
    // effects
    val exitParticle: Int,
    val trailColor: Int,
    val effect: Effect = Effect.NONE,
    /** total stars needed to unlock; 0 = free from the start */
    val unlockStars: Int = 0,
) {
    enum class Effect { NONE, SPARKLE, FROST, FLAME }

    val isDark: Boolean get() = (bgTop ushr 16 and 0xFF) < 128
}

object Skins {

    val CLASSIC = Skin(
        id = "classic", displayName = "Classic", tagline = "Clean navy ink",
        bgTop = 0xFFFFFFFF.toInt(), bgBottom = 0xFFFCFDFF.toInt(),
        dot = 0xFFC7D1E8.toInt(), boardTint = 0,
        inkTail = 0xFF25325F.toInt(), inkHead = 0xFF16204A.toInt(),
        glowColor = 0, glowWidth = 0f, shadow = true,
        text = 0xFF1B2547.toInt(), textDim = 0xFF7C89AC.toInt(),
        card = 0xFFFFFFFF.toInt(), cardEdge = 0xFFE2E8F6.toInt(),
        accent = 0xFF2E7BF6.toInt(), accent2 = 0xFF16C79A.toInt(), accent3 = 0xFF6C5CE7.toInt(),
        heartEmpty = 0xFFD8DFEF.toInt(),
        scrim = 0x0B1230, chip = 0xFFF0F3FA.toInt(), toggleOff = 0xFFDCE3F2.toInt(),
        knob = 0xFFFFFFFF.toInt(), onOverlay = 0xFFFFFFFF.toInt(),
        exitParticle = 0xFF2E7BF6.toInt(), trailColor = 0xFF2E7BF6.toInt(),
    )

    val NEON = Skin(
        id = "neon", displayName = "Neon", tagline = "Glowing circuitry",
        bgTop = 0xFF0A0E20.toInt(), bgBottom = 0xFF121634.toInt(),
        dot = 0xFF2B3566.toInt(), boardTint = 0x14203E7A,
        inkTail = 0xFF00F5D4.toInt(), inkHead = 0xFF00B4FF.toInt(),
        glowColor = 0xFF00DCFF.toInt(), glowWidth = 0.10f, shadow = false,
        text = 0xFFEAF3FF.toInt(), textDim = 0xFF8DA0C8.toInt(),
        card = 0xFF161C3C.toInt(), cardEdge = 0xFF2A3568.toInt(),
        accent = 0xFF00E5FF.toInt(), accent2 = 0xFF00F5D4.toInt(), accent3 = 0xFFB388FF.toInt(),
        heartEmpty = 0xFF2C3562.toInt(),
        scrim = 0x05070F, chip = 0xFF1B2246.toInt(), toggleOff = 0xFF2A3568.toInt(),
        knob = 0xFFEAF3FF.toInt(), onOverlay = 0xFFEAF3FF.toInt(),
        exitParticle = 0xFF00E5FF.toInt(), trailColor = 0xFF00E5FF.toInt(),
        effect = Skin.Effect.SPARKLE, unlockStars = 0,
    )

    val ICE = Skin(
        id = "ice", displayName = "Ice", tagline = "Frozen paths",
        bgTop = 0xFFF3FAFF.toInt(), bgBottom = 0xFFDBEDFB.toInt(),
        dot = 0xFFA9C7DF.toInt(), boardTint = 0x14A8D8F5,
        inkTail = 0xFF6CBEEB.toInt(), inkHead = 0xFF2C7AC4.toInt(),
        glowColor = 0xFF96DCFF.toInt(), glowWidth = 0.07f, shadow = true,
        text = 0xFF12395C.toInt(), textDim = 0xFF6E93B2.toInt(),
        card = 0xFFFFFFFF.toInt(), cardEdge = 0xFFCFE6F7.toInt(),
        accent = 0xFF2C9BE0.toInt(), accent2 = 0xFF56C8E8.toInt(), accent3 = 0xFF6D8FE8.toInt(),
        heartEmpty = 0xFFD2E4F2.toInt(),
        scrim = 0x08243B, chip = 0xFFEAF5FD.toInt(), toggleOff = 0xFFCBE2F2.toInt(),
        knob = 0xFFFFFFFF.toInt(), onOverlay = 0xFFFFFFFF.toInt(),
        exitParticle = 0xFFBFE9FF.toInt(), trailColor = 0xFF8FD6FF.toInt(),
        effect = Skin.Effect.FROST, unlockStars = 0,
    )

    val FLAME = Skin(
        id = "flame", displayName = "Flame", tagline = "Ignite the path",
        bgTop = 0xFF1A100E.toInt(), bgBottom = 0xFF2C1610.toInt(),
        dot = 0xFF5C3C2E.toInt(), boardTint = 0x18FF7A2A,
        inkTail = 0xFFFFC448.toInt(), inkHead = 0xFFFF5C24.toInt(),
        glowColor = 0xFFFF8C28.toInt(), glowWidth = 0.09f, shadow = false,
        text = 0xFFFFF1E4.toInt(), textDim = 0xFFC69B84.toInt(),
        card = 0xFF2A1712.toInt(), cardEdge = 0xFF4A2A1E.toInt(),
        accent = 0xFFFF8C28.toInt(), accent2 = 0xFFFFC448.toInt(), accent3 = 0xFFFF5C24.toInt(),
        heartEmpty = 0xFF4A2A1E.toInt(),
        scrim = 0x0C0603, chip = 0xFF321912.toInt(), toggleOff = 0xFF4A2A1E.toInt(),
        knob = 0xFFFFE0C4.toInt(), onOverlay = 0xFFFFF1E4.toInt(),
        exitParticle = 0xFFFF9A32.toInt(), trailColor = 0xFFFF7A20.toInt(),
        effect = Skin.Effect.FLAME, unlockStars = 0,
    )

    val all: List<Skin> = listOf(CLASSIC, NEON, ICE, FLAME)

    fun byId(id: String?): Skin = all.firstOrNull { it.id == id } ?: CLASSIC

    var equipped: Skin = CLASSIC
        private set

    /** Bumped on every equip so cached shaders/bitmaps know to rebuild. */
    var version: Int = 0
        private set

    /** Equip [skin] and push its colours into [Palette]. */
    fun equip(skin: Skin) {
        equipped = skin
        version++
        Palette.BG_TOP = skin.bgTop
        Palette.BG_BOTTOM = skin.bgBottom
        Palette.DOT = skin.dot
        Palette.TEXT = skin.text
        Palette.TEXT_DIM = skin.textDim
        Palette.CARD = skin.card
        Palette.CARD_EDGE = skin.cardEdge
        Palette.ACCENT = skin.accent
        Palette.ACCENT2 = skin.accent2
        Palette.ACCENT3 = skin.accent3
        Palette.HEART_EMPTY = skin.heartEmpty
        Palette.INK = skin.inkHead
        Palette.INK_LIGHT = skin.inkTail
    }

    /** Demo build ships every skin unlocked; the thresholds above are what
     *  the full release will gate on. */
    fun unlocked(skin: Skin, totalStars: Int): Boolean = totalStars >= skin.unlockStars
}
