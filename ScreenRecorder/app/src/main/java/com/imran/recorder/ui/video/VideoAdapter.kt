package com.imran.recorder.ui.video

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.imran.recorder.R
import com.imran.recorder.data.MediaEntry
import com.imran.recorder.data.Thumbnails
import com.imran.recorder.util.Format
import com.imran.recorder.util.visible

class VideoAdapter(
    private val onOpen: (MediaEntry) -> Unit,
    private val onMore: (MediaEntry) -> Unit,
    private val onToggleSelect: (MediaEntry) -> Unit,
    private val onStartSelection: (MediaEntry) -> Unit
) : ListAdapter<MediaEntry, VideoAdapter.VH>(DIFF) {

    var selectionMode = false
        private set

    private val selected = LinkedHashSet<Long>()

    val selectedCount get() = selected.size

    fun selectedItems(): List<MediaEntry> =
        currentList.filter { selected.contains(it.id) }

    fun setSelectionMode(on: Boolean) {
        if (selectionMode == on) return
        selectionMode = on
        if (!on) selected.clear()
        notifyItemRangeChanged(0, itemCount)
    }

    fun toggle(item: MediaEntry) {
        if (selected.contains(item.id)) selected.remove(item.id) else selected.add(item.id)
        val index = currentList.indexOfFirst { it.id == item.id }
        if (index >= 0) notifyItemChanged(index)
    }

    fun selectAll() {
        val everything = currentList.map { it.id }
        if (selected.size == everything.size) selected.clear() else {
            selected.clear()
            selected.addAll(everything)
        }
        notifyItemRangeChanged(0, itemCount)
    }

    class VH(view: View) : RecyclerView.ViewHolder(view) {
        val thumb: ImageView = view.findViewById(R.id.thumb)
        val fallback: ImageView = view.findViewById(R.id.thumbFallback)
        val duration: TextView = view.findViewById(R.id.duration)
        val name: TextView = view.findViewById(R.id.name)
        val meta: TextView = view.findViewById(R.id.meta)
        val date: TextView = view.findViewById(R.id.date)
        val more: ImageView = view.findViewById(R.id.more)
        val scrim: View = view.findViewById(R.id.selectScrim)
        val mark: ImageView = view.findViewById(R.id.selectMark)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) = VH(
        LayoutInflater.from(parent.context).inflate(R.layout.item_video, parent, false)
    )

    override fun onBindViewHolder(holder: VH, position: Int) {
        val item = getItem(position)

        holder.name.text = item.name.substringBeforeLast('.')
        holder.duration.text = Format.clock(item.durationMs)
        holder.meta.text = buildString {
            append(Format.size(item.sizeBytes))
            if (item.width > 0 && item.height > 0) append(" · ${item.width}×${item.height}")
        }
        holder.date.text = Format.date(item.dateAddedSec)

        holder.fallback.visible(true)
        Thumbnails.load(holder.thumb, item.uri, 480)
        holder.thumb.post { if (holder.thumb.drawable != null) holder.fallback.visible(false) }

        val isSelected = selected.contains(item.id)
        holder.scrim.visible(selectionMode && isSelected)
        holder.mark.visible(selectionMode && isSelected)
        holder.more.visible(!selectionMode)
        holder.itemView.alpha = if (selectionMode && !isSelected) 0.72f else 1f

        holder.itemView.setOnClickListener {
            if (selectionMode) onToggleSelect(item) else onOpen(item)
        }
        holder.itemView.setOnLongClickListener {
            if (!selectionMode) onStartSelection(item)
            true
        }
        holder.more.setOnClickListener { onMore(item) }
    }

    companion object {
        private val DIFF = object : DiffUtil.ItemCallback<MediaEntry>() {
            override fun areItemsTheSame(a: MediaEntry, b: MediaEntry) = a.id == b.id
            override fun areContentsTheSame(a: MediaEntry, b: MediaEntry) = a == b
        }
    }
}
