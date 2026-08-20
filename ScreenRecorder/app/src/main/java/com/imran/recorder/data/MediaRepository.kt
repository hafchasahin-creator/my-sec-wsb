package com.imran.recorder.data

import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.provider.MediaStore
import java.io.File

/** A recording or screenshot produced by this app. */
data class MediaEntry(
    val id: Long,
    val uri: Uri,
    val name: String,
    val sizeBytes: Long,
    val durationMs: Long,
    val dateAddedSec: Long,
    val width: Int,
    val height: Int,
    val isVideo: Boolean
)

/**
 * Reads and mutates the app's own media only. Everything is written under
 * Movies/Imran Recorder and Pictures/Imran Recorder, so scoped storage lets us
 * edit and delete without any broad storage permission.
 */
object MediaStoreRepo {

    const val VIDEO_DIR = "Movies/Imran Recorder"
    const val PHOTO_DIR = "Pictures/Imran Recorder"

    private val videoCols = arrayOf(
        MediaStore.Video.Media._ID,
        MediaStore.Video.Media.DISPLAY_NAME,
        MediaStore.Video.Media.SIZE,
        MediaStore.Video.Media.DURATION,
        MediaStore.Video.Media.DATE_ADDED,
        MediaStore.Video.Media.WIDTH,
        MediaStore.Video.Media.HEIGHT
    )

    private val imageCols = arrayOf(
        MediaStore.Images.Media._ID,
        MediaStore.Images.Media.DISPLAY_NAME,
        MediaStore.Images.Media.SIZE,
        MediaStore.Images.Media.DATE_ADDED,
        MediaStore.Images.Media.WIDTH,
        MediaStore.Images.Media.HEIGHT
    )

    fun videos(context: Context): List<MediaEntry> {
        val out = ArrayList<MediaEntry>()
        val sel = "${MediaStore.Video.Media.RELATIVE_PATH} LIKE ?"
        val args = arrayOf("$VIDEO_DIR%")
        context.contentResolver.query(
            MediaStore.Video.Media.EXTERNAL_CONTENT_URI, videoCols, sel, args,
            "${MediaStore.Video.Media.DATE_ADDED} DESC"
        )?.use { c ->
            val iId = c.getColumnIndexOrThrow(MediaStore.Video.Media._ID)
            val iName = c.getColumnIndexOrThrow(MediaStore.Video.Media.DISPLAY_NAME)
            val iSize = c.getColumnIndexOrThrow(MediaStore.Video.Media.SIZE)
            val iDur = c.getColumnIndexOrThrow(MediaStore.Video.Media.DURATION)
            val iDate = c.getColumnIndexOrThrow(MediaStore.Video.Media.DATE_ADDED)
            val iW = c.getColumnIndexOrThrow(MediaStore.Video.Media.WIDTH)
            val iH = c.getColumnIndexOrThrow(MediaStore.Video.Media.HEIGHT)
            while (c.moveToNext()) {
                val id = c.getLong(iId)
                out += MediaEntry(
                    id = id,
                    uri = ContentUris.withAppendedId(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, id),
                    name = c.getString(iName) ?: "recording.mp4",
                    sizeBytes = c.getLong(iSize),
                    durationMs = c.getLong(iDur),
                    dateAddedSec = c.getLong(iDate),
                    width = c.getInt(iW),
                    height = c.getInt(iH),
                    isVideo = true
                )
            }
        }
        return out
    }

    fun photos(context: Context): List<MediaEntry> {
        val out = ArrayList<MediaEntry>()
        val sel = "${MediaStore.Images.Media.RELATIVE_PATH} LIKE ?"
        val args = arrayOf("$PHOTO_DIR%")
        context.contentResolver.query(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI, imageCols, sel, args,
            "${MediaStore.Images.Media.DATE_ADDED} DESC"
        )?.use { c ->
            val iId = c.getColumnIndexOrThrow(MediaStore.Images.Media._ID)
            val iName = c.getColumnIndexOrThrow(MediaStore.Images.Media.DISPLAY_NAME)
            val iSize = c.getColumnIndexOrThrow(MediaStore.Images.Media.SIZE)
            val iDate = c.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_ADDED)
            val iW = c.getColumnIndexOrThrow(MediaStore.Images.Media.WIDTH)
            val iH = c.getColumnIndexOrThrow(MediaStore.Images.Media.HEIGHT)
            while (c.moveToNext()) {
                val id = c.getLong(iId)
                out += MediaEntry(
                    id = id,
                    uri = ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id),
                    name = c.getString(iName) ?: "screenshot.png",
                    sizeBytes = c.getLong(iSize),
                    durationMs = 0L,
                    dateAddedSec = c.getLong(iDate),
                    width = c.getInt(iW),
                    height = c.getInt(iH),
                    isVideo = false
                )
            }
        }
        return out
    }

    /** Creates a pending video row; call [publish] once bytes are written. */
    fun createVideo(context: Context, displayName: String): Uri? {
        val values = ContentValues().apply {
            put(MediaStore.Video.Media.DISPLAY_NAME, displayName)
            put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
            put(MediaStore.Video.Media.RELATIVE_PATH, VIDEO_DIR)
            put(MediaStore.Video.Media.IS_PENDING, 1)
        }
        return context.contentResolver
            .insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values)
    }

    fun createImage(context: Context, displayName: String, mime: String = "image/png"): Uri? {
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, displayName)
            put(MediaStore.Images.Media.MIME_TYPE, mime)
            put(MediaStore.Images.Media.RELATIVE_PATH, PHOTO_DIR)
            put(MediaStore.Images.Media.IS_PENDING, 1)
        }
        return context.contentResolver
            .insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
    }

    fun createGif(context: Context, displayName: String): Uri? {
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, displayName)
            put(MediaStore.Images.Media.MIME_TYPE, "image/gif")
            put(MediaStore.Images.Media.RELATIVE_PATH, PHOTO_DIR)
            put(MediaStore.Images.Media.IS_PENDING, 1)
        }
        return context.contentResolver
            .insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
    }

    fun publish(context: Context, uri: Uri) {
        runCatching {
            val v = ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }
            context.contentResolver.update(uri, v, null, null)
        }
    }

    fun discard(context: Context, uri: Uri) {
        runCatching { context.contentResolver.delete(uri, null, null) }
    }

    fun delete(context: Context, entry: MediaEntry): Boolean =
        runCatching { context.contentResolver.delete(entry.uri, null, null) > 0 }
            .getOrDefault(false)

    fun rename(context: Context, entry: MediaEntry, newBaseName: String): Boolean {
        val ext = entry.name.substringAfterLast('.', if (entry.isVideo) "mp4" else "png")
        val clean = newBaseName.replace(Regex("[\\\\/:*?\"<>|]"), "_").trim()
        if (clean.isEmpty()) return false
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, "$clean.$ext")
        }
        return runCatching {
            context.contentResolver.update(entry.uri, values, null, null) > 0
        }.getOrDefault(false)
    }

    fun timestampName(prefix: String, ext: String): String {
        val fmt = java.text.SimpleDateFormat("yyyyMMdd_HHmmss", java.util.Locale.US)
        return "${prefix}_${fmt.format(java.util.Date())}.$ext"
    }

    /** Free / total bytes of the volume holding the media directories. */
    fun storage(context: Context): Pair<Long, Long> {
        val dir: File = context.getExternalFilesDir(null) ?: context.filesDir
        return runCatching { dir.usableSpace to dir.totalSpace }.getOrDefault(0L to 0L)
    }
}
