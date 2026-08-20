package com.imran.recorder.overlay

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.SurfaceTexture
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CaptureRequest
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import android.util.Size
import android.view.Surface
import android.view.TextureView
import com.imran.recorder.util.Perms

/**
 * Minimal Camera2 preview for the floating facecam. Camera2 directly rather than CameraX
 * because the preview lives in a WindowManager overlay, which has no Lifecycle to bind to.
 */
class FacecamController(private val context: Context) {

    private var cameraDevice: CameraDevice? = null
    private var session: CameraCaptureSession? = null
    private var thread: HandlerThread? = null
    private var handler: Handler? = null
    private var frontId: String? = null
    private var previewSize: Size = Size(640, 480)

    var onError: ((String) -> Unit)? = null

    fun attach(textureView: TextureView) {
        if (!Perms.camera(context)) {
            onError?.invoke("Camera permission is required for facecam")
            return
        }
        if (!Perms.hasFrontCamera(context)) {
            onError?.invoke("This device has no front camera")
            return
        }

        thread = HandlerThread("imran-facecam").apply { start() }
        handler = Handler(thread!!.looper)

        if (textureView.isAvailable) {
            open(textureView.surfaceTexture!!)
        } else {
            textureView.surfaceTextureListener = object : TextureView.SurfaceTextureListener {
                override fun onSurfaceTextureAvailable(st: SurfaceTexture, w: Int, h: Int) = open(st)
                override fun onSurfaceTextureSizeChanged(st: SurfaceTexture, w: Int, h: Int) = Unit
                override fun onSurfaceTextureDestroyed(st: SurfaceTexture): Boolean {
                    release()
                    return true
                }

                override fun onSurfaceTextureUpdated(st: SurfaceTexture) = Unit
            }
        }
    }

    @SuppressLint("MissingPermission")
    private fun open(texture: SurfaceTexture) {
        val manager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
        try {
            val id = manager.cameraIdList.firstOrNull { camId ->
                manager.getCameraCharacteristics(camId)
                    .get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_FRONT
            } ?: manager.cameraIdList.firstOrNull()

            if (id == null) {
                onError?.invoke("No camera available")
                return
            }
            frontId = id

            val chars = manager.getCameraCharacteristics(id)
            val map = chars.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
            val sizes = map?.getOutputSizes(SurfaceTexture::class.java)
            if (sizes != null && sizes.isNotEmpty()) {
                // A small preview is plenty for a thumbnail-sized overlay and keeps it cheap.
                previewSize = sizes
                    .filter { it.width <= 1280 && it.height <= 1280 }
                    .maxByOrNull { it.width.toLong() * it.height }
                    ?: sizes.minByOrNull { it.width.toLong() * it.height }!!
            }
            texture.setDefaultBufferSize(previewSize.width, previewSize.height)
            val surface = Surface(texture)

            manager.openCamera(id, object : CameraDevice.StateCallback() {
                override fun onOpened(device: CameraDevice) {
                    cameraDevice = device
                    startPreview(device, surface)
                }

                override fun onDisconnected(device: CameraDevice) {
                    device.close()
                    cameraDevice = null
                }

                override fun onError(device: CameraDevice, error: Int) {
                    device.close()
                    cameraDevice = null
                    onError?.invoke("Camera unavailable (code $error)")
                }
            }, handler)
        } catch (t: Throwable) {
            Log.e(TAG, "open failed", t)
            onError?.invoke("Could not start the camera")
        }
    }

    @Suppress("DEPRECATION")
    private fun startPreview(device: CameraDevice, surface: Surface) {
        try {
            val request = device.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW).apply {
                addTarget(surface)
                set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE)
            }
            device.createCaptureSession(
                listOf(surface),
                object : CameraCaptureSession.StateCallback() {
                    override fun onConfigured(s: CameraCaptureSession) {
                        session = s
                        runCatching { s.setRepeatingRequest(request.build(), null, handler) }
                    }

                    override fun onConfigureFailed(s: CameraCaptureSession) {
                        onError?.invoke("Could not start the camera preview")
                    }
                },
                handler
            )
        } catch (t: Throwable) {
            Log.e(TAG, "preview failed", t)
            onError?.invoke("Could not start the camera preview")
        }
    }

    fun release() {
        runCatching { session?.close() }
        session = null
        runCatching { cameraDevice?.close() }
        cameraDevice = null
        runCatching { thread?.quitSafely() }
        thread = null
        handler = null
    }

    companion object {
        private const val TAG = "FacecamController"
    }
}
