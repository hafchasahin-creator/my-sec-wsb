package com.imran.runner.ui.components

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.imran.runner.tracking.GpsQuality
import com.imran.runner.ui.theme.ImranColors
import com.imran.runner.ui.theme.ImranType

/**
 * Signal-strength bars for the GPS fix.
 *
 * The pulse is deliberately slow and shallow. It exists to say "this is live", and a runner
 * checking their pace should never have their eye pulled to the corner of the screen.
 */
@Composable
fun GpsIndicator(quality: GpsQuality, modifier: Modifier = Modifier) {
    val transition = rememberInfiniteTransition(label = "gps")
    val pulse by transition.animateFloat(
        initialValue = 0.55f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(1_300, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "pulse",
    )

    val searching = quality == GpsQuality.NONE
    val lit = when (quality) {
        GpsQuality.NONE -> ImranColors.Amber
        GpsQuality.WEAK -> ImranColors.Amber
        else -> ImranColors.Accent
    }

    Row(
        modifier = modifier,
        verticalAlignment = Alignment.Bottom,
        horizontalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        val heights = listOf(7.dp, 11.dp, 15.dp)
        heights.forEachIndexed { index, barHeight ->
            val on = index < quality.bars
            // Only the leading bar breathes when locked on; while searching the whole indicator
            // does, which reads as hunting rather than as connected.
            val breathing = searching || (on && index == quality.bars - 1)
            Box(
                Modifier
                    .width(4.dp)
                    .height(barHeight)
                    .alpha(if (breathing) pulse else 1f)
                    .clip(RoundedCornerShape(2.dp))
                    .background(if (on || searching) lit.copy(alpha = if (on) 1f else 0.30f) else ImranColors.TextFaint),
            )
        }
    }
}

/**
 * The header: fix quality on the left, what the app is doing in the middle, settings on the right.
 */
@Composable
fun RunTopBar(
    quality: GpsQuality,
    title: String,
    titleTint: Color,
    onSettings: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.align(Alignment.CenterStart),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("GPS", style = ImranType.Title)
            Spacer(Modifier.width(8.dp))
            GpsIndicator(quality)
        }

        Row(
            modifier = Modifier.align(Alignment.Center),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(title, style = ImranType.Title)
            Spacer(Modifier.width(9.dp))
            ImranIcon(RunnerIcon.Runner, titleTint, size = 21.dp)
        }

        Box(
            modifier = Modifier
                .align(Alignment.CenterEnd)
                .size(40.dp)
                .clip(RoundedCornerShape(50))
                .clickable(onClick = onSettings),
            contentAlignment = Alignment.Center,
        ) {
            ImranIcon(RunnerIcon.Settings, ImranColors.TextMuted, size = 24.dp)
        }
    }
}
