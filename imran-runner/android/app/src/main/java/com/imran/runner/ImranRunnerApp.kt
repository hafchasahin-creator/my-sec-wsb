package com.imran.runner

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import com.imran.runner.data.ProfileStore
import com.imran.runner.data.RunRepository
import com.imran.runner.tracking.RunTracker
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class ImranRunnerApp : Application() {

    companion object {
        const val CHANNEL_TRACKING = "imran_runner_tracking"
    }

    lateinit var repository: RunRepository
        private set
    lateinit var profileStore: ProfileStore
        private set
    lateinit var tracker: RunTracker
        private set

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    override fun onCreate() {
        super.onCreate()
        repository = RunRepository(File(filesDir, "runs"))
        profileStore = ProfileStore(this)
        tracker = RunTracker(this, repository, profileStore)

        // History is read off the main thread; the UI collects the flow and fills in when it lands.
        scope.launch(Dispatchers.IO) { repository.load() }

        createNotificationChannel()
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_TRACKING,
            getString(R.string.notification_channel_tracking),
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = getString(R.string.notification_channel_tracking_desc)
            setShowBadge(false)
            enableVibration(false)
            setSound(null, null)
        }
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }
}
