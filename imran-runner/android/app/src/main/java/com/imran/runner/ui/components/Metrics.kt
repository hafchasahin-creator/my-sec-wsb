package com.imran.runner.ui.components

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.imran.runner.ui.theme.ImranColors
import com.imran.runner.ui.theme.ImranType

/**
 * A number that eases to its new value instead of jumping.
 *
 * Critically damped, so distance and calories glide upward and never overshoot — a counter that
 * bounced past its value and back would read as a glitch, not as polish.
 */
@Composable
fun AnimatedMetric(
    target: Float,
    format: (Float) -> String,
    style: TextStyle,
    modifier: Modifier = Modifier,
) {
    val value by animateFloatAsState(
        targetValue = target,
        animationSpec = spring(dampingRatio = 1f, stiffness = Spring.StiffnessMediumLow),
        label = "metric",
    )
    Text(
        text = format(value),
        style = style,
        modifier = modifier,
        maxLines = 1,
        softWrap = false,
        textAlign = TextAlign.Center,
    )
}

/** One column of the headline stat row. */
data class StatSpec(
    val icon: RunnerIcon,
    val iconTint: Color,
    val label: String,
    val unit: String,
    val unitTint: Color,
    val value: Float,
    val format: (Float) -> String,
    /** Elapsed time is a clock: it should tick, not glide. */
    val animated: Boolean = true,
)

@Composable
fun StatRow(specs: List<StatSpec>, compact: Boolean = false, modifier: Modifier = Modifier) {
    val valueStyle =
        if (compact) ImranType.StatValue.copy(fontSize = 25.sp) else ImranType.StatValue
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        specs.forEachIndexed { index, spec ->
            if (index > 0) {
                Box(
                    Modifier
                        .width(1.dp)
                        .height(if (compact) 48.dp else 58.dp)
                        .background(ImranColors.Divider),
                )
            }
            Column(
                modifier = Modifier.weight(1f),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                ImranIcon(spec.icon, spec.iconTint, size = if (compact) 20.dp else 25.dp)
                Spacer(Modifier.height(if (compact) 6.dp else 9.dp))
                Text(spec.label, style = ImranType.Label)
                Spacer(Modifier.height(if (compact) 3.dp else 5.dp))
                if (spec.animated) {
                    AnimatedMetric(spec.value, spec.format, valueStyle)
                } else {
                    Text(spec.format(spec.value), style = valueStyle, maxLines = 1, softWrap = false)
                }
                Spacer(Modifier.height(3.dp))
                Text(spec.unit, style = ImranType.Unit.copy(color = spec.unitTint))
            }
        }
    }
}

/** One cell of the rounded summary panel. */
data class PanelSpec(
    val label: String,
    val unit: String,
    val unitTint: Color,
    val value: Float,
    val format: (Float) -> String,
)

@Composable
fun MetricPanel(specs: List<PanelSpec>, compact: Boolean = false, modifier: Modifier = Modifier) {
    val valueStyle =
        if (compact) ImranType.PanelValue.copy(fontSize = 22.sp) else ImranType.PanelValue
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(22.dp))
            .background(ImranColors.Surface)
            .padding(vertical = if (compact) 11.dp else 15.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        specs.forEachIndexed { index, spec ->
            if (index > 0) {
                Box(
                    Modifier
                        .width(1.dp)
                        .height(if (compact) 44.dp else 52.dp)
                        .background(ImranColors.Divider),
                )
            }
            Column(
                modifier = Modifier.weight(1f),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(spec.label, style = ImranType.Label)
                Spacer(Modifier.height(if (compact) 4.dp else 6.dp))
                AnimatedMetric(spec.value, spec.format, valueStyle)
                Spacer(Modifier.height(3.dp))
                Text(spec.unit, style = ImranType.Unit.copy(color = spec.unitTint))
            }
        }
    }
}

/** The two-dot page indicator under the stat row. */
@Composable
fun PageDots(count: Int, selected: Int, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        repeat(count) { index ->
            val active = index == selected
            Box(
                Modifier
                    .size(if (active) 7.dp else 6.dp)
                    .clip(RoundedCornerShape(50))
                    .background(if (active) Color.White else ImranColors.TextFaint),
            )
        }
    }
}
