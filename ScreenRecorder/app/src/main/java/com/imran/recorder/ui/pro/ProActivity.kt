package com.imran.recorder.ui.pro

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.android.billingclient.api.ProductDetails
import com.imran.recorder.R
import com.imran.recorder.billing.BillingManager
import com.imran.recorder.billing.Pro
import com.imran.recorder.billing.ProFeature
import com.imran.recorder.util.dp
import com.imran.recorder.util.padTopForStatusBar
import com.imran.recorder.util.toast
import com.imran.recorder.util.visible
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

/** The paywall. Prices and plans come from Play; nothing here is hard-coded currency. */
class ProActivity : AppCompatActivity() {

    private lateinit var billing: BillingManager
    private var plans: List<ProductDetails> = emptyList()
    private var selected: ProductDetails? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_pro)

        findViewById<View>(R.id.proHeader).padTopForStatusBar()
        findViewById<View>(R.id.proClose).setOnClickListener { finish() }

        buildFeatureList()

        billing = BillingManager(this)
        billing.connect()

        findViewById<View>(R.id.proBuy).setOnClickListener { onBuy() }
        findViewById<View>(R.id.proRestore).setOnClickListener {
            billing.restorePurchases()
            toast("Checking Google Play for previous purchases…")
        }

        observe()
    }

    private fun observe() {
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                launch { billing.status.collectLatest { renderState() } }
                launch {
                    billing.products.collectLatest {
                        plans = it.sortedBy { p -> p.productId }
                        selected = plans.firstOrNull { p -> p.productId == BillingManager.YEARLY_PRODUCT }
                            ?: plans.firstOrNull()
                        buildPlans()
                        renderState()
                    }
                }
                launch { Pro.entitled.collectLatest { renderState() } }
                launch {
                    billing.message.collectLatest { msg ->
                        if (msg != null) {
                            toast(msg)
                            billing.clearMessage()
                        }
                    }
                }
            }
        }
    }

    // ---------------- content ----------------

    private fun buildFeatureList() {
        val container = findViewById<LinearLayout>(R.id.proFeatures)
        container.removeAllViews()

        for (feature in ProFeature.entries) {
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = android.view.Gravity.CENTER_VERTICAL
                setPadding(0, dp(9f), 0, dp(9f))
            }
            val tick = ImageView(this).apply {
                layoutParams = LinearLayout.LayoutParams(dp(26f), dp(26f))
                setBackgroundResource(R.drawable.bg_circle_tint)
                setPadding(dp(5f), dp(5f), dp(5f), dp(5f))
                setImageResource(R.drawable.ic_check)
                setColorFilter(getColor(R.color.brand_600))
                contentDescription = null
            }
            val label = TextView(this).apply {
                text = feature.label
                setTextColor(getColor(R.color.text_primary))
                textSize = 15.5f
                val lp = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                )
                lp.marginStart = dp(14f)
                layoutParams = lp
            }
            row.addView(tick)
            row.addView(label)
            container.addView(row)
        }
    }

    private fun buildPlans() {
        val container = findViewById<LinearLayout>(R.id.proPlans)
        container.removeAllViews()
        if (plans.isEmpty()) return

        for (plan in plans) {
            val card = layoutInflater.inflate(R.layout.row_plan, container, false)
            card.findViewById<TextView>(R.id.planName).text = plan.name.ifBlank { plan.productId }
            card.findViewById<TextView>(R.id.planPrice).text = priceOf(plan)
            card.findViewById<TextView>(R.id.planNote).apply {
                val note = plan.description
                visible(note.isNotBlank())
                text = note
            }
            card.findViewById<View>(R.id.planBadge).visible(
                plan.productId == BillingManager.YEARLY_PRODUCT
            )
            card.setBackgroundResource(
                if (plan.productId == selected?.productId) R.drawable.bg_plan_card_selected
                else R.drawable.bg_plan_card
            )
            card.setOnClickListener {
                selected = plan
                buildPlans()
            }
            container.addView(card)
        }
    }

    /** Play formats prices per locale; subscriptions carry theirs on the offer's phases. */
    private fun priceOf(plan: ProductDetails): String {
        plan.oneTimePurchaseOfferDetails?.formattedPrice?.let { return it }
        val phase = plan.subscriptionOfferDetails
            ?.firstOrNull()
            ?.pricingPhases
            ?.pricingPhaseList
            ?.lastOrNull()
        return phase?.formattedPrice ?: ""
    }

    private fun renderState() {
        val state = findViewById<TextView>(R.id.proState)
        val buy = findViewById<View>(R.id.proBuy)
        val buyLabel = findViewById<TextView>(R.id.proBuyLabel)
        val restore = findViewById<View>(R.id.proRestore)

        when {
            Pro.isPro -> {
                state.visible(true)
                state.text = if (Pro.unlockedForDebug) {
                    getString(R.string.pro_debug_note)
                } else {
                    getString(R.string.pro_active)
                }
                buyLabel.setText(R.string.pro_manage)
                buy.setOnClickListener { openPlaySubscriptions() }
                restore.visible(!Pro.unlockedForDebug)
            }
            billing.status.value == BillingManager.Status.CONNECTING -> {
                state.visible(true)
                state.setText(R.string.pro_connecting)
                buy.isEnabled = false
                buy.alpha = 0.6f
            }
            billing.status.value == BillingManager.Status.UNAVAILABLE || plans.isEmpty() -> {
                state.visible(true)
                state.setText(R.string.pro_unavailable)
                buy.isEnabled = false
                buy.alpha = 0.6f
                buyLabel.setText(R.string.pro_continue)
            }
            else -> {
                state.visible(false)
                buy.isEnabled = true
                buy.alpha = 1f
                buyLabel.text = getString(R.string.pro_continue)
                buy.setOnClickListener { onBuy() }
            }
        }
    }

    private fun onBuy() {
        val plan = selected
        if (plan == null) {
            toast(getString(R.string.pro_unavailable))
            return
        }
        billing.launch(this, plan)
    }

    private fun openPlaySubscriptions() {
        val intent = Intent(
            Intent.ACTION_VIEW,
            Uri.parse("https://play.google.com/store/account/subscriptions")
        )
        runCatching { startActivity(intent) }
            .onFailure { toast("Could not open Google Play") }
    }

    override fun onDestroy() {
        billing.release()
        super.onDestroy()
    }

    companion object {
        fun open(context: Context) {
            context.startActivity(Intent(context, ProActivity::class.java))
        }

        /** Explains what is locked, then offers the plans. */
        fun promptFor(context: Context, feature: ProFeature) {
            com.google.android.material.dialog.MaterialAlertDialogBuilder(context)
                .setTitle(R.string.pro_locked_title)
                .setMessage(context.getString(R.string.pro_locked_body, feature.label))
                .setNegativeButton(R.string.not_now, null)
                .setPositiveButton(R.string.pro_see_plans) { _, _ -> open(context) }
                .show()
        }
    }
}
