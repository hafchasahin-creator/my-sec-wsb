package com.imran.runner.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.acos
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.sin
import kotlin.math.sqrt

private const val TWO_PI = (2.0 * PI).toFloat()

/**
 * The animation clock behind the runner.
 *
 * Held as plain mutable floats advanced from a frame callback rather than as Compose animations,
 * for two reasons. The stride has to be *continuous* — speeding up must stretch the gait the
 * runner is already in, never restart it — and only the drawing code reads these, so a write per
 * frame re-runs the draw phase and nothing else.
 */
@Stable
class GaitState {
    /** Position within the stride cycle, 0 until 2*pi. */
    var phase by mutableFloatStateOf(0f)

    /** Scroll position of the ground, wrapping at 1. */
    var ground by mutableFloatStateOf(0f)

    /** 0 standing, 1 running flat out. Everything about the pose is scaled by this. */
    var intensity by mutableFloatStateOf(0f)

    /** Slow always-on cycle that keeps the idle pose alive. */
    var breath by mutableFloatStateOf(0f)
}

/**
 * Real runners hold a fairly narrow cadence and lengthen their stride instead, so this rises far
 * more slowly than speed does — the legs visibly quicken, but the figure never turns into a
 * flicker at 18 km/h.
 */
private fun cadenceStepsPerMinute(speedKmh: Float): Float =
    (85f + 7f * speedKmh).coerceIn(90f, 190f)

/**
 * Drives [GaitState] from the live speed.
 *
 * [speedKmh] and [running] are read every frame as lambdas so that a change in speed never
 * recomposes anything — it just changes what the next frame computes.
 */
@Composable
fun rememberGait(speedKmh: () -> Float, running: () -> Boolean): GaitState {
    val gait = remember { GaitState() }
    LaunchedEffect(Unit) {
        var previousFrame = 0L
        while (true) {
            withFrameNanos { frame ->
                if (previousFrame != 0L) {
                    // Clamped so that a stall or a backgrounded frame cannot teleport the stride.
                    val dt = ((frame - previousFrame) / 1_000_000_000.0)
                        .toFloat().coerceIn(0f, 0.064f)
                    val speed = speedKmh().coerceIn(0f, 32f)

                    // While tracking the runner never fully stops, so a runner waiting at a
                    // crossing still jogs on the spot instead of freezing mid-stride.
                    val target = if (running()) (speed / 13f).coerceIn(0.18f, 1f) else 0f
                    gait.intensity += (target - gait.intensity) * (1f - exp(-dt / 0.5f))

                    val cycles = cadenceStepsPerMinute(speed) / 120f * gait.intensity
                    gait.phase = (gait.phase + cycles * TWO_PI * dt) % TWO_PI
                    gait.ground =
                        (gait.ground + (0.22f + 0.10f * speed) * gait.intensity * dt) % 1f
                    gait.breath = (gait.breath + 0.22f * dt) % 1f
                }
                previousFrame = frame
            }
        }
    }
    return gait
}

/**
 * Two-bone inverse kinematics: places the joint between [root] and [target].
 *
 * The runner is posed by moving its feet along a stride path and letting the knees fall out of
 * this, which is what keeps the gait looking like a gait at every stride length instead of the
 * limbs pivoting on canned angles.
 */
private fun solveJoint(
    root: Offset,
    target: Offset,
    upper: Float,
    lower: Float,
    forward: Float,
): Offset {
    val dx = target.x - root.x
    val dy = target.y - root.y
    val raw = max(hypot(dx, dy), 1e-4f)
    val ux = dx / raw
    val uy = dy / raw
    val reach = raw.coerceIn(abs(upper - lower) + 1e-3f, upper + lower - 1e-3f)
    val cosA = ((upper * upper + reach * reach - lower * lower) / (2f * upper * reach))
        .coerceIn(-1f, 1f)
    val a = acos(cosA)
    // Perpendicular to the root-to-target line, pointing the way the joint should bend.
    val px = uy * forward
    val py = -ux * forward
    return Offset(
        root.x + upper * (cos(a) * ux + sin(a) * px),
        root.y + upper * (cos(a) * uy + sin(a) * py),
    )
}

private fun DrawScope.limb(from: Offset, via: Offset, to: Offset, color: Color, width: Float) {
    drawLine(color, from, via, width, StrokeCap.Round)
    drawLine(color, via, to, width, StrokeCap.Round)
}

/**
 * Draws the runner, facing right, standing on [feet].
 *
 * @param height total figure height in pixels.
 */
fun DrawScope.drawRunner(
    feet: Offset,
    height: Float,
    phase: Float,
    intensity: Float,
    breath: Float,
    bright: Color,
    dim: Color,
) {
    val thigh = height * 0.235f
    val shin = height * 0.225f
    val upperArm = height * 0.175f
    val foreArm = height * 0.165f
    val torso = height * 0.30f
    val headRadius = height * 0.082f
    val stroke = height * 0.082f
    val legLength = thigh + shin

    val stride = height * 0.19f * intensity
    val lift = height * 0.15f * intensity
    val stance = height * 0.035f * (1f - intensity)
    // A runner leans further forward the harder they work.
    val lean = 0.09f + 0.17f * intensity

    val bob = -sin(phase * 2f) * height * 0.022f * intensity +
        sin(breath * TWO_PI) * height * 0.009f * (1f - intensity)

    val hip = Offset(feet.x, feet.y - legLength * 0.97f + bob)
    val upX = sin(lean)
    val upY = -cos(lean)
    val shoulder = Offset(hip.x + upX * torso, hip.y + upY * torso)
    val head = Offset(
        shoulder.x + upX * (headRadius + height * 0.045f),
        shoulder.y + upY * (headRadius + height * 0.045f),
    )

    /**
     * The foot travels an arc rather than a straight line: keeping it inside the leg's reach is
     * what stops the knee snapping straight at the ends of a long stride.
     */
    fun foot(t: Float, side: Float): Offset {
        val x = -cos(t) * stride + side * stance
        val drop = sqrt(max(0f, legLength * legLength * 0.95f - x * x))
        return Offset(hip.x + x, hip.y + drop - lift * max(0f, sin(t)))
    }

    fun drawLeg(t: Float, side: Float, color: Color) {
        val ankle = foot(t, side)
        val knee = solveJoint(hip, ankle, thigh, shin, forward = 1f)
        limb(hip, knee, ankle, color, stroke)
    }

    fun drawArm(t: Float, color: Color) {
        val swing = (-0.45f + 0.80f * sin(t)) * intensity +
            sin(breath * TWO_PI) * 0.06f * (1f - intensity)
        val bend = 0.35f + 1.10f * intensity + 0.45f * max(0f, sin(t)) * intensity
        val shoulderAngle = swing + lean
        val elbow = Offset(
            shoulder.x + sin(shoulderAngle) * upperArm,
            shoulder.y + cos(shoulderAngle) * upperArm,
        )
        val hand = Offset(
            elbow.x + sin(shoulderAngle + bend) * foreArm,
            elbow.y + cos(shoulderAngle + bend) * foreArm,
        )
        limb(shoulder, elbow, hand, color, stroke * 0.85f)
    }

    val opposite = phase + PI.toFloat()

    // Far side first, dimmer, so the figure reads with depth rather than as a flat pictogram.
    drawLeg(opposite, side = -1f, color = dim)
    drawArm(phase, color = dim)

    drawLine(bright, hip, shoulder, stroke * 1.05f, StrokeCap.Round)
    drawCircle(bright, headRadius, head)

    drawLeg(phase, side = 1f, color = bright)
    drawArm(opposite, color = bright)
}

/**
 * The ground under the runner: a plane of dots in true perspective, with its vanishing point at
 * the runner's feet, scrolling toward the viewer at running speed.
 */
fun DrawScope.drawGroundGrid(
    vanishing: Offset,
    width: Float,
    depth: Float,
    scroll: Float,
    color: Color,
    alpha: Float,
) {
    if (alpha <= 0.01f) return
    val rows = 9
    val columns = 11
    val zNear = 1f
    // A long way to the far plane: it bunches the distant rows tightly against the vanishing
    // point, which is what makes the plane read as receding rather than as a flat carpet.
    val zFar = 5f
    val sNear = 1f / zNear
    val sFar = 1f / zFar

    for (row in 0 until rows) {
        // Subtracting the scroll walks each row toward the viewer; the modulo recycles the row
        // that falls off the front back to the horizon.
        val step = (row - scroll * 1f).mod(rows.toFloat())
        val z = zNear + step * ((zFar - zNear) / rows)
        val s = 1f / z
        val nearness = ((s - sFar) / (sNear - sFar)).coerceIn(0f, 1f)

        val y = vanishing.y + depth * nearness
        val halfWidth = width * 0.5f * (s / sNear)
        val radius = (0.6f + 1.9f * nearness) * (width / 260f)
        val rowAlpha = alpha * nearness * nearness

        for (column in 0 until columns) {
            val t = (column - (columns - 1) / 2f) / ((columns - 1) / 2f)
            val edgeFade = (1f - abs(t)) * (1f - abs(t) * 0.55f)
            val a = rowAlpha * edgeFade
            if (a <= 0.012f) continue
            drawCircle(
                color = color,
                radius = radius,
                center = Offset(vanishing.x + t * halfWidth, y),
                alpha = a.coerceIn(0f, 1f),
            )
        }
    }
}

/**
 * Faint streaks that only appear once the runner is genuinely moving, to sell speed without
 * cluttering the gauge.
 */
fun DrawScope.drawSpeedStreaks(
    center: Offset,
    span: Size,
    scroll: Float,
    intensity: Float,
    color: Color,
) {
    if (intensity < 0.35f) return
    val strength = ((intensity - 0.35f) / 0.65f).coerceIn(0f, 1f)
    val count = 4
    for (i in 0 until count) {
        val t = (i / count.toFloat() + scroll * 2f).mod(1f)
        val x = center.x + span.width * (0.5f - t) * 1.6f
        val y = center.y - span.height * (0.16f + 0.14f * ((i * 37) % 5) / 5f)
        val length = span.width * (0.10f + 0.06f * strength)
        val fade = (1f - abs(0.5f - t) * 2f).coerceIn(0f, 1f)
        drawLine(
            color = color,
            start = Offset(x, y),
            end = Offset(x + length, y),
            strokeWidth = span.height * 0.012f,
            cap = StrokeCap.Round,
            alpha = 0.16f * strength * fade,
        )
    }
}

/** Convenience for stroking arcs without allocating a [Stroke] per frame. */
internal fun roundStroke(width: Float) = Stroke(width = width, cap = StrokeCap.Round)
