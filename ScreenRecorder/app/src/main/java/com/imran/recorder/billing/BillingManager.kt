package com.imran.recorder.billing

import android.app.Activity
import android.content.Context
import android.util.Log
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Google Play Billing wrapper for the Pro subscription.
 *
 * Play only serves products to an app installed from Play whose package and signature match
 * a Play Console listing. A sideloaded debug APK therefore reports the service as
 * unavailable — that is expected, and [status] surfaces it instead of pretending to sell
 * anything.
 */
class BillingManager(context: Context) {

    enum class Status { CONNECTING, READY, UNAVAILABLE }

    private val _status = MutableStateFlow(Status.CONNECTING)
    val status = _status.asStateFlow()

    private val _products = MutableStateFlow<List<ProductDetails>>(emptyList())
    val products = _products.asStateFlow()

    private val _message = MutableStateFlow<String?>(null)
    val message = _message.asStateFlow()

    private val purchasesUpdated = PurchasesUpdatedListener { result, purchases ->
        when (result.responseCode) {
            BillingClient.BillingResponseCode.OK -> {
                purchases?.forEach { handlePurchase(it) }
            }
            BillingClient.BillingResponseCode.USER_CANCELED -> Unit
            else -> _message.value = "Purchase did not complete (${result.responseCode})"
        }
    }

    private val client: BillingClient = BillingClient.newBuilder(context.applicationContext)
        .setListener(purchasesUpdated)
        .enablePendingPurchases(
            com.android.billingclient.api.PendingPurchasesParams.newBuilder()
                .enableOneTimeProducts()
                .build()
        )
        .build()

    fun connect() {
        if (client.isReady) {
            refresh()
            return
        }
        client.startConnection(object : BillingClientStateListener {
            override fun onBillingSetupFinished(result: BillingResult) {
                if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                    _status.value = Status.READY
                    refresh()
                } else {
                    _status.value = Status.UNAVAILABLE
                    Log.i(TAG, "billing unavailable: ${result.debugMessage}")
                }
            }

            override fun onBillingServiceDisconnected() {
                _status.value = Status.UNAVAILABLE
            }
        })
    }

    private fun refresh() {
        queryProducts()
        restorePurchases()
    }

    private fun queryProducts() {
        val subs = SUB_PRODUCTS.map {
            QueryProductDetailsParams.Product.newBuilder()
                .setProductId(it)
                .setProductType(BillingClient.ProductType.SUBS)
                .build()
        }
        val inApp = listOf(
            QueryProductDetailsParams.Product.newBuilder()
                .setProductId(LIFETIME_PRODUCT)
                .setProductType(BillingClient.ProductType.INAPP)
                .build()
        )

        val found = ArrayList<ProductDetails>()

        client.queryProductDetailsAsync(
            QueryProductDetailsParams.newBuilder().setProductList(subs).build()
        ) { _, subsResult ->
            found += subsResult
            client.queryProductDetailsAsync(
                QueryProductDetailsParams.newBuilder().setProductList(inApp).build()
            ) { _, inAppResult ->
                found += inAppResult
                _products.value = found.toList()
                if (found.isEmpty()) {
                    _message.value = "No products are configured for this build"
                }
            }
        }
    }

    /** Re-reads owned purchases, which is what "Restore" needs and what start-up should do. */
    fun restorePurchases() {
        if (!client.isReady) return
        var entitled = false

        client.queryPurchasesAsync(
            QueryPurchasesParams.newBuilder()
                .setProductType(BillingClient.ProductType.SUBS).build()
        ) { _, subs ->
            entitled = entitled || subs.any { it.isUsable() }
            subs.forEach { handlePurchase(it) }

            client.queryPurchasesAsync(
                QueryPurchasesParams.newBuilder()
                    .setProductType(BillingClient.ProductType.INAPP).build()
            ) { _, inApp ->
                entitled = entitled || inApp.any { it.isUsable() }
                inApp.forEach { handlePurchase(it) }
                Pro.setEntitled(entitled)
            }
        }
    }

    fun launch(activity: Activity, product: ProductDetails) {
        if (!client.isReady) {
            _message.value = "Play Billing is not available on this build"
            return
        }
        val builder = BillingFlowParams.ProductDetailsParams.newBuilder()
            .setProductDetails(product)

        // Subscriptions must name the offer token; one-time products must not.
        product.subscriptionOfferDetails?.firstOrNull()?.let {
            builder.setOfferToken(it.offerToken)
        }

        val result = client.launchBillingFlow(
            activity,
            BillingFlowParams.newBuilder()
                .setProductDetailsParamsList(listOf(builder.build()))
                .build()
        )
        if (result.responseCode != BillingClient.BillingResponseCode.OK) {
            _message.value = "Could not open checkout (${result.responseCode})"
        }
    }

    private fun handlePurchase(purchase: Purchase) {
        if (!purchase.isUsable()) return
        Pro.setEntitled(true)

        // Play refunds an unacknowledged purchase after three days.
        if (!purchase.isAcknowledged) {
            client.acknowledgePurchase(
                AcknowledgePurchaseParams.newBuilder()
                    .setPurchaseToken(purchase.purchaseToken).build()
            ) { result ->
                if (result.responseCode != BillingClient.BillingResponseCode.OK) {
                    Log.w(TAG, "acknowledge failed: ${result.debugMessage}")
                }
            }
        }
    }

    private fun Purchase.isUsable() = purchaseState == Purchase.PurchaseState.PURCHASED

    fun clearMessage() { _message.value = null }

    fun release() {
        runCatching { client.endConnection() }
    }

    companion object {
        private const val TAG = "BillingManager"

        const val MONTHLY_PRODUCT = "imran_pro_monthly"
        const val YEARLY_PRODUCT = "imran_pro_yearly"
        const val LIFETIME_PRODUCT = "imran_pro_lifetime"

        private val SUB_PRODUCTS = listOf(MONTHLY_PRODUCT, YEARLY_PRODUCT)
    }
}
