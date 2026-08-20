package com.imran.recorder

import android.app.Application
import com.imran.recorder.data.Prefs

class ImranApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Prefs.init(this)
    }
}
