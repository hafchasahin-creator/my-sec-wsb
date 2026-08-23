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
import androidx.compose.ui.graphics.Path
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
import kotlin.math.pow
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

    /** 0..1: how much of the posture is a walk. Fades back out as [run] takes over. */
    var walk by mutableFloatStateOf(0f)

    /** 0..1: how much of the posture is a full run. */
    var run by mutableFloatStateOf(0f)
}

private fun smoothstep(edge0: Float, edge1: Float, x: Float): Float {
    val t = ((x - edge0) / (edge1 - edge0)).coerceIn(0f, 1f)
    return t * t * (3f - 2f * t)
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

                    // The posture morphs idle -> walk -> run with speed, each blend low-passed
                    // so a GPS blip cannot snap the figure between gaits.
                    val runTarget = if (running()) smoothstep(5.5f, 10.5f, speed) else 0f
                    val walkTarget =
                        if (running()) smoothstep(0.3f, 3.0f, speed) * (1f - runTarget) else 0f
                    val blendEase = 1f - exp(-dt / 0.45f)
                    gait.run += (runTarget - gait.run) * blendEase
                    gait.walk += (walkTarget - gait.walk) * blendEase

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

/**
 * One tapered limb segment: a quad between the two joints plus round end caps. Fills with
 * thickness are what turn the figure from a wire diagram into a body.
 */
private fun DrawScope.capsule(
    path: Path,
    p1: Offset,
    r1: Float,
    p2: Offset,
    r2: Float,
    color: Color,
) {
    val dx = p2.x - p1.x
    val dy = p2.y - p1.y
    val len = max(hypot(dx, dy), 1e-4f)
    val nx = -dy / len
    val ny = dx / len
    path.reset()
    path.moveTo(p1.x + nx * r1, p1.y + ny * r1)
    path.lineTo(p2.x + nx * r2, p2.y + ny * r2)
    path.lineTo(p2.x - nx * r2, p2.y - ny * r2)
    path.lineTo(p1.x - nx * r1, p1.y - ny * r1)
    path.close()
    drawPath(path, color)
    drawCircle(color, r1, p1)
    drawCircle(color, r2, p2)
}

/**
 * Draws the runner, facing right, standing on [feet]: a filled, athletic silhouette in the
 * style of the reference glyph, posed by inverse kinematics every frame.
 *
 * [walk] and [run] blend the posture between standing, walking and running; [intensity] scales
 * how much everything moves. The far arm and leg are drawn first in [mid] so the figure reads
 * with depth.
 *
 * @param height total figure height in pixels.
 */
fun DrawScope.drawRunner(
    feet: Offset,
    height: Float,
    phase: Float,
    intensity: Float,
    breath: Float,
    walk: Float,
    run: Float,
    bright: Color,
    mid: Color,
) {
    val h = height

    // Segment lengths.
    val thigh = h * 0.240f
    val shin = h * 0.225f
    val footLen = h * 0.085f
    val upperArm = h * 0.165f
    val foreArm = h * 0.155f
    val torso = h * 0.295f
    val headRadius = h * 0.074f
    val legLength = thigh + shin

    // Segment thicknesses.
    val chestR = h * 0.070f
    val pelvisR = h * 0.058f
    val thighR = h * 0.042f
    val kneeR = h * 0.031f
    val ankleR = h * 0.020f
    val upperArmR = h * 0.030f
    val elbowR = h * 0.025f
    val wristR = h * 0.017f
    val footR = h * 0.021f

    // Posture, blended idle -> walk -> run.
    val stride = h * (0.140f * walk + 0.165f * run) * intensity
    val lift = h * (0.045f * walk + 0.130f * run) * intensity
    val heelKick = h * 0.12f * run * intensity
    val lean = 0.05f + 0.06f * walk + 0.18f * run
    val armSwing = (0.55f * walk + 0.85f * run) * intensity
    val armBias = (-0.05f * walk - 0.50f * run) * intensity
    val armBend = 0.30f + 0.40f * walk + 1.30f * run
    val stance = h * 0.030f * (1f - intensity)

    val bob = -sin(phase * 2f) * h * (0.009f * walk + 0.026f * run) * intensity +
        sin(breath * TWO_PI) * h * 0.008f * (1f - intensity)

    val hip = Offset(feet.x, feet.y - legLength * 0.96f + bob)
    val upX = sin(lean)
    val upY = -cos(lean)
    val chest = Offset(hip.x + upX * torso, hip.y + upY * torso)
    val head = Offset(
        chest.x + upX * (headRadius + h * 0.052f),
        chest.y + upY * (headRadius + h * 0.052f),
    )
    val shoulder = Offset(chest.x, chest.y + h * 0.012f)

    val path = Path()

    fun drawLeg(t: Float, side: Float, color: Color) {
        val x = -cos(t) * stride + side * stance
        val drop = sqrt(max(0f, legLength * legLength * 0.92f - x * x))
        val swing = max(0f, sin(t))
        // The heel starts kicking up just before toe-off, so the trailing foot is already
        // rising while the front foot lands — the moment that reads most like running.
        val tk = t + 0.55f
        val kick = max(0f, sin(tk)) * max(0f, cos(tk)) * 2f
        val ankle = Offset(hip.x + x, hip.y + drop - lift * swing - heelKick * max(0f, kick))
        val knee = solveJoint(hip, ankle, thigh, shin, forward = 1f)

        // Foot pitch from where the foot is in the cycle, continuously: toes-down trailing
        // behind the body, flat underneath it, slightly toes-up reaching for the landing.
        val back = max(0f, -x / max(stride, 1e-4f))
        val front = max(0f, x / max(stride, 1e-4f))
        val pitch = (0.80f * back.pow(1.3f) - 0.22f * front) *
            (0.45f * walk + 1.0f * run) * intensity + 0.05f * intensity
        val toe = Offset(ankle.x + cos(pitch) * footLen, ankle.y + sin(pitch) * footLen)

        capsule(path, hip, thighR, knee, kneeR, color)
        capsule(path, knee, kneeR * 0.96f, ankle, ankleR, color)
        capsule(path, ankle, footR, toe, footR * 0.85f, color)
    }

    fun drawArm(t: Float, color: Color) {
        // Shoulder angle from straight-down: a backward bias keeps the elbow driving behind
        // the body, which is what makes the arm read as pumping rather than reaching.
        val swing = armBias + sin(t) * armSwing +
            sin(breath * TWO_PI) * 0.05f * (1f - intensity)
        val bend = armBend + 0.30f * sin(t) * run * intensity
        val shoulderAngle = swing + lean
        val elbow = Offset(
            shoulder.x + sin(shoulderAngle) * upperArm,
            shoulder.y + cos(shoulderAngle) * upperArm,
        )
        val hand = Offset(
            elbow.x + sin(shoulderAngle + bend) * foreArm,
            elbow.y + cos(shoulderAngle + bend) * foreArm,
        )
        capsule(path, shoulder, upperArmR, elbow, elbowR, color)
        capsule(path, elbow, elbowR * 0.96f, hand, wristR, color)
        drawCircle(color, wristR * 1.25f, hand)
    }

    val opposite = phase + PI.toFloat()

    // Depth order: far limbs, body, near limbs.
    drawArm(phase, mid)
    drawLeg(opposite, side = -1f, color = mid)
    capsule(path, hip, pelvisR, chest, chestR, bright)
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
