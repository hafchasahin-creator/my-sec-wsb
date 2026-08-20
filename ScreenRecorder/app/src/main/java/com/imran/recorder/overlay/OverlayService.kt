package com.imran.recorder.overlay

import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Build
import android.os.IBinder
import android.view.Gravity
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.view.TextureView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat
import com.imran.recorder.R
import com.imran.recorder.data.Prefs
import com.imran.recorder.record.RecState
import com.imran.recorder.record.RecorderBus
import com.imran.recorder.record.RecorderService
import com.imran.recorder.util.Format
import com.imran.recorder.util.Perms
import com.imran.recorder.util.visible
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlin.math.abs

/**
 * Owns every window this app draws over other apps: the floating control capsule,
 * the annotation layer, the facecam preview and the pre-roll countdown.
 *
 * Not a foreground service — overlay windows only need SYSTEM_ALERT_WINDOW. The camera
 * is permitted because RecorderService is in the foreground with the camera type while
 * a recording is running.
 */
class OverlayService : Service() {

    private lateinit var wm: WindowManager
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private var bubble: View? = null
    private var bubbleParams: WindowManager.LayoutParams? = null
    private var expanded = false

    private var brushLayer: View? = null
    private var brushView: BrushView? = null

    private var facecam: View? = null
    private var facecamParams: WindowManager.LayoutParams? = null
    private var facecamController: FacecamController? = null

    private var countdown: View? = null

    private var stateJob: Job? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        wm = getSystemService(WINDOW_SERVICE) as WindowManager
        observeRecorder()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_SHOW_BUBBLE -> showBubbleInternal()
            ACTION_HIDE_BUBBLE -> hideBubbleInternal()
            ACTION_TOGGLE_BRUSH -> if (brushLayer == null) showBrushInternal() else hideBrushInternal()
            ACTION_SHOW_BRUSH -> showBrushInternal()
            ACTION_HIDE_BRUSH -> hideBrushInternal()
            ACTION_TOGGLE_FACECAM -> if (facecam == null) showFacecamInternal() else hideFacecamInternal()
            ACTION_SHOW_FACECAM -> showFacecamInternal()
            ACTION_HIDE_FACECAM -> hideFacecamInternal()
            ACTION_COUNTDOWN -> showCountdownInternal(intent.getIntExtra(EXTRA_N, 3))
            ACTION_HIDE_COUNTDOWN -> hideCountdownInternal()
        }
        stopIfEmpty()
        return START_NOT_STICKY
    }

    // ---------------- window helpers ----------------

    private fun overlayType() =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        else
            @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE

    private fun floatingParams(touchable: Boolean = true) = WindowManager.LayoutParams(
        WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.WRAP_CONTENT,
        overlayType(),
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
            (if (touchable) 0 else WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE),
        PixelFormat.TRANSLUCENT
    ).apply { gravity = Gravity.TOP or Gravity.START }

    private fun fullScreenParams(touchable: Boolean) = WindowManager.LayoutParams(
        WindowManager.LayoutParams.MATCH_PARENT,
        WindowManager.LayoutParams.MATCH_PARENT,
        overlayType(),
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
            (if (touchable) 0 else WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE),
        PixelFormat.TRANSLUCENT
    )

    private fun screenSize(): Pair<Int, Int> {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val b = wm.currentWindowMetrics.bounds
            b.width() to b.height()
        } else {
            val m = android.util.DisplayMetrics()
            @Suppress("DEPRECATION")
            wm.defaultDisplay.getMetrics(m)
            m.widthPixels to m.heightPixels
        }
    }

    private fun canDraw(): Boolean {
        if (Perms.overlay(this)) return true
        RecorderBus.say(getString(R.string.perm_overlay_body))
        return false
    }

    // ---------------- floating capsule ----------------

    private fun showBubbleInternal() {
        if (bubble != null) return
        if (!canDraw()) return

        val view = LayoutInflater.from(this).inflate(R.layout.overlay_bubble, null)
        val params = floatingParams()
        val (sw, sh) = screenSize()
        params.x = if (Prefs.bubbleX >= 0) Prefs.bubbleX else sw
        params.y = if (Prefs.bubbleY >= 0) Prefs.bubbleY else (sh * 0.32f).toInt()

        val handle = view.findViewById<View>(R.id.handle)
        val actions = view.findViewById<LinearLayout>(R.id.actions)

        view.findViewById<ImageView>(R.id.btnRecord).setOnClickListener {
            collapse()
            RecorderService.requestStart(this)
        }
        view.findViewById<ImageView>(R.id.btnPause).setOnClickListener {
            RecorderService.send(this, RecorderService.ACTION_TOGGLE_PAUSE)
        }
        view.findViewById<ImageView>(R.id.btnShot).setOnClickListener {
            collapse()
            RecorderService.requestScreenshot(this)
        }
        view.findViewById<ImageView>(R.id.btnBrush).setOnClickListener {
            collapse()
            if (brushLayer == null) showBrushInternal() else hideBrushInternal()
        }
        view.findViewById<ImageView>(R.id.btnStop).setOnClickListener {
            collapse()
            RecorderService.send(this, RecorderService.ACTION_STOP)
        }
        view.findViewById<ImageView>(R.id.btnClose).setOnClickListener {
            Prefs.floatingEnabled = false
            hideBubbleInternal()
            stopIfEmpty()
        }

        attachDrag(handle, params) { toggleExpanded(actions) }

        bubble = view
        bubbleParams = params
        runCatching { wm.addView(view, params) }
            .onFailure { bubble = null; bubbleParams = null; return }

        RecorderBus.setBubble(true)
        renderBubble()
        view.alpha = 0f
        view.animate().alpha(1f).setDuration(180).start()
        // The capsule's width is only known after layout, so dock it once measured —
        // otherwise the default x of "screen width" puts it entirely off-screen.
        view.post { snapToEdge(animated = false) }
    }

    private fun hideBubbleInternal() {
        val view = bubble ?: return
        bubble = null
        bubbleParams = null
        expanded = false
        RecorderBus.setBubble(false)
        runCatching { wm.removeView(view) }
    }

    private fun toggleExpanded(actions: View) {
        expanded = !expanded
        if (expanded) {
            actions.visible(true)
            actions.alpha = 0f
            actions.animate().alpha(1f).setDuration(160).start()
        } else {
            actions.animate().alpha(0f).setDuration(120).withEndAction {
                actions.visible(false)
            }.start()
        }
        renderBubble()
        // Re-snap: the capsule got wider or narrower, so keep it against its edge.
        bubble?.post { snapToEdge(animated = true) }
    }

    private fun collapse() {
        if (!expanded) return
        val actions = bubble?.findViewById<View>(R.id.actions) ?: return
        expanded = false
        actions.visible(false)
        renderBubble()
        bubble?.post { snapToEdge(animated = true) }
    }

    /** Shows only the controls that make sense for the current recorder state. */
    private fun renderBubble() {
        val view = bubble ?: return
        val state = RecorderBus.state.value
        val capturing = state == RecState.RECORDING || state == RecState.PAUSED

        val icon = view.findViewById<ImageView>(R.id.handleIcon)
        val time = view.findViewById<TextView>(R.id.handleTime)
        icon.visible(!capturing)
        time.visible(capturing)
        if (capturing) time.text = Format.clock(RecorderBus.elapsedMs.value)

        view.findViewById<ImageView>(R.id.btnRecord).visible(expanded && !capturing)
        view.findViewById<ImageView>(R.id.btnPause).apply {
            visible(expanded && capturing)
            setImageResource(if (state == RecState.PAUSED) R.drawable.ic_play else R.drawable.ic_pause)
        }
        view.findViewById<ImageView>(R.id.btnStop).visible(expanded && capturing)
        view.findViewById<ImageView>(R.id.btnBrush).apply {
            visible(expanded && capturing)
            setColorFilter(
                ContextCompat.getColor(
                    this@OverlayService,
                    if (brushLayer != null) R.color.brand_500 else R.color.icon_idle
                )
            )
        }
        view.findViewById<ImageView>(R.id.btnShot).visible(expanded)
        view.findViewById<ImageView>(R.id.btnClose).visible(expanded)
    }

    private fun attachDrag(handle: View, params: WindowManager.LayoutParams, onClick: () -> Unit) {
        var downX = 0f
        var downY = 0f
        var startX = 0
        var startY = 0
        var dragging = false
        val slop = (8 * resources.displayMetrics.density)

        handle.setOnTouchListener { _, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downX = event.rawX
                    downY = event.rawY
                    startX = params.x
                    startY = params.y
                    dragging = false
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = event.rawX - downX
                    val dy = event.rawY - downY
                    if (!dragging && (abs(dx) > slop || abs(dy) > slop)) dragging = true
                    if (dragging) {
                        params.x = startX + dx.toInt()
                        params.y = startY + dy.toInt()
                        clampToScreen(params)
                        runCatching { wm.updateViewLayout(bubble, params) }
                    }
                    true
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    if (dragging) {
                        snapToEdge(animated = true)
                    } else {
                        onClick()
                    }
                    true
                }
                else -> false
            }
        }
    }

    private fun clampToScreen(params: WindowManager.LayoutParams) {
        val view = bubble ?: return
        val (sw, sh) = screenSize()
        val w = if (view.width > 0) view.width else view.measuredWidth
        val h = if (view.height > 0) view.height else view.measuredHeight
        params.x = params.x.coerceIn(0, (sw - w).coerceAtLeast(0))
        params.y = params.y.coerceIn(0, (sh - h).coerceAtLeast(0))
    }

    /** Docks the capsule against the nearer side, the way a chat head behaves. */
    private fun snapToEdge(animated: Boolean) {
        val view = bubble ?: return
        val params = bubbleParams ?: return
        val (sw, _) = screenSize()
        val w = if (view.width > 0) view.width else view.measuredWidth
        val targetX = if (params.x + w / 2 < sw / 2) 0 else (sw - w).coerceAtLeast(0)

        if (!animated) {
            params.x = targetX
            clampToScreen(params)
            runCatching { wm.updateViewLayout(view, params) }
            persistPosition(params)
            return
        }

        val from = params.x
        val anim = android.animation.ValueAnimator.ofInt(from, targetX)
        anim.duration = 200
        anim.interpolator = android.view.animation.DecelerateInterpolator()
        anim.addUpdateListener {
            params.x = it.animatedValue as Int
            runCatching { wm.updateViewLayout(view, params) }
        }
        anim.addListener(object : android.animation.AnimatorListenerAdapter() {
            override fun onAnimationEnd(animation: android.animation.Animator) {
                persistPosition(params)
            }
        })
        anim.start()
    }

    private fun persistPosition(params: WindowManager.LayoutParams) {
        Prefs.bubbleX = params.x
        Prefs.bubbleY = params.y
    }

    // ---------------- brush ----------------

    private fun showBrushInternal() {
        if (brushLayer != null) return
        if (!canDraw()) return

        val view = LayoutInflater.from(this).inflate(R.layout.overlay_brush, null)
        val brush = view.findViewById<BrushView>(R.id.brush)
        brush.strokeColor = Prefs.brushColor
        brush.strokeWidth = Prefs.brushWidth

        fun pick(color: Int) {
            brush.strokeColor = color
            Prefs.brushColor = color
        }
        view.findViewById<View>(R.id.swRed).setOnClickListener { pick(Color.parseColor("#FF3B30")) }
        view.findViewById<View>(R.id.swYellow).setOnClickListener { pick(Color.parseColor("#FFCC00")) }
        view.findViewById<View>(R.id.swGreen).setOnClickListener { pick(Color.parseColor("#34C759")) }
        view.findViewById<View>(R.id.swBlue).setOnClickListener { pick(Color.parseColor("#0A84FF")) }
        view.findViewById<View>(R.id.swWhite).setOnClickListener { pick(Color.WHITE) }

        view.findViewById<ImageView>(R.id.brushUndo).setOnClickListener { brush.undo() }
        view.findViewById<ImageView>(R.id.brushClear).setOnClickListener { brush.clearAll() }
        view.findViewById<ImageView>(R.id.brushExit).setOnClickListener { hideBrushInternal() }

        brushLayer = view
        brushView = brush
        runCatching { wm.addView(view, fullScreenParams(touchable = true)) }
            .onFailure { brushLayer = null; brushView = null; return }

        RecorderBus.setBrush(true)
        renderBubble()
        view.alpha = 0f
        view.animate().alpha(1f).setDuration(160).start()
    }

    private fun hideBrushInternal() {
        val view = brushLayer ?: return
        brushLayer = null
        brushView = null
        RecorderBus.setBrush(false)
        runCatching { wm.removeView(view) }
        renderBubble()
    }

    // ---------------- facecam ----------------

    private fun showFacecamInternal() {
        if (facecam != null) return
        if (!canDraw()) return
        if (!Perms.camera(this)) {
            RecorderBus.say(getString(R.string.perm_cam_body))
            return
        }

        val view = LayoutInflater.from(this).inflate(R.layout.overlay_facecam, null)
        val params = floatingParams()
        val (sw, sh) = screenSize()
        params.x = (sw * 0.62f).toInt()
        params.y = (sh * 0.12f).toInt()

        val frame = view.findViewById<View>(R.id.facecamFrame)
        val preview = view.findViewById<TextureView>(R.id.facecamPreview)

        view.findViewById<ImageView>(R.id.facecamClose).setOnClickListener {
            Prefs.facecamEnabled = false
            hideFacecamInternal()
            stopIfEmpty()
        }

        // Drag the frame; drag the corner grip to resize.
        attachFacecamDrag(frame, params)
        attachFacecamResize(view.findViewById(R.id.facecamResize), frame)

        facecam = view
        facecamParams = params
        runCatching { wm.addView(view, params) }
            .onFailure { facecam = null; facecamParams = null; return }

        val controller = FacecamController(this)
        controller.onError = { msg ->
            RecorderBus.say(msg)
            hideFacecamInternal()
        }
        controller.attach(preview)
        facecamController = controller
        RecorderBus.setFacecam(true)
    }

    private fun hideFacecamInternal() {
        val view = facecam ?: return
        facecam = null
        facecamParams = null
        RecorderBus.setFacecam(false)
        runCatching { facecamController?.release() }
        facecamController = null
        runCatching { wm.removeView(view) }
    }

    private fun attachFacecamDrag(handle: View, params: WindowManager.LayoutParams) {
        var downX = 0f
        var downY = 0f
        var startX = 0
        var startY = 0
        handle.setOnTouchListener { _, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downX = event.rawX; downY = event.rawY
                    startX = params.x; startY = params.y
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    params.x = startX + (event.rawX - downX).toInt()
                    params.y = startY + (event.rawY - downY).toInt()
                    val (sw, sh) = screenSize()
                    val v = facecam
                    val w = v?.width ?: 0
                    val h = v?.height ?: 0
                    params.x = params.x.coerceIn(0, (sw - w).coerceAtLeast(0))
                    params.y = params.y.coerceIn(0, (sh - h).coerceAtLeast(0))
                    runCatching { wm.updateViewLayout(facecam, params) }
                    true
                }
                else -> true
            }
        }
    }

    private fun attachFacecamResize(grip: View, frame: View) {
        var downX = 0f
        var startW = 0
        var startH = 0
        val minW = (90 * resources.displayMetrics.density).toInt()
        val maxW = (240 * resources.displayMetrics.density).toInt()

        grip.setOnTouchListener { _, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downX = event.rawX
                    startW = frame.layoutParams.width
                    startH = frame.layoutParams.height
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val delta = (event.rawX - downX).toInt()
                    val newW = (startW + delta).coerceIn(minW, maxW)
                    // Keep the 3:4 portrait ratio the preview is laid out for.
                    frame.layoutParams = frame.layoutParams.apply {
                        width = newW
                        height = (newW * (startH.toFloat() / startW)).toInt()
                    }
                    frame.requestLayout()
                    true
                }
                else -> true
            }
        }
    }

    // ---------------- countdown ----------------

    private fun showCountdownInternal(n: Int) {
        if (!Perms.overlay(this)) return
        val view = countdown ?: run {
            val created = LayoutInflater.from(this).inflate(R.layout.overlay_countdown, null)
            val added = runCatching {
                wm.addView(created, fullScreenParams(touchable = false))
            }.isSuccess
            if (!added) return
            countdown = created
            created
        }
        val text = view.findViewById<TextView>(R.id.countdownText)
        text.text = n.toString()
        text.scaleX = 0.7f
        text.scaleY = 0.7f
        text.alpha = 0.4f
        text.animate().scaleX(1f).scaleY(1f).alpha(1f).setDuration(320).start()
    }

    private fun hideCountdownInternal() {
        val view = countdown ?: return
        countdown = null
        runCatching { wm.removeView(view) }
    }

    // ---------------- visibility during screenshots ----------------

    private fun setVisibleInternal(visible: Boolean) {
        val v = if (visible) View.VISIBLE else View.INVISIBLE
        bubble?.visibility = v
        brushLayer?.visibility = v
        facecam?.visibility = v
    }

    // ---------------- state ----------------

    private fun observeRecorder() {
        stateJob?.cancel()
        stateJob = combine(RecorderBus.state, RecorderBus.elapsedMs) { s, ms -> s to ms }
            .onEach { (state, ms) ->
                val view = bubble ?: return@onEach
                val capturing = state == RecState.RECORDING || state == RecState.PAUSED
                view.findViewById<TextView>(R.id.handleTime).apply {
                    visible(capturing)
                    if (capturing) text = Format.clock(ms)
                }
                view.findViewById<ImageView>(R.id.handleIcon).visible(!capturing)
                renderBubble()
            }
            .launchIn(scope)
    }

    private fun stopIfEmpty() {
        if (bubble == null && brushLayer == null && facecam == null && countdown == null) {
            stopSelf()
        }
    }

    override fun onDestroy() {
        hideBubbleInternal()
        hideBrushInternal()
        hideFacecamInternal()
        hideCountdownInternal()
        scope.cancel()
        instance = null
        super.onDestroy()
    }

    companion object {
        private var instance: OverlayService? = null

        const val ACTION_SHOW_BUBBLE = "overlay.SHOW_BUBBLE"
        const val ACTION_HIDE_BUBBLE = "overlay.HIDE_BUBBLE"
        const val ACTION_SHOW_BRUSH = "overlay.SHOW_BRUSH"
        const val ACTION_HIDE_BRUSH = "overlay.HIDE_BRUSH"
        const val ACTION_TOGGLE_BRUSH = "overlay.TOGGLE_BRUSH"
        const val ACTION_SHOW_FACECAM = "overlay.SHOW_FACECAM"
        const val ACTION_HIDE_FACECAM = "overlay.HIDE_FACECAM"
        const val ACTION_TOGGLE_FACECAM = "overlay.TOGGLE_FACECAM"
        const val ACTION_COUNTDOWN = "overlay.COUNTDOWN"
        const val ACTION_HIDE_COUNTDOWN = "overlay.HIDE_COUNTDOWN"
        const val EXTRA_N = "n"

        private fun send(context: Context, action: String, n: Int = 0) {
            runCatching {
                context.startService(
                    Intent(context, OverlayService::class.java)
                        .setAction(action)
                        .putExtra(EXTRA_N, n)
                )
            }
        }

        fun showBubble(context: Context) = send(context, ACTION_SHOW_BUBBLE)
        fun hideBubble() { instance?.hideBubbleInternal(); instance?.stopIfEmpty() }
        fun showBrush(context: Context) = send(context, ACTION_SHOW_BRUSH)
        fun toggleBrush(context: Context) = send(context, ACTION_TOGGLE_BRUSH)
        fun hideBrush() { instance?.hideBrushInternal(); instance?.stopIfEmpty() }
        fun showFacecam(context: Context) = send(context, ACTION_SHOW_FACECAM)
        fun toggleFacecam(context: Context) = send(context, ACTION_TOGGLE_FACECAM)
        fun hideFacecam() { instance?.hideFacecamInternal(); instance?.stopIfEmpty() }
        fun showCountdown(context: Context, n: Int) = send(context, ACTION_COUNTDOWN, n)
        fun hideCountdown() { instance?.hideCountdownInternal() }

        fun setOverlaysVisible(visible: Boolean) {
            instance?.setVisibleInternal(visible)
        }

        val brushActive: Boolean get() = instance?.brushLayer != null
        val facecamActive: Boolean get() = instance?.facecam != null
        val bubbleActive: Boolean get() = instance?.bubble != null
    }
}
