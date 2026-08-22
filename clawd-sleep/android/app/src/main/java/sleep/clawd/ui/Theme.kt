package sleep.clawd.ui

import androidx.compose.ui.graphics.Color

/**
 * Night palette.
 *
 * Text sits just above the 4.5:1 contrast floor rather than well above it.
 * Conventional dark-mode body text (#E6E6E6) runs at ~12:1 against this
 * background and emits five times the light for no legibility gain — and every
 * excess candela is glare the user pays for at 3am.
 */
object Ink {
    val Void = Color(0xFF06070A)
    val Horizon = Color(0xFF0E1524)
    val Surface = Color(0xFF0B0E16)
    val Hairline = Color(0xFF1B2231)

    val Text1 = Color(0xFF7C8598)
    val Text2 = Color(0xFF626B7C)
    val Text3 = Color(0xFF454C5A)

    // Clawd's coral with the hue held exactly and the saturation cut 48%:
    // the same family, but a coral object rather than a coral light source.
    val Accent = Color(0xFFBF665A)

    val ClawdCoral = Color(0xFFF1604C)   // supplied artwork — never altered
    val ClawdAsleep = Color(0xFF8E4438)
    val ClawdEye = Color(0xFF111111)

    val Star = Color(0xFFC6CFDE)

    // On OLED a #000000 pixel is an off pixel: no emission, no power, no burn-in.
    val TrueBlack = Color(0xFF000000)
    val VoidAmoled = Color(0xFF000000)
    val SurfaceAmoled = Color(0xFF000000)
}
