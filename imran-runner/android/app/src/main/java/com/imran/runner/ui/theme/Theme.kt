package com.imran.runner.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/**
 * Palette sampled directly from the Imran Runner reference design rather than eyeballed, so the
 * greens and the near-black are the exact values from the artwork.
 */
object ImranColors {
    val Background = Color(0xFF01060F)
    val Surface = Color(0xFF0D141D)
    val SurfaceRaised = Color(0xFF141C26)
    val Track = Color(0xFF1D222D)
    val Divider = Color(0xFF1E2732)

    val Accent = Color(0xFF5BDD18)
    val AccentSoft = Color(0xFF4FC414)
    val AccentDeep = Color(0xFF66BE2E)

    /** Far limbs of the runner: dark enough to read as depth, light enough to still be seen. */
    val AccentMid = Color(0xFF39960F)

    val Blue = Color(0xFF0FA0FC)
    val Orange = Color(0xFFFA6E14)
    val Amber = Color(0xFFFFB020)
    val Red = Color(0xFFFF4D4D)

    val TextPrimary = Color(0xFFFFFFFF)
    val TextMuted = Color(0xFFA5AEBD)
    val TextDim = Color(0xFF7E8798)
    val TextFaint = Color(0xFF4C5768)
}

/**
 * Type is defined as a small set of named roles instead of a Material scale: this screen has
 * exactly one enormous number, a handful of captions and nothing in between.
 */
object ImranType {
    private val family = FontFamily.Default

    /** The speed readout. Tracked in tight, the way the reference sets it. */
    val Hero = TextStyle(
        fontFamily = family,
        fontWeight = FontWeight.Black,
        fontSize = 104.sp,
        letterSpacing = (-4.5).sp,
        color = ImranColors.TextPrimary,
    )

    val StatValue = TextStyle(
        fontFamily = family,
        fontWeight = FontWeight.Black,
        fontSize = 30.sp,
        letterSpacing = (-1).sp,
        color = ImranColors.TextPrimary,
    )

    val PanelValue = TextStyle(
        fontFamily = family,
        fontWeight = FontWeight.Black,
        fontSize = 26.sp,
        letterSpacing = (-0.8).sp,
        color = ImranColors.TextPrimary,
    )

    /** Small tracked-out capitals: DISTANCE, AVG SPEED, CURRENT SPEED. */
    val Label = TextStyle(
        fontFamily = family,
        fontWeight = FontWeight.SemiBold,
        fontSize = 12.sp,
        letterSpacing = 1.8.sp,
        color = ImranColors.TextMuted,
    )

    /** The coloured unit under each value: KM, KCAL, TIME. */
    val Unit = TextStyle(
        fontFamily = family,
        fontWeight = FontWeight.Bold,
        fontSize = 12.sp,
        letterSpacing = 1.4.sp,
    )

    val HeroUnit = TextStyle(
        fontFamily = family,
        fontWeight = FontWeight.Bold,
        fontSize = 24.sp,
        letterSpacing = 5.sp,
        color = ImranColors.Accent,
    )

    val Title = TextStyle(
        fontFamily = family,
        fontWeight = FontWeight.Bold,
        fontSize = 15.sp,
        letterSpacing = 2.4.sp,
        color = ImranColors.TextPrimary,
    )

    val ControlLabel = TextStyle(
        fontFamily = family,
        fontWeight = FontWeight.Bold,
        fontSize = 11.sp,
        letterSpacing = 1.2.sp,
        color = ImranColors.TextPrimary,
    )

    val NavLabel = TextStyle(
        fontFamily = family,
        fontWeight = FontWeight.SemiBold,
        fontSize = 11.sp,
        letterSpacing = 0.3.sp,
    )

    val Body = TextStyle(
        fontFamily = family,
        fontWeight = FontWeight.Normal,
        fontSize = 14.sp,
        color = ImranColors.TextMuted,
    )

    val BodyStrong = TextStyle(
        fontFamily = family,
        fontWeight = FontWeight.Bold,
        fontSize = 15.sp,
        color = ImranColors.TextPrimary,
    )
}

@Composable
fun ImranRunnerTheme(content: @Composable () -> Unit) {
    // The design is a single dark one by intent; the system setting is read only so that the
    // scheme is honest about being dark rather than claiming to follow along.
    @Suppress("UNUSED_EXPRESSION")
    isSystemInDarkTheme()

    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = ImranColors.Accent,
            onPrimary = ImranColors.Background,
            background = ImranColors.Background,
            onBackground = ImranColors.TextPrimary,
            surface = ImranColors.Surface,
            onSurface = ImranColors.TextPrimary,
            error = ImranColors.Red,
        ),
        content = content,
    )
}
