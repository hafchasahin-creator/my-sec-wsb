package com.imran.recorder.ui

import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.RecyclerView
import androidx.viewpager2.widget.ViewPager2
import com.imran.recorder.R
import com.imran.recorder.data.Prefs
import com.imran.recorder.util.dp

/** Four-card first-run walkthrough. Skippable, and remembered so it shows once. */
class OnboardingActivity : AppCompatActivity() {

    private data class Page(val icon: Int, val title: Int, val body: Int)

    private val pages = listOf(
        Page(R.drawable.ic_record_dot, R.string.ob1_title, R.string.ob1_body),
        Page(R.drawable.ic_shield, R.string.ob2_title, R.string.ob2_body),
        Page(R.drawable.ic_bubble, R.string.ob3_title, R.string.ob3_body),
        Page(R.drawable.ic_video, R.string.ob4_title, R.string.ob4_body)
    )

    private lateinit var pager: ViewPager2
    private lateinit var dots: LinearLayout
    private lateinit var nextLabel: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_onboarding)

        pager = findViewById(R.id.obPager)
        dots = findViewById(R.id.obDots)
        nextLabel = findViewById(R.id.obNextLabel)

        pager.adapter = PageAdapter()
        buildDots()

        pager.registerOnPageChangeCallback(object : ViewPager2.OnPageChangeCallback() {
            override fun onPageSelected(position: Int) {
                syncDots(position)
                nextLabel.setText(
                    if (position == pages.lastIndex) R.string.got_it else R.string.next
                )
            }
        })

        findViewById<View>(R.id.obSkip).setOnClickListener { finishOnboarding() }
        findViewById<View>(R.id.obNext).setOnClickListener {
            if (pager.currentItem == pages.lastIndex) finishOnboarding()
            else pager.currentItem = pager.currentItem + 1
        }
    }

    private fun buildDots() {
        dots.removeAllViews()
        repeat(pages.size) {
            val dot = View(this)
            val lp = LinearLayout.LayoutParams(dp(8f), dp(8f))
            lp.marginEnd = dp(7f)
            dot.layoutParams = lp
            dot.setBackgroundResource(R.drawable.bg_circle_soft)
            dots.addView(dot)
        }
        syncDots(0)
    }

    private fun syncDots(active: Int) {
        for (i in 0 until dots.childCount) {
            val dot = dots.getChildAt(i)
            val on = i == active
            dot.setBackgroundResource(
                if (on) R.drawable.bg_circle_brand else R.drawable.bg_circle_soft
            )
            val lp = dot.layoutParams as LinearLayout.LayoutParams
            lp.width = if (on) dp(22f) else dp(8f)
            dot.layoutParams = lp
        }
    }

    private fun finishOnboarding() {
        Prefs.onboarded = true
        startActivity(Intent(this, MainActivity::class.java))
        overridePendingTransition(R.anim.fade_in, R.anim.fade_out)
        finish()
    }

    private inner class PageAdapter : RecyclerView.Adapter<PageAdapter.VH>() {
        inner class VH(view: View) : RecyclerView.ViewHolder(view) {
            val icon: ImageView = view.findViewById(R.id.pageIcon)
            val title: TextView = view.findViewById(R.id.pageTitle)
            val body: TextView = view.findViewById(R.id.pageBody)
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) = VH(
            LayoutInflater.from(parent.context)
                .inflate(R.layout.page_onboarding, parent, false)
        )

        override fun getItemCount() = pages.size

        override fun onBindViewHolder(holder: VH, position: Int) {
            val page = pages[position]
            holder.icon.setImageResource(page.icon)
            holder.title.setText(page.title)
            holder.body.setText(page.body)
        }
    }
}
