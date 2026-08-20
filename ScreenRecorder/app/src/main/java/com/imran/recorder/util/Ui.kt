package com.imran.recorder.util

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding

fun Context.dp(v: Float): Int = (v * resources.displayMetrics.density + 0.5f).toInt()

fun Context.toast(msg: CharSequence) {
    Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
}

fun View.visible(show: Boolean) {
    visibility = if (show) View.VISIBLE else View.GONE
}

/** Pads for the status bar without eating the view's existing top padding. */
fun View.padTopForStatusBar() {
    val base = paddingTop
    ViewCompat.setOnApplyWindowInsetsListener(this) { v, insets ->
        val top = insets.getInsets(WindowInsetsCompat.Type.statusBars()).top
        v.updatePadding(top = base + top)
        insets
    }
    ViewCompat.requestApplyInsets(this)
}

fun View.padBottomForNavBar() {
    val base = paddingBottom
    ViewCompat.setOnApplyWindowInsetsListener(this) { v, insets ->
        val bottom = insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom
        v.updatePadding(bottom = base + bottom)
        insets
    }
    ViewCompat.requestApplyInsets(this)
}

/** Quick press feedback used by cards and quick-tool circles. */
fun View.pressBounce() {
    animate().cancel()
    animate().scaleX(0.94f).scaleY(0.94f).setDuration(80).withEndAction {
        animate().scaleX(1f).scaleY(1f).setDuration(120).start()
    }.start()
}

fun ViewGroup.inflate(layoutRes: Int, attach: Boolean = false): View =
    android.view.LayoutInflater.from(context).inflate(layoutRes, this, attach)

fun Context.shareMedia(uri: Uri, mime: String) {
    val intent = Intent(Intent.ACTION_SEND).apply {
        type = mime
        putExtra(Intent.EXTRA_STREAM, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    startActivity(Intent.createChooser(intent, null).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    })
}

fun Context.shareMultiple(uris: ArrayList<Uri>, mime: String) {
    val intent = Intent(Intent.ACTION_SEND_MULTIPLE).apply {
        type = mime
        putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    startActivity(Intent.createChooser(intent, null).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    })
}

fun Context.openExternally(uri: Uri, mime: String) {
    val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, mime)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    runCatching { startActivity(intent) }
        .onFailure { toast("No app can open this file") }
}
