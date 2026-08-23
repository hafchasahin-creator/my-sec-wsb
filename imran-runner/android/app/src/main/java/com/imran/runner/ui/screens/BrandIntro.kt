package com.imran.runner.ui.screens

import androidx.compose.animation.core.LinearOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.material3.Text
import com.imran.runner.ui.components.drawRunner
import com.imran.runner.ui.components.roundStroke
import com.imran.runner.ui.theme.ImranColors
import com.imran.runner.ui.theme.ImranType
import kotlin.math.cos
import kotlin.math.sin

/**
 * The launch animation: the gauge draws itself around a runner already mid-stride, then the
 * wordmark settles underneath. It picks up exactly where the system splash icon leaves off, so
 * the app appears to keep moving rather than to cut.
 */
@Composable
fun BrandIntro(modifier: Modifier = Modifier) {
    var started by remember { mutableStateOf(false) }
    var phase by remember { mutableFloatStateOf(0f) }

    LaunchedEffect(Unit) {
        started = true
        var previous = 0L
        while (true) {
            withFrameNanos { now ->
                if (previous != 0L) {
                    val dt = ((now - previous) / 1_000_000_000.0).toFloat().coerceIn(0f, 0.064f)
                    phase = (phase + 1.35f * dt * 2f * Math.PI.toFloat()) % (2f * Math.PI.toFloat())
                }
                previous = now
            }
        }
    }

    val sweep by animateFloatAsState(
        targetValue = if (started) 1f else 0f,
        animationSpec = tween(900, easing = LinearOutSlowInEasing),
        label = "introSweep",
    )
    val wordmark by animateFloatAsState(
        targetValue = if (started) 1f else 0f,
        animationSpec = tween(700, delayMillis = 380, easing = LinearOutSlowInEasing),
        label = "introWord",
    )

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(ImranColors.Background),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Canvas(Modifier.size(168.dp)) {
                val stroke = size.minDimension * 0.045f
                val inset = stroke * 1.6f
                val arcSize = Size(size.width - inset * 2f, size.height - inset * 2f)
                val topLeft = Offset(inset, inset)

                drawArc(
                    color = ImranColors.Track,
                    startAngle = 135f, sweepAngle = 270f, useCenter = false,
                    topLeft = topLeft, size = arcSize, style = roundStroke(stroke),
                )
                if (sweep > 0.01f) {
                    val swept = 270f * sweep * 0.78f
                    drawArc(
                        color = ImranColors.Accent,
                        startAngle = 135f, sweepAngle = swept, useCenter = false,
                        topLeft = topLeft, size = arcSize,
                        style = roundStroke(stroke * 2.6f), alpha = 0.10f,
                    )
                    drawArc(
                        color = ImranColors.Accent,
                        startAngle = 135f, sweepAngle = swept, useCenter = false,
                        topLeft = topLeft, size = arcSize, style = roundStroke(stroke),
                    )
                    val angle = Math.toRadians((135f + swept).toDouble())
                    val radius = arcSize.minDimension / 2f
                    val tip = Offset(
                        size.width / 2f + radius * cos(angle).toFloat(),
                        size.height / 2f + radius * sin(angle).toFloat(),
                    )
                    drawCircle(
                        brush = Brush.radialGradient(
                            listOf(ImranColors.Accent.copy(alpha = 0.5f), Color.Transparent),
                            center = tip,
                            radius = stroke * 2.6f,
                        ),
                        radius = stroke * 2.6f,
                        center = tip,
                    )
                    drawCircle(Color.White, stroke * 0.55f, tip)
                }

                drawRunner(
                    feet = Offset(size.width / 2f, size.height * 0.70f),
                    height = size.height * 0.38f,
                    phase = phase,
                    intensity = 1f,
                    breath = 0f,
                    bright = ImranColors.Accent,
                    dim = ImranColors.AccentShadow,
                )
            }

            Spacer(Modifier.height(30.dp))
            Column(
                modifier = Modifier.alpha(wordmark),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    "IMRAN RUNNER",
                    style = ImranType.Title.copy(fontSize = 24.sp, letterSpacing = 6.sp),
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(9.dp))
                Text(
                    "GPS RUN TRACKER",
                    style = ImranType.Label.copy(color = ImranColors.Accent),
                    textAlign = TextAlign.Center,
                )
            }
        }
    }
}
