package com.imran.recorder.data

import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.LruCache
import android.util.Size
import android.widget.ImageView
import java.util.concurrent.Executors

/**
 * Small dedicated thumbnail loader. MediaStore.loadThumbnail already does the decoding
 * work on API 29+, so this only needs a cache, a worker pool and recycling-safe tagging —
 * not a full image-loading dependency.
 */
object Thumbnails {

    private val pool = Executors.newFixedThreadPool(3)
    private val main = Handler(Looper.getMainLooper())

    private val cache = object : LruCache<String, Bitmap>(
        ((Runtime.getRuntime().maxMemory() / 1024) / 8).toInt().coerceAtLeast(4096)
    ) {
        override fun sizeOf(key: String, value: Bitmap) = value.byteCount / 1024
    }

    fun load(view: ImageView, uri: Uri, size: Int = 320, onEmpty: (() -> Unit)? = null) {
        val key = "$uri@$size"
        view.tag = key

        cache.get(key)?.let {
            view.setImageBitmap(it)
            return
        }

        view.setImageDrawable(null)
        val ctx: Context = view.context.applicationContext
        pool.execute {
            val bmp = runCatching {
                ctx.contentResolver.loadThumbnail(uri, Size(size, size), null)
            }.getOrNull()

            main.post {
                if (view.tag != key) return@post
                if (bmp != null) {
                    cache.put(key, bmp)
                    view.setImageBitmap(bmp)
                } else {
                    onEmpty?.invoke()
                }
            }
        }
    }

    fun evict(uri: Uri) {
        val prefix = uri.toString()
        cache.snapshot().keys.filter { it.startsWith(prefix) }.forEach { cache.remove(it) }
    }
}
