package com.veergames.veer

import android.app.Activity
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import com.veergames.veer.audio.Haptics
import com.veergames.veer.audio.SoundManager
import com.veergames.veer.data.Progress
import com.veergames.veer.data.Settings
import com.veergames.veer.ui.GameView
import com.veergames.veer.ui.LevelSelectView
import com.veergames.veer.ui.MenuView
import com.veergames.veer.ui.Palette
import com.veergames.veer.ui.SplashView

/**
 * Single-activity host. Screens are custom Views swapped inside a
 * FrameLayout with a short cross-fade; no fragments, no web views.
 */
class MainActivity : Activity() {

    lateinit var settings: Settings; private set
    lateinit var progress: Progress; private set
    lateinit var sound: SoundManager; private set
    lateinit var haptics: Haptics; private set

    private lateinit var root: FrameLayout
    private var current: View? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        settings = Settings(this)
        progress = Progress(this)
        sound = SoundManager(this, settings)
        haptics = Haptics(this, settings)

        root = FrameLayout(this)
        root.setBackgroundColor(Palette.BG_TOP)
        setContentView(root)
        goFullscreen()
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        show(SplashView(this) { showMenu() }, fade = false)
    }

    private fun goFullscreen() {
        if (Build.VERSION.SDK_INT >= 30) {
            window.setDecorFitsSystemWindows(false)
            window.insetsController?.let {
                it.hide(android.view.WindowInsets.Type.systemBars())
                it.systemBarsBehavior =
                    android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility =
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
                    View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
                    View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                    View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                    View.SYSTEM_UI_FLAG_FULLSCREEN or
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) goFullscreen()
    }

    private fun show(view: View, fade: Boolean = true) {
        val old = current
        view.layoutParams = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        root.addView(view)
        current = view
        if (fade) {
            view.alpha = 0f
            view.animate().alpha(1f).setDuration(220).start()
            old?.animate()?.alpha(0f)?.setDuration(180)?.withEndAction {
                root.removeView(old)
            }?.start()
        } else if (old != null) {
            root.removeView(old)
        }
    }

    fun showMenu() {
        sound.updateMusic()
        show(MenuView(this))
    }

    fun showLevelSelect() = show(LevelSelectView(this))

    fun showLevel(levelNum: Int) = show(GameView(this, levelNum))

    override fun onPause() {
        super.onPause()
        sound.onPause()
        (current as? GameView)?.pauseGame()
    }

    override fun onResume() {
        super.onResume()
        sound.onResume()
    }

    override fun onDestroy() {
        super.onDestroy()
        sound.release()
    }

    @Deprecated("framework Activity")
    override fun onBackPressed() {
        val c = current
        when {
            c is GameView && c.handleBack() -> Unit
            c is GameView -> showLevelSelect()
            c is LevelSelectView -> showMenu()
            c is MenuView -> @Suppress("DEPRECATION") super.onBackPressed()
            else -> Unit
        }
    }
}
