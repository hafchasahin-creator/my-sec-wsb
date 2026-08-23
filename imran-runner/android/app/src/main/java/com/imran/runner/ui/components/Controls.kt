package com.imran.runner.ui.components

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.imran.runner.tracking.RunState
import com.imran.runner.ui.theme.ImranColors
import com.imran.runner.ui.theme.ImranType

/** Shrinks a control very slightly while it is held, so a gloved tap still feels answered. */
@Composable
private fun pressScale(interaction: MutableInteractionSource): Float {
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (pressed) 0.93f else 1f,
        animationSpec = spring(dampingRatio = 0.62f, stiffness = Spring.StiffnessMedium),
        label = "press",
    )
    return scale
}

@Composable
private fun SecondaryControl(
    icon: RunnerIcon,
    label: String,
    tint: Color,
    diameter: Dp,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    val interaction = remember { MutableInteractionSource() }
    val scale = pressScale(interaction)
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            modifier = Modifier
                .scale(scale)
                .size(diameter)
                .clip(CircleShape)
                .background(ImranColors.SurfaceRaised)
                .border(BorderStroke(1.dp, ImranColors.Divider), CircleShape)
                .clickable(
                    interactionSource = interaction,
                    indication = null,
                    enabled = enabled,
                    onClick = onClick,
                ),
            contentAlignment = Alignment.Center,
        ) {
            ImranIcon(icon, if (enabled) tint else ImranColors.TextFaint, size = diameter * 0.36f)
        }
        Spacer(Modifier.height(10.dp))
        Text(
            label,
            style = ImranType.ControlLabel.copy(
                color = if (enabled) ImranColors.TextPrimary else ImranColors.TextFaint,
            ),
        )
    }
}

/**
 * START / PAUSE, with LOCK and FINISH either side, sized for a thumb at speed.
 */
@Composable
fun ControlRow(
    state: RunState,
    locked: Boolean,
    primaryDiameter: Dp = 92.dp,
    secondaryDiameter: Dp = 66.dp,
    onPrimary: () -> Unit,
    onLock: () -> Unit,
    onFinish: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val running = state == RunState.RUNNING
    val interaction = remember { MutableInteractionSource() }
    val scale = pressScale(interaction)

    // A slow halo that invites the first tap, and keeps a quieter heartbeat going during the
    // run itself — alive, never insistent.
    val transition = rememberInfiniteTransition(label = "primary")
    val invite by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(2_200, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "invite",
    )
    val haloStrength = when (state) {
        RunState.IDLE, RunState.FINISHED -> 0.20f + 0.22f * invite
        RunState.RUNNING -> 0.16f + 0.10f * invite
        RunState.PAUSED -> 0.18f
    }

    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceEvenly,
        verticalAlignment = Alignment.Top,
    ) {
        SecondaryControl(
            icon = if (locked) RunnerIcon.Lock else RunnerIcon.LockOpen,
            label = if (locked) "LOCKED" else "LOCK",
            tint = if (locked) ImranColors.Accent else ImranColors.TextMuted,
            diameter = secondaryDiameter,
            enabled = true,
            onClick = onLock,
        )

        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Box(
                modifier = Modifier
                    .scale(scale)
                    .size(primaryDiameter)
                    .drawBehind {
                        drawCircle(
                            brush = Brush.radialGradient(
                                colors = listOf(
                                    ImranColors.Accent.copy(alpha = haloStrength),
                                    Color.Transparent,
                                ),
                                center = center,
                                radius = size.minDimension * 0.78f,
                            ),
                            radius = size.minDimension * 0.78f,
                        )
                    }
                    .clip(CircleShape)
                    .background(ImranColors.AccentDeep)
                    .clickable(
                        interactionSource = interaction,
                        indication = null,
                        onClick = onPrimary,
                    ),
                contentAlignment = Alignment.Center,
            ) {
                ImranIcon(
                    if (running) RunnerIcon.Pause else RunnerIcon.Play,
                    Color.White,
                    size = primaryDiameter * 0.42f,
                )
            }
            Spacer(Modifier.height(10.dp))
            Text(
                when (state) {
                    RunState.RUNNING -> "PAUSE"
                    RunState.PAUSED -> "RESUME"
                    RunState.FINISHED -> "NEW RUN"
                    RunState.IDLE -> "START"
                },
                style = ImranType.ControlLabel,
            )
        }

        SecondaryControl(
            icon = RunnerIcon.Flag,
            label = "FINISH",
            tint = Color.White,
            diameter = secondaryDiameter,
            enabled = state == RunState.RUNNING || state == RunState.PAUSED,
            onClick = onFinish,
        )
    }
}
