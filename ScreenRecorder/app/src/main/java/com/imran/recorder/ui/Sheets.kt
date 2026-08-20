package com.imran.recorder.ui

import android.app.Activity
import android.content.Context
import android.view.LayoutInflater
import android.view.View
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.annotation.DrawableRes
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.imran.recorder.R
import com.imran.recorder.util.visible

data class SheetItem(
    val title: String,
    val subtitle: String? = null,
    @DrawableRes val icon: Int? = null,
    val checked: Boolean = false,
    val onClick: () -> Unit
)

/** One builder for every bottom sheet in the app, so they all look and behave alike. */
object Sheets {

    fun show(context: Context, title: String, items: List<SheetItem>): BottomSheetDialog {
        val dialog = BottomSheetDialog(context)
        val root = LayoutInflater.from(context).inflate(R.layout.sheet_list, null)
        root.findViewById<TextView>(R.id.sheetTitle).text = title

        val container = root.findViewById<LinearLayout>(R.id.sheetItems)
        for (item in items) {
            val row = LayoutInflater.from(context)
                .inflate(R.layout.row_sheet_item, container, false)

            row.findViewById<TextView>(R.id.itemTitle).text = item.title
            row.findViewById<TextView>(R.id.itemSub).apply {
                visible(item.subtitle != null)
                text = item.subtitle.orEmpty()
            }
            row.findViewById<ImageView>(R.id.itemIcon).apply {
                if (item.icon != null) {
                    visible(true)
                    setImageResource(item.icon)
                } else {
                    visibility = View.GONE
                }
            }
            row.findViewById<ImageView>(R.id.itemCheck).visible(item.checked)

            row.setOnClickListener {
                dialog.dismiss()
                item.onClick()
            }
            container.addView(row)
        }

        dialog.setContentView(root)
        dialog.show()
        return dialog
    }

    /** Single-choice picker that reports the selected index. */
    fun <T> pick(
        context: Context,
        title: String,
        options: List<T>,
        label: (T) -> String,
        subtitle: (T) -> String? = { null },
        enabled: (T) -> Boolean = { true },
        current: T?,
        onPick: (T) -> Unit
    ) {
        show(context, title, options.map { option ->
            val isOn = enabled(option)
            SheetItem(
                title = if (isOn) label(option) else "${label(option)} — unavailable",
                subtitle = subtitle(option),
                checked = option == current,
                onClick = { if (isOn) onPick(option) }
            )
        })
    }

    fun confirm(
        context: Context,
        title: String,
        message: String,
        positive: String,
        onConfirm: () -> Unit
    ) {
        MaterialAlertDialogBuilder(context)
            .setTitle(title)
            .setMessage(message)
            .setNegativeButton(R.string.cancel, null)
            .setPositiveButton(positive) { _, _ -> onConfirm() }
            .show()
    }

    fun prompt(
        activity: Activity,
        title: String,
        initial: String,
        onDone: (String) -> Unit
    ) {
        val view = LayoutInflater.from(activity).inflate(R.layout.dialog_input, null)
        val field = view.findViewById<android.widget.EditText>(R.id.input)
        field.setText(initial)
        field.setSelection(initial.length)

        MaterialAlertDialogBuilder(activity)
            .setTitle(title)
            .setView(view)
            .setNegativeButton(R.string.cancel, null)
            .setPositiveButton(R.string.save) { _, _ ->
                onDone(field.text.toString().trim())
            }
            .show()
    }
}
