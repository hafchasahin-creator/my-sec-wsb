package com.imran.recorder.ui.video

import android.os.Bundle
import android.view.View
import android.widget.ImageView
import android.widget.ProgressBar
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.imran.recorder.R
import com.imran.recorder.data.MediaEntry
import com.imran.recorder.data.MediaStoreRepo
import com.imran.recorder.data.Prefs
import com.imran.recorder.data.Thumbnails
import com.imran.recorder.overlay.OverlayService
import com.imran.recorder.record.RecorderBus
import com.imran.recorder.ui.MainActivity
import com.imran.recorder.ui.SheetItem
import com.imran.recorder.ui.Sheets
import com.imran.recorder.ui.player.PlayerActivity
import com.imran.recorder.util.Format
import com.imran.recorder.util.Perms
import com.imran.recorder.util.pressBounce
import com.imran.recorder.util.shareMedia
import com.imran.recorder.util.toast
import com.imran.recorder.util.visible
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class VideoFragment : Fragment(R.layout.fragment_video), MainActivity.Refreshable {

    private lateinit var list: RecyclerView
    private lateinit var empty: View
    private lateinit var adapter: VideoAdapter

    private val host get() = activity as? MainActivity

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        list = view.findViewById(R.id.list)
        empty = view.findViewById(R.id.empty)

        adapter = VideoAdapter(onOpen = ::openItem, onMore = ::showItemSheet)
        list.layoutManager = LinearLayoutManager(requireContext())
        list.adapter = adapter
        list.layoutAnimation =
            android.view.animation.AnimationUtils.loadLayoutAnimation(
                requireContext(), R.anim.layout_grid
            )

        wireQuickTools(view)

        view.findViewById<View>(R.id.storagePill).setOnClickListener { showStorageSheet() }

        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                launch { RecorderBus.mediaChanged.collectLatest { refresh() } }
                launch { RecorderBus.brushOn.collectLatest { syncToolStates() } }
                launch { RecorderBus.facecamOn.collectLatest { syncToolStates() } }
                launch { RecorderBus.bubbleOn.collectLatest { syncToolStates() } }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        refresh()
        syncToolStates()
    }

    // ---------------- quick tools ----------------

    private fun wireQuickTools(view: View) {
        view.findViewById<View>(R.id.toolBrush).setOnClickListener {
            it.pressBounce()
            host?.ensureOverlay {
                OverlayService.toggleBrush(requireContext())
                view.postDelayed({ syncToolStates() }, 220)
            }
        }

        view.findViewById<View>(R.id.toolFacecam).setOnClickListener {
            it.pressBounce()
            if (!Perms.hasFrontCamera(requireContext())) {
                toastSafe("This device has no front camera")
                return@setOnClickListener
            }
            if (OverlayService.facecamActive) {
                Prefs.facecamEnabled = false
                OverlayService.hideFacecam()
                syncToolStates()
                return@setOnClickListener
            }
            host?.ensureCamera { granted ->
                if (!granted) {
                    toastSafe(getString(R.string.perm_cam_body))
                    return@ensureCamera
                }
                host?.ensureOverlay {
                    Prefs.facecamEnabled = true
                    OverlayService.showFacecam(requireContext())
                    view.postDelayed({ syncToolStates() }, 260)
                }
            }
        }

        view.findViewById<View>(R.id.toolShot).setOnClickListener {
            it.pressBounce()
            host?.takeScreenshot()
        }

        view.findViewById<View>(R.id.toolFloating).setOnClickListener {
            it.pressBounce()
            host?.toggleFloating()
            view.postDelayed({ syncToolStates() }, 220)
        }
    }

    /** Active tools get the brand-filled treatment, matching the reference's orange state. */
    private fun syncToolStates() {
        val view = view ?: return
        fun paint(iconId: Int, labelId: Int, on: Boolean) {
            val icon = view.findViewById<ImageView>(iconId)
            icon.setBackgroundResource(
                if (on) R.drawable.bg_circle_brand else R.drawable.bg_circle_soft
            )
            icon.setColorFilter(
                ContextCompat.getColor(
                    requireContext(), if (on) R.color.white else R.color.icon_idle
                )
            )
            view.findViewById<TextView>(labelId).setTextColor(
                ContextCompat.getColor(
                    requireContext(), if (on) R.color.brand_600 else R.color.text_secondary
                )
            )
        }
        paint(R.id.toolBrushIcon, R.id.toolBrushLabel, OverlayService.brushActive)
        paint(R.id.toolFacecamIcon, R.id.toolFacecamLabel, OverlayService.facecamActive)
        paint(R.id.toolFloatingIcon, R.id.toolFloatingLabel, Prefs.floatingEnabled)
    }

    // ---------------- data ----------------

    override fun refresh() {
        val view = view ?: return
        viewLifecycleOwner.lifecycleScope.launch {
            val items = withContext(Dispatchers.IO) { MediaStoreRepo.videos(requireContext()) }
            if (!isAdded) return@launch

            adapter.submitList(items) {
                empty.visible(items.isEmpty())
                list.visible(items.isNotEmpty())
            }
            if (items.isNotEmpty()) list.scheduleLayoutAnimation()

            val (free, total) = withContext(Dispatchers.IO) { MediaStoreRepo.storage(requireContext()) }
            val used = (total - free).coerceAtLeast(0)
            view.findViewById<TextView>(R.id.storageText).text =
                "${Format.sizeShort(used)}/${Format.sizeShort(total)}"
            view.findViewById<ProgressBar>(R.id.storageRing).progress =
                if (total > 0) ((used * 100) / total).toInt() else 0
        }
    }

    // ---------------- item actions ----------------

    private fun openItem(item: MediaEntry) {
        PlayerActivity.open(requireContext(), item.uri, item.name)
    }

    private fun showItemSheet(item: MediaEntry) {
        val ctx = context ?: return
        Sheets.show(ctx, item.name.substringBeforeLast('.'), listOf(
            SheetItem(getString(R.string.play), null, R.drawable.ic_play) { openItem(item) },
            SheetItem(getString(R.string.share), null, R.drawable.ic_share) {
                ctx.shareMedia(item.uri, "video/mp4")
            },
            SheetItem(getString(R.string.rename), null, R.drawable.ic_pencil) { renameItem(item) },
            SheetItem(
                getString(R.string.details),
                "${Format.size(item.sizeBytes)} · ${Format.clock(item.durationMs)}",
                R.drawable.ic_info
            ) { showDetails(item) },
            SheetItem(getString(R.string.delete), null, R.drawable.ic_delete) { deleteItem(item) }
        ))
    }

    private fun renameItem(item: MediaEntry) {
        val act = activity ?: return
        Sheets.prompt(act, getString(R.string.rename_title), item.name.substringBeforeLast('.')) { name ->
            if (name.isBlank()) return@prompt
            viewLifecycleOwner.lifecycleScope.launch {
                val ok = withContext(Dispatchers.IO) {
                    MediaStoreRepo.rename(requireContext(), item, name)
                }
                toastSafe(if (ok) getString(R.string.renamed) else "Could not rename this file")
                refresh()
            }
        }
    }

    private fun deleteItem(item: MediaEntry) {
        val ctx = context ?: return
        Sheets.confirm(
            ctx, getString(R.string.delete_title), getString(R.string.delete_body),
            getString(R.string.delete)
        ) {
            viewLifecycleOwner.lifecycleScope.launch {
                val ok = withContext(Dispatchers.IO) {
                    MediaStoreRepo.delete(requireContext(), item)
                }
                if (ok) Thumbnails.evict(item.uri)
                toastSafe(if (ok) getString(R.string.deleted) else "Could not delete this file")
                refresh()
            }
        }
    }

    private fun showDetails(item: MediaEntry) {
        val ctx = context ?: return
        Sheets.show(ctx, getString(R.string.details), listOf(
            SheetItem(item.name, "File name", R.drawable.ic_video) {},
            SheetItem(Format.clock(item.durationMs), "Duration", R.drawable.ic_timer) {},
            SheetItem(Format.size(item.sizeBytes), "Size", R.drawable.ic_storage) {},
            SheetItem("${item.width}×${item.height}", "Resolution", R.drawable.ic_resolution) {},
            SheetItem(Format.date(item.dateAddedSec), "Recorded", R.drawable.ic_folder) {}
        ))
    }

    private fun showStorageSheet() {
        val ctx = context ?: return
        viewLifecycleOwner.lifecycleScope.launch {
            val (free, total) = withContext(Dispatchers.IO) { MediaStoreRepo.storage(ctx) }
            val videos = withContext(Dispatchers.IO) { MediaStoreRepo.videos(ctx) }
            val photos = withContext(Dispatchers.IO) { MediaStoreRepo.photos(ctx) }
            if (!isAdded) return@launch

            val mine = videos.sumOf { it.sizeBytes } + photos.sumOf { it.sizeBytes }
            Sheets.show(ctx, getString(R.string.set_storage), listOf(
                SheetItem(
                    getString(R.string.storage_free, Format.size(free), Format.size(total)),
                    "Device storage",
                    R.drawable.ic_storage
                ) {},
                SheetItem(
                    Format.size(mine),
                    "Used by ${videos.size} recordings and ${photos.size} screenshots",
                    R.drawable.ic_folder
                ) {},
                SheetItem(
                    MediaStoreRepo.VIDEO_DIR,
                    "Recordings are saved here",
                    R.drawable.ic_video
                ) {},
                SheetItem(
                    MediaStoreRepo.PHOTO_DIR,
                    "Screenshots are saved here",
                    R.drawable.ic_photo
                ) {}
            ))
        }
    }

    private fun toastSafe(message: String) {
        context?.toast(message)
    }
}
