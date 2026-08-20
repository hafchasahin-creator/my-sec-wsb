package com.imran.recorder.ui.tools

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.imran.recorder.R
import com.imran.recorder.data.MediaEntry
import com.imran.recorder.data.MediaStoreRepo
import com.imran.recorder.ui.MainActivity
import com.imran.recorder.ui.SheetItem
import com.imran.recorder.ui.Sheets
import com.imran.recorder.util.Format
import com.imran.recorder.util.shareMultiple
import com.imran.recorder.util.toast
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Utility grid. Every entry here is backed by a real on-device implementation —
 * nothing is a placeholder.
 */
class ToolsFragment : Fragment(R.layout.fragment_tools), MainActivity.Refreshable {

    private data class Tool(
        val icon: Int,
        val title: Int,
        val sub: Int,
        val run: () -> Unit
    )

    private lateinit var tools: List<Tool>

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        tools = listOf(
            Tool(R.drawable.ic_cut, R.string.tool_trim, R.string.tool_trim_sub) {
                pickVideo { TrimActivity.open(requireContext(), it) }
            },
            Tool(R.drawable.ic_compress, R.string.tool_compress, R.string.tool_compress_sub) {
                pickVideo { CompressActivity.open(requireContext(), it) }
            },
            Tool(R.drawable.ic_gif, R.string.tool_gif, R.string.tool_gif_sub) {
                pickVideo { GifActivity.open(requireContext(), it) }
            },
            Tool(R.drawable.ic_pencil, R.string.tool_photo, R.string.tool_photo_sub) {
                pickPhoto { PhotoEditActivity.open(requireContext(), it) }
            },
            Tool(R.drawable.ic_send, R.string.tool_transfer, R.string.tool_transfer_sub) {
                shareRecent()
            }
        )

        val grid = view.findViewById<RecyclerView>(R.id.toolGrid)
        grid.layoutManager = GridLayoutManager(requireContext(), 2)
        grid.adapter = Adapter()
        grid.layoutAnimation = android.view.animation.AnimationUtils
            .loadLayoutAnimation(requireContext(), R.anim.layout_grid)
    }

    override fun refresh() = Unit

    // ---------------- pickers ----------------

    private fun pickVideo(onPicked: (MediaEntry) -> Unit) {
        viewLifecycleOwner.lifecycleScope.launch {
            val ctx = context ?: return@launch
            val items = withContext(Dispatchers.IO) { MediaStoreRepo.videos(ctx) }
            if (!isAdded) return@launch
            if (items.isEmpty()) {
                ctx.toast(getString(R.string.no_media_for_tool))
                return@launch
            }
            Sheets.show(ctx, getString(R.string.pick_a_video), items.take(20).map { item ->
                SheetItem(
                    item.name.substringBeforeLast('.'),
                    "${Format.clock(item.durationMs)} · ${Format.size(item.sizeBytes)}",
                    R.drawable.ic_video
                ) { onPicked(item) }
            })
        }
    }

    private fun pickPhoto(onPicked: (MediaEntry) -> Unit) {
        viewLifecycleOwner.lifecycleScope.launch {
            val ctx = context ?: return@launch
            val items = withContext(Dispatchers.IO) { MediaStoreRepo.photos(ctx) }
            if (!isAdded) return@launch
            if (items.isEmpty()) {
                ctx.toast(getString(R.string.no_media_for_tool))
                return@launch
            }
            Sheets.show(ctx, getString(R.string.pick_a_photo), items.take(20).map { item ->
                SheetItem(
                    item.name.substringBeforeLast('.'),
                    "${item.width}×${item.height} · ${Format.size(item.sizeBytes)}",
                    R.drawable.ic_photo
                ) { onPicked(item) }
            })
        }
    }

    private fun shareRecent() {
        viewLifecycleOwner.lifecycleScope.launch {
            val ctx = context ?: return@launch
            val items = withContext(Dispatchers.IO) { MediaStoreRepo.videos(ctx) }
            if (!isAdded) return@launch
            if (items.isEmpty()) {
                ctx.toast(getString(R.string.no_media_for_tool))
                return@launch
            }
            Sheets.show(ctx, getString(R.string.tool_transfer), buildList {
                add(
                    SheetItem(
                        "Send the latest recording",
                        items.first().name.substringBeforeLast('.'),
                        R.drawable.ic_send
                    ) { ctx.shareMultiple(arrayListOf(items.first().uri), "video/mp4") }
                )
                if (items.size > 1) {
                    add(
                        SheetItem(
                            "Send the last ${minOf(items.size, 5)} recordings",
                            "Opens the Android share sheet",
                            R.drawable.ic_folder
                        ) {
                            ctx.shareMultiple(
                                ArrayList(items.take(5).map { it.uri }), "video/mp4"
                            )
                        }
                    )
                }
            })
        }
    }

    private inner class Adapter : RecyclerView.Adapter<Adapter.VH>() {
        inner class VH(view: View) : RecyclerView.ViewHolder(view) {
            val icon: ImageView = view.findViewById(R.id.toolIcon)
            val title: TextView = view.findViewById(R.id.toolTitle)
            val sub: TextView = view.findViewById(R.id.toolSub)
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) = VH(
            LayoutInflater.from(parent.context).inflate(R.layout.item_tool, parent, false)
        )

        override fun getItemCount() = tools.size

        override fun onBindViewHolder(holder: VH, position: Int) {
            val tool = tools[position]
            holder.icon.setImageResource(tool.icon)
            holder.title.setText(tool.title)
            holder.sub.setText(tool.sub)
            holder.itemView.setOnClickListener { tool.run() }
        }
    }

    companion object {
        fun intentFor(context: Context, cls: Class<*>, entry: MediaEntry): Intent =
            Intent(context, cls).apply {
                putExtra("uri", entry.uri.toString())
                putExtra("name", entry.name)
                putExtra("duration", entry.durationMs)
                putExtra("size", entry.sizeBytes)
                putExtra("width", entry.width)
                putExtra("height", entry.height)
            }
    }
}
