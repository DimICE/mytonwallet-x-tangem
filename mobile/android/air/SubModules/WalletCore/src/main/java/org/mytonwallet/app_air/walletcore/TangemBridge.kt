package org.mytonwallet.app_air.walletcore

import org.json.JSONObject

/** The activity owns the NFC SDK; WalletCore only forwards requests from its private JS WebView. */
object TangemBridge {
    interface Handler {
        fun request(method: String, params: String, completion: (JSONObject) -> Unit)
        fun cancel()
    }

    var handler: Handler? = null

    fun request(method: String, params: String, completion: (JSONObject) -> Unit) {
        val handler = handler
        if (handler == null) {
            completion(JSONObject().put("error", "TangemUnavailable"))
        } else {
            handler.request(method, params, completion)
        }
    }
}
