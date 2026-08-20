package com.imran.recorder.record

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Bundle
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.imran.recorder.record.RecorderService as Svc

/**
 * Transparent shim whose only job is to own the system screen-capture dialog.
 * Overlay controls and notification actions cannot show that dialog themselves, so
 * they route through here and the result is forwarded straight to the service.
 */
class ProjectionRequestActivity : AppCompatActivity() {

    private val launcher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val data = result.data
        if (result.resultCode == Activity.RESULT_OK && data != null) {
            val action = if (purpose == PURPOSE_SHOT) Svc.ACTION_SHOOT_WITH else Svc.ACTION_START
            val intent = Intent(this, Svc::class.java).apply {
                this.action = action
                putExtra(Svc.EXTRA_RESULT_CODE, result.resultCode)
                putExtra(Svc.EXTRA_RESULT_DATA, data)
            }
            ContextCompat.startForegroundService(this, intent)
        } else {
            RecorderBus.setState(RecState.IDLE)
            RecorderBus.say(getString(com.imran.recorder.R.string.perm_denied_capture))
        }
        finish()
        overridePendingTransition(0, 0)
    }

    private var purpose: String = PURPOSE_RECORD

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        overridePendingTransition(0, 0)
        purpose = intent?.getStringExtra(EXTRA_PURPOSE) ?: PURPOSE_RECORD

        val mpm = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        runCatching { launcher.launch(mpm.createScreenCaptureIntent()) }
            .onFailure {
                RecorderBus.setState(RecState.IDLE)
                finish()
            }
    }

    companion object {
        const val EXTRA_PURPOSE = "purpose"
        const val PURPOSE_RECORD = "record"
        const val PURPOSE_SHOT = "shot"

        fun intent(context: Context, purpose: String) =
            Intent(context, ProjectionRequestActivity::class.java).apply {
                putExtra(EXTRA_PURPOSE, purpose)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            }
    }
}
