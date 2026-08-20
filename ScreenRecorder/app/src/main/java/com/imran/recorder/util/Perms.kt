package com.imran.recorder.util

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.ContextCompat

object Perms {

    fun has(context: Context, permission: String): Boolean =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

    fun mic(context: Context) = has(context, Manifest.permission.RECORD_AUDIO)

    fun camera(context: Context) = has(context, Manifest.permission.CAMERA)

    fun notifications(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            has(context, Manifest.permission.POST_NOTIFICATIONS)

    fun overlay(context: Context): Boolean = Settings.canDrawOverlays(context)

    fun overlayIntent(context: Context) = Intent(
        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
        Uri.parse("package:${context.packageName}")
    )

    fun appSettingsIntent(context: Context) = Intent(
        Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
        Uri.parse("package:${context.packageName}")
    )

    /** Device-audio capture is an API 29+ feature and needs a real playback device. */
    fun supportsInternalAudio(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return false
        val am = context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return false
        return am.getDevices(AudioManager.GET_DEVICES_OUTPUTS).isNotEmpty()
    }

    fun hasMicHardware(context: Context): Boolean =
        context.packageManager.hasSystemFeature(PackageManager.FEATURE_MICROPHONE)

    fun hasFrontCamera(context: Context): Boolean =
        context.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_FRONT)
}
