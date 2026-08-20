package com.imran.recorder.ui

import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import com.imran.recorder.R
import com.imran.recorder.data.Prefs

class SplashActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_splash)

        val mark = findViewById<android.view.View>(R.id.splashMark)
        val tagline = findViewById<android.view.View>(R.id.splashTagline)

        mark.alpha = 0f
        mark.scaleX = 0.86f
        mark.scaleY = 0.86f
        mark.animate().alpha(1f).scaleX(1f).scaleY(1f).setDuration(520).start()

        tagline.alpha = 0f
        tagline.animate().alpha(0.82f).setStartDelay(260).setDuration(420).start()

        mark.postDelayed({ advance() }, 1150)
    }

    private fun advance() {
        val next = if (Prefs.onboarded) {
            Intent(this, MainActivity::class.java)
        } else {
            Intent(this, OnboardingActivity::class.java)
        }
        startActivity(next)
        overridePendingTransition(R.anim.fade_in, R.anim.fade_out)
        finish()
    }
}
