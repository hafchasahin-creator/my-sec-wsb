package com.imran.recorder.ui.photo

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.fragment.app.Fragment
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.imran.recorder.R
import com.imran.recorder.data.MediaEntry
import com.imran.recorder.data.MediaStoreRepo
import com.imran.recorder.data.Thumbnails
import com.imran.recorder.record.RecorderBus
import com.imran.recorder.ui.MainActivity
import com.imran.recorder.util.visible
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class PhotoFragment : Fragment(R.layout.fragment_photo), MainActivity.Refreshable {

    private lateinit var grid: RecyclerView
    private lateinit var empty: View
    private lateinit var count: TextView
    private lateinit var adapter: PhotoAdapter

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        grid = view.findViewById(R.id.grid)
        empty = view.findViewById(R.id.empty)
        count = view.findViewById(R.id.count)

        adapter = PhotoAdapter { item, _ ->
            PhotoViewerActivity.open(requireContext(), item.uri, item.name)
        }

        // Three columns on phones, more when there is width to use.
        val columns = if (resources.configuration.screenWidthDp >= 600) 4 else 3
        grid.layoutManager = GridLayoutManager(requireContext(), columns)
        grid.adapter = adapter
        grid.layoutAnimation = android.view.animation.AnimationUtils
            .loadLayoutAnimation(requireContext(), R.anim.layout_grid)

        view.findViewById<View>(R.id.emptyAction).setOnClickListener {
            (activity as? MainActivity)?.takeScreenshot()
        }

        viewLifecycleOwner.lifecycleScope.launch {
            viewLifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
                RecorderBus.mediaChanged.collectLatest { refresh() }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        refresh()
    }

    override fun refresh() {
        if (view == null) return
        viewLifecycleOwner.lifecycleScope.launch {
            val items = withContext(Dispatchers.IO) { MediaStoreRepo.photos(requireContext()) }
            if (!isAdded) return@launch

            adapter.submitList(items) {
                empty.visible(items.isEmpty())
                grid.visible(items.isNotEmpty())
            }
            if (items.isNotEmpty()) grid.scheduleLayoutAnimation()
            count.text = resources.getQuantityString(R.plurals.shot_count, items.size, items.size)
        }
    }

    private class PhotoAdapter(
        val onOpen: (MediaEntry, Int) -> Unit
    ) : ListAdapter<MediaEntry, PhotoAdapter.VH>(DIFF) {

        class VH(view: View) : RecyclerView.ViewHolder(view) {
            val card: View = view.findViewById(R.id.photoCard)
            val thumb: ImageView = view.findViewById(R.id.thumb)
            val fallback: ImageView = view.findViewById(R.id.thumbFallback)
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) = VH(
            LayoutInflater.from(parent.context).inflate(R.layout.item_photo, parent, false)
        )

        override fun onBindViewHolder(holder: VH, position: Int) {
            val item = getItem(position)
            holder.fallback.visible(true)
            Thumbnails.load(holder.thumb, item.uri, 400)
            holder.thumb.post {
                if (holder.thumb.drawable != null) holder.fallback.visible(false)
            }
            holder.card.setOnClickListener { onOpen(item, position) }
        }

        companion object {
            private val DIFF = object : DiffUtil.ItemCallback<MediaEntry>() {
                override fun areItemsTheSame(a: MediaEntry, b: MediaEntry) = a.id == b.id
                override fun areContentsTheSame(a: MediaEntry, b: MediaEntry) = a == b
            }
        }
    }
}
