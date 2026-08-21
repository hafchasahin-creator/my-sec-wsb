package com.imran.recorder.record

import android.net.Uri
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow

enum class RecState {
    IDLE,        // nothing running
    COUNTDOWN,   // pre-roll before capture
    STARTING,    // projection acquired, encoder spinning up
    RECORDING,
    PAUSED,
    SAVING       // muxer finalising, file being published
}

/**
 * Single source of truth for recorder state. The service writes, the dashboard,
 * notification and floating controls all read — so they can never disagree.
 */
object RecorderBus {

    private val _state = MutableStateFlow(RecState.IDLE)
    val state = _state.asStateFlow()

    private val _elapsedMs = MutableStateFlow(0L)
    val elapsedMs = _elapsedMs.asStateFlow()

    private val _countdown = MutableStateFlow(0)
    val countdown = _countdown.asStateFlow()

    /** Bytes written so far, read from the output descriptor while capturing. */
    private val _bytes = MutableStateFlow(0L)
    val bytes = _bytes.asStateFlow()

    /** Short description of the running capture, e.g. "1080p · 30fps · Mic". */
    private val _configLabel = MutableStateFlow("")
    val configLabel = _configLabel.asStateFlow()

    private val _brushOn = MutableStateFlow(false)
    val brushOn = _brushOn.asStateFlow()

    private val _facecamOn = MutableStateFlow(false)
    val facecamOn = _facecamOn.asStateFlow()

    private val _bubbleOn = MutableStateFlow(false)
    val bubbleOn = _bubbleOn.asStateFlow()

    private val _mediaChanged = MutableSharedFlow<Unit>(
        replay = 0, extraBufferCapacity = 4, onBufferOverflow = BufferOverflow.DROP_OLDEST
    )
    val mediaChanged = _mediaChanged.asSharedFlow()

    private val _messages = MutableSharedFlow<String>(
        replay = 0, extraBufferCapacity = 4, onBufferOverflow = BufferOverflow.DROP_OLDEST
    )
    val messages = _messages.asSharedFlow()

    private val _savedVideo = MutableSharedFlow<Uri>(
        replay = 0, extraBufferCapacity = 2, onBufferOverflow = BufferOverflow.DROP_OLDEST
    )
    val savedVideo = _savedVideo.asSharedFlow()

    val isBusy: Boolean
        get() = _state.value != RecState.IDLE

    val isCapturing: Boolean
        get() = _state.value == RecState.RECORDING || _state.value == RecState.PAUSED

    fun setState(s: RecState) { _state.value = s }
    fun setElapsed(ms: Long) { _elapsedMs.value = ms }
    fun setCountdown(n: Int) { _countdown.value = n }
    fun setBytes(n: Long) { _bytes.value = n }
    fun setConfigLabel(label: String) { _configLabel.value = label }
    fun setBrush(on: Boolean) { _brushOn.value = on }
    fun setFacecam(on: Boolean) { _facecamOn.value = on }
    fun setBubble(on: Boolean) { _bubbleOn.value = on }

    fun notifyMediaChanged() { _mediaChanged.tryEmit(Unit) }
    fun say(message: String) { _messages.tryEmit(message) }
    fun notifySaved(uri: Uri) { _savedVideo.tryEmit(uri) }
}
