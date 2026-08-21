package com.imran.recorder.overlay

import android.animation.ValueAnimator
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
import android.view.TextureView
import android.view.View
import android.view.WindowManager
import android.view.animation.DecelerateInterpolator
import android.view.animation.OvershootInterpolator
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import com.imran.recorder.R
import com.imran.recorder.data.Prefs
import com.imran.recorder.record.RecState
import com.imran.recorder.record.RecorderBus
import com.imran.recorder.record.RecorderService
import com.imran.recorder.ui.MainActivity
import com.imran.recorder.util.Perms
import com.imran.recorder.util.visible
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlin.math.abs

/**
 * Owns every window this app draws over other apps: the floating record button and its
 * arc menu, the annotation layer, the facecam preview and the pre-roll countdown.
 *
 * Not a foreground service — overlay windows only need SYSTEM_ALERT_WINDOW. The camera
 * is permitted because RecorderService is in the foreground with the camera type while
 * a recording is running.
 */
class OverlayService : Service() {

    private data class MenuAction(
        val label: String,
        val icon: Int,
        val tint: Int,
        val run: () -> Unit
    )

    private lateinit var wm: WindowManager
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private var fabRoot: View? = null
    private var fabParams: WindowManager.LayoutParams? = null
    private var expanded = false

    /** Button position in screen pixels (top-left of its 96dp holder). */
    private var fabX = 0
    private var fabY = 0

    private val itemViews = ArrayList<View>()
    private var appliedFanLeft: Boolean? = null
    private var pulseAnimator: ValueAnimator? = null

    private var brushLayer: View? = null
    private var facecam: View? = null
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

    private fun collapsedParams() = WindowManager.LayoutParams(
        WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.WRAP_CONTENT,
        overlayType(),
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
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

    private fun floatingParams() = WindowManager.LayoutParams(
        WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.WRAP_CONTENT,
        overlayType(),
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
        PixelFormat.TRANSLUCENT
    ).apply { gravity = Gravity.TOP or Gravity.START }

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

    private fun dp(v: Float) = (v * resources.displayMetrics.density + 0.5f).toInt()

    private fun canDraw(): Boolean {
        if (Perms.overlay(this)) return true
        RecorderBus.say(getString(R.string.perm_overlay_body))
        return false
    }

    // ---------------- floating button ----------------

    private fun showBubbleInternal() {
        if (fabRoot != null) return
        if (!canDraw()) return

        val view = LayoutInflater.from(this).inflate(R.layout.overlay_fab, null)
        val params = collapsedParams()

        val (sw, sh) = screenSize()
        val holder = dp(96f)
        fabX = if (Prefs.bubbleX >= 0) Prefs.bubbleX.coerceIn(0, sw - holder) else sw - holder
        fabY = if (Prefs.bubbleY >= 0) Prefs.bubbleY.coerceIn(0, sh - holder) else (sh * 0.32f).toInt()
        params.x = fabX
        params.y = fabY

        // Collapsed the menu layers must not participate in measurement, or the
        // wrap_content window would stretch to the full screen.
        view.findViewById<View>(R.id.menuScrim).visibility = View.GONE
        view.findViewById<View>(R.id.menuLayer).visibility = View.GONE
        view.findViewById<View>(R.id.menuScrim).setOnClickListener { collapse() }

        attachFabDrag(view.findViewById(R.id.fab))

        fabRoot = view
        fabParams = params
        runCatching { wm.addView(view, params) }
            .onFailure { fabRoot = null; fabParams = null; return }

        RecorderBus.setBubble(true)
        syncFabAppearance()

        view.alpha = 0f
        view.scaleX = 0.7f
        view.scaleY = 0.7f
        view.animate().alpha(1f).scaleX(1f).scaleY(1f)
            .setDuration(260).setInterpolator(OvershootInterpolator(1.6f)).start()
    }

    private fun hideBubbleInternal() {
        val view = fabRoot ?: return
        stopPulse()
        clearItems()
        fabRoot = null
        fabParams = null
        expanded = false
        RecorderBus.setBubble(false)
        runCatching { wm.removeView(view) }
    }

    /** Drag anywhere; a tap that never moved opens the arc menu. */
    private fun attachFabDrag(fab: View) {
        var downX = 0f
        var downY = 0f
        var startX = 0
        var startY = 0
        var dragging = false
        val slop = 10 * resources.displayMetrics.density

        fab.setOnTouchListener { _, event ->
            val params = fabParams ?: return@setOnTouchListener false
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downX = event.rawX; downY = event.rawY
                    startX = fabX; startY = fabY
                    dragging = false
                    fab.animate().scaleX(0.9f).scaleY(0.9f).setDuration(90).start()
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = event.rawX - downX
                    val dy = event.rawY - downY
                    if (!dragging && (abs(dx) > slop || abs(dy) > slop)) {
                        dragging = true
                        if (expanded) collapseImmediate()
                    }
                    if (dragging) {
                        val (sw, sh) = screenSize()
                        val holder = dp(96f)
                        fabX = (startX + dx.toInt()).coerceIn(0, (sw - holder).coerceAtLeast(0))
                        fabY = (startY + dy.toInt()).coerceIn(0, (sh - holder).coerceAtLeast(0))
                        if (expanded) {
                            positionHolder()
                        } else {
                            params.x = fabX
                            params.y = fabY
                            runCatching { wm.updateViewLayout(fabRoot, params) }
                        }
                    }
                    true
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    fab.animate().scaleX(1f).scaleY(1f).setDuration(140).start()
                    if (dragging) {
                        Prefs.bubbleX = fabX
                        Prefs.bubbleY = fabY
                    } else {
                        if (expanded) collapse() else expand()
                    }
                    true
                }
                else -> false
            }
        }
    }

    /** Keeps the button under the finger while the window itself is full-screen. */
    private fun positionHolder() {
        val holder = fabRoot?.findViewById<View>(R.id.fabHolder) ?: return
        val lp = holder.layoutParams as FrameLayout.LayoutParams
        lp.gravity = Gravity.TOP or Gravity.START
        lp.leftMargin = fabX
        lp.topMargin = fabY
        holder.layoutParams = lp
    }

    // ---------------- arc menu ----------------

    private fun expand() {
        val view = fabRoot ?: return
        val params = fabParams ?: return
        if (expanded) return
        expanded = true

        val scrim = view.findViewById<View>(R.id.menuScrim)
        val layer = view.findViewById<FrameLayout>(R.id.menuLayer)
        scrim.visibility = View.VISIBLE
        layer.visibility = View.VISIBLE

        // Grow the window to the whole screen so the arc is not clipped, and pin the
        // button back to where the user left it.
        params.width = WindowManager.LayoutParams.MATCH_PARENT
        params.height = WindowManager.LayoutParams.MATCH_PARENT
        params.x = 0
        params.y = 0
        positionHolder()
        runCatching { wm.updateViewLayout(view, params) }

        scrim.alpha = 0f
        scrim.animate().alpha(1f).setDuration(180).start()

        buildItems(layer)
        view.post { layoutAndAnimateItems(entering = true) }
    }

    private fun collapse() {
        val view = fabRoot ?: return
        val params = fabParams ?: return
        if (!expanded) return
        expanded = false

        val scrim = view.findViewById<View>(R.id.menuScrim)
        scrim.animate().alpha(0f).setDuration(150).start()
        layoutAndAnimateItems(entering = false)

        view.postDelayed({
            if (expanded) return@postDelayed
            clearItems()
            view.findViewById<View>(R.id.menuScrim).visibility = View.GONE
            view.findViewById<View>(R.id.menuLayer).visibility = View.GONE

            val holder = view.findViewById<View>(R.id.fabHolder)
            val lp = holder.layoutParams as FrameLayout.LayoutParams
            lp.leftMargin = 0
            lp.topMargin = 0
            holder.layoutParams = lp

            params.width = WindowManager.LayoutParams.WRAP_CONTENT
            params.height = WindowManager.LayoutParams.WRAP_CONTENT
            params.x = fabX
            params.y = fabY
            runCatching { wm.updateViewLayout(view, params) }
        }, 260)
    }

    /** Teardown with no animation, for when a drag interrupts the open menu. */
    private fun collapseImmediate() {
        val view = fabRoot ?: return
        val params = fabParams ?: return
        expanded = false
        clearItems()
        view.findViewById<View>(R.id.menuScrim).apply { alpha = 1f; visibility = View.GONE }
        view.findViewById<View>(R.id.menuLayer).visibility = View.GONE

        val holder = view.findViewById<View>(R.id.fabHolder)
        val lp = holder.layoutParams as FrameLayout.LayoutParams
        lp.leftMargin = 0
        lp.topMargin = 0
        holder.layoutParams = lp

        params.width = WindowManager.LayoutParams.WRAP_CONTENT
        params.height = WindowManager.LayoutParams.WRAP_CONTENT
        params.x = fabX
        params.y = fabY
        runCatching { wm.updateViewLayout(view, params) }
    }

    private fun actionsForState(): List<MenuAction> {
        val capturing = RecorderBus.isCapturing
        val paused = RecorderBus.state.value == RecState.PAUSED
        val list = ArrayList<MenuAction>(6)

        if (capturing) {
            list += MenuAction(
                getString(if (paused) R.string.resume else R.string.pause),
                if (paused) R.drawable.ic_play else R.drawable.ic_pause,
                R.color.brand_500
            ) {
                RecorderService.send(this, RecorderService.ACTION_TOGGLE_PAUSE)
                // Stay open so the label can flip in place, the way the reference shows it.
                fabRoot?.postDelayed({ if (expanded) refreshItemLabels() }, 160)
            }
            list += MenuAction(getString(R.string.stop), R.drawable.ic_stop_square, R.color.record_red) {
                collapse()
                RecorderService.send(this, RecorderService.ACTION_STOP)
            }
        } else {
            list += MenuAction(getString(R.string.record), R.drawable.ic_record_dot, R.color.record_red) {
                collapse()
                RecorderService.requestStart(this)
            }
        }

        list += MenuAction(getString(R.string.tool_screenshot), R.drawable.ic_camera_frame, R.color.brand_500) {
            collapse()
            fabRoot?.postDelayed({ RecorderService.requestScreenshot(this) }, 240)
        }
        list += MenuAction(
            getString(R.string.tool_brush), R.drawable.ic_brush,
            if (brushLayer != null) R.color.ok_green else R.color.brand_500
        ) {
            collapse()
            fabRoot?.postDelayed({
                if (brushLayer == null) showBrushInternal() else hideBrushInternal()
            }, 240)
        }
        list += MenuAction(
            getString(R.string.tool_facecam), R.drawable.ic_facecam,
            if (facecam != null) R.color.ok_green else R.color.brand_500
        ) {
            if (facecam == null) showFacecamInternal() else hideFacecamInternal()
            fabRoot?.postDelayed({ if (expanded) refreshItemLabels() }, 200)
        }
        list += MenuAction(getString(R.string.home), R.drawable.ic_home, R.color.brand_500) {
            collapse()
            runCatching {
                startActivity(
                    Intent(this, MainActivity::class.java).addFlags(
                        Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                    )
                )
            }
        }
        return list
    }

    private fun buildItems(layer: FrameLayout) {
        clearItems()
        appliedFanLeft = null
        val actions = actionsForState()

        for (action in actions) {
            val item = LayoutInflater.from(this).inflate(R.layout.overlay_fab_item, layer, false)
            val icon = item.findViewById<ImageView>(R.id.fabItemIcon)
            val label = item.findViewById<TextView>(R.id.fabItemLabel)
            val link = item.findViewById<View>(R.id.fabItemLink)

            icon.setImageResource(action.icon)
            icon.setColorFilter(getColor(action.tint))
            label.text = action.label

            val click = View.OnClickListener { action.run() }
            icon.setOnClickListener(click)
            label.setOnClickListener(click)

            item.alpha = 0f
            layer.addView(item)
            itemViews += item
        }
    }

    private fun refreshItemLabels() {
        val layer = fabRoot?.findViewById<FrameLayout>(R.id.menuLayer) ?: return
        buildItems(layer)
        layoutAndAnimateItems(entering = true, stagger = 0L)
    }

    private fun clearItems() {
        val layer = fabRoot?.findViewById<FrameLayout>(R.id.menuLayer)
        for (v in itemViews) layer?.removeView(v)
        itemViews.clear()
    }

    /** Mirrors each row so the icon always sits nearest the button. */
    private fun applyMirror(fanLeft: Boolean) {
        if (appliedFanLeft == fanLeft) return
        appliedFanLeft = fanLeft
        for (item in itemViews) {
            val row = item as? android.widget.LinearLayout ?: continue
            val icon = row.findViewById<View>(R.id.fabItemIcon)
            val link = row.findViewById<View>(R.id.fabItemLink)
            val label = row.findViewById<View>(R.id.fabItemLabel)
            row.removeAllViews()
            if (fanLeft) {
                row.addView(label); row.addView(link); row.addView(icon)
            } else {
                row.addView(icon); row.addView(link); row.addView(label)
            }
        }
    }

    /**
     * Lays the items on an arc centred on the button and animates them out from it.
     * Angles run from above the button to below it, matching the reference's fan.
     */
    private fun layoutAndAnimateItems(entering: Boolean, stagger: Long = 32L) {
        if (itemViews.isEmpty()) return
        val (sw, sh) = screenSize()
        val holder = dp(96f)
        val cx = fabX + holder / 2
        val cy = fabY + holder / 2
        val radius = dp(124f).toFloat()
        val n = itemViews.size

        // Measure everything first: the fan side depends on whether a full row fits.
        var widest = 0
        for (item in itemViews) {
            item.measure(
                View.MeasureSpec.makeMeasureSpec(sw, View.MeasureSpec.AT_MOST),
                View.MeasureSpec.makeMeasureSpec(sh, View.MeasureSpec.AT_MOST)
            )
            if (item.measuredWidth > widest) widest = item.measuredWidth
        }
        val fanLeft = ArcLayout.fanLeft(cx, sw, widest, radius)
        applyMirror(fanLeft)

        if (!entering) {
            // Reuse the offsets recorded on the way in; re-measuring here would relayout
            // the row underneath its own exit animation.
            itemViews.forEachIndexed { index, item ->
                val from = item.tag as? FloatArray ?: floatArrayOf(0f, 0f)
                item.animate().cancel()
                item.animate()
                    .translationX(from[0]).translationY(from[1])
                    .scaleX(0.35f).scaleY(0.35f).alpha(0f)
                    .setStartDelay((itemViews.size - 1 - index) * 22L)
                    .setDuration(180)
                    .setInterpolator(DecelerateInterpolator())
                    .start()
            }
            return
        }

        itemViews.forEachIndexed { index, item ->
            val iw = item.measuredWidth
            val ih = item.measuredHeight
            val iconHalf = dp(23f)

            val place = ArcLayout.place(
                index = index, count = n, cx = cx, cy = cy, radius = radius,
                fanLeft = fanLeft, itemWidth = iw, itemHeight = ih, iconHalf = iconHalf,
                screenWidth = sw, screenHeight = sh
            )

            val lp = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                gravity = Gravity.TOP or Gravity.START
                leftMargin = place.left
                topMargin = place.top
            }
            item.layoutParams = lp

            item.pivotX = place.pivotX
            item.pivotY = place.pivotY

            val fromX = (cx - (lp.leftMargin + item.pivotX)).toFloat()
            val fromY = (cy - (lp.topMargin + item.pivotY)).toFloat()

            item.tag = floatArrayOf(fromX, fromY)
            item.animate().cancel()
            item.translationX = fromX
            item.translationY = fromY
            item.scaleX = 0.35f
            item.scaleY = 0.35f
            item.alpha = 0f
            item.animate()
                .translationX(0f).translationY(0f)
                .scaleX(1f).scaleY(1f).alpha(1f)
                .setStartDelay(index * stagger)
                .setDuration(280)
                .setInterpolator(OvershootInterpolator(1.1f))
                .start()
        }
    }

    // ---------------- recording-state feedback ----------------

    private fun syncFabAppearance() {
        val view = fabRoot ?: return
        val fab = view.findViewById<ImageView>(R.id.fab)
        val capturing = RecorderBus.isCapturing
        val paused = RecorderBus.state.value == RecState.PAUSED

        fab.setImageResource(
            when {
                paused -> R.drawable.ic_play
                capturing -> R.drawable.ic_video
                else -> R.drawable.ic_record_dot
            }
        )
        if (capturing && !paused) startPulse() else stopPulse()
    }

    /** Concentric rings breathe outward while capture is live. */
    private fun startPulse() {
        if (pulseAnimator?.isRunning == true) return
        val view = fabRoot ?: return
        val inner = view.findViewById<View>(R.id.ringInner)
        val outer = view.findViewById<View>(R.id.ringOuter)
        inner.visible(true)
        outer.visible(true)

        pulseAnimator = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = 1_800
            repeatCount = ValueAnimator.INFINITE
            addUpdateListener { anim ->
                val t = anim.animatedValue as Float
                fun ring(v: View, phase: Float) {
                    val p = (t + phase) % 1f
                    val s = 0.85f + p * 0.5f
                    v.scaleX = s
                    v.scaleY = s
                    v.alpha = (1f - p).coerceIn(0f, 1f) * 0.9f
                }
                ring(inner, 0f)
                ring(outer, 0.5f)
            }
            start()
        }
    }

    private fun stopPulse() {
        pulseAnimator?.cancel()
        pulseAnimator = null
        fabRoot?.let {
            it.findViewById<View>(R.id.ringInner).visible(false)
            it.findViewById<View>(R.id.ringOuter).visible(false)
        }
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
        runCatching { wm.addView(view, fullScreenParams(touchable = true)) }
            .onFailure { brushLayer = null; return }

        RecorderBus.setBrush(true)
        view.alpha = 0f
        view.animate().alpha(1f).setDuration(160).start()
    }

    private fun hideBrushInternal() {
        val view = brushLayer ?: return
        brushLayer = null
        RecorderBus.setBrush(false)
        runCatching { wm.removeView(view) }
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

        attachFacecamDrag(frame, params)
        attachFacecamResize(view.findViewById(R.id.facecamResize), frame)

        facecam = view
        runCatching { wm.addView(view, params) }
            .onFailure { facecam = null; return }

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
        val minW = dp(90f)
        val maxW = dp(240f)

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
        fabRoot?.visibility = v
        brushLayer?.visibility = v
        facecam?.visibility = v
    }

    // ---------------- state ----------------

    private fun observeRecorder() {
        stateJob?.cancel()
        stateJob = RecorderBus.state
            .onEach {
                syncFabAppearance()
                if (expanded) refreshItemLabels()
            }
            .launchIn(scope)
    }

    private fun stopIfEmpty() {
        if (fabRoot == null && brushLayer == null && facecam == null && countdown == null) {
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
        val bubbleActive: Boolean get() = instance?.fabRoot != null
    }
}
