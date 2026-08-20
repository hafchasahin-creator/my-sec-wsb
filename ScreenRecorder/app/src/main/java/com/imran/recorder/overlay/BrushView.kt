package com.imran.recorder.overlay

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.util.AttributeSet
import android.view.MotionEvent
import android.view.View

/**
 * Free-hand annotation surface shown over the screen while recording.
 * Strokes are kept as vector paths so undo is exact and redraws stay crisp.
 */
class BrushView @JvmOverloads constructor(
    context: Context, attrs: AttributeSet? = null
) : View(context, attrs) {

    private class Stroke(val path: Path, val color: Int, val width: Float)

    private val strokes = ArrayList<Stroke>()
    private var active: Stroke? = null

    private var lastX = 0f
    private var lastY = 0f

    var strokeColor: Int = Color.RED
    var strokeWidth: Float = 10f

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }

    var onStrokesChanged: ((Int) -> Unit)? = null

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        for (s in strokes) {
            paint.color = s.color
            paint.strokeWidth = s.width
            canvas.drawPath(s.path, paint)
        }
        active?.let { s ->
            paint.color = s.color
            paint.strokeWidth = s.width
            canvas.drawPath(s.path, paint)
        }
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                val p = Path().apply { moveTo(event.x, event.y) }
                active = Stroke(p, strokeColor, strokeWidth)
                lastX = event.x
                lastY = event.y
                invalidate()
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                val s = active ?: return true
                // Quadratic smoothing keeps fast strokes from looking like polylines.
                val midX = (lastX + event.x) / 2f
                val midY = (lastY + event.y) / 2f
                s.path.quadTo(lastX, lastY, midX, midY)
                lastX = event.x
                lastY = event.y
                invalidate()
                return true
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                val s = active
                if (s != null) {
                    s.path.lineTo(event.x, event.y)
                    strokes += s
                    active = null
                    onStrokesChanged?.invoke(strokes.size)
                    invalidate()
                }
                return true
            }
        }
        return super.onTouchEvent(event)
    }

    fun undo() {
        if (strokes.isNotEmpty()) {
            strokes.removeAt(strokes.lastIndex)
            onStrokesChanged?.invoke(strokes.size)
            invalidate()
        }
    }

    fun clearAll() {
        if (strokes.isEmpty() && active == null) return
        strokes.clear()
        active = null
        onStrokesChanged?.invoke(0)
        invalidate()
    }

    fun hasStrokes() = strokes.isNotEmpty()
}
