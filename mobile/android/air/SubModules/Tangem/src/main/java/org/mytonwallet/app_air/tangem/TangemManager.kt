package org.mytonwallet.app_air.tangem

import android.nfc.NfcAdapter
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import com.tangem.TangemSdk
import com.tangem.common.CompletionResult
import com.tangem.common.card.EllipticCurve
import com.tangem.common.core.Config
import com.tangem.common.core.TangemError
import com.tangem.common.core.TangemSdkError
import com.tangem.common.services.secure.SecureStorage
import com.tangem.crypto.CryptoUtils
import com.tangem.crypto.bip39.Wordlist
import com.tangem.crypto.hdWallet.DerivationPath
import com.tangem.sdk.DefaultSessionViewDelegate
import com.tangem.sdk.extensions.getWordlist
import com.tangem.sdk.nfc.AndroidNfcAvailabilityProvider
import com.tangem.sdk.nfc.NfcManager
import com.tangem.sdk.storage.create
import kotlinx.coroutines.cancel
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import org.mytonwallet.app_air.walletcore.TangemBridge

/** NFC, card selection and signing only. TON message construction and broadcasting stay in JS. */
class TangemManager(private val activity: ComponentActivity) :
    TangemBridge.Handler,
    DefaultLifecycleObserver {
    private val mainHandler = Handler(Looper.getMainLooper())
    private val sessions = TangemSessionState<JSONObject>()
    private var nfcManager: NfcManager? = null
    private var viewDelegate: DefaultSessionViewDelegate? = null
    private var sdk: TangemSdk? = null

    init {
        activity.lifecycle.addObserver(this)
    }

    override fun request(method: String, params: String, completion: (JSONObject) -> Unit) {
        val lifecycleState = activity.lifecycle.currentState
        val nfcEnabled = NfcAdapter.getDefaultAdapter(activity)?.isEnabled == true
        Log.i(TAG, "request=$method lifecycle=$lifecycleState nfcEnabled=$nfcEnabled")
        if (!lifecycleState.isAtLeast(Lifecycle.State.RESUMED) || !nfcEnabled) {
            completion(error("TangemUnavailable"))
            return
        }
        val id = sessions.begin(completion) ?: run {
            completion(error("TangemBusy"))
            return
        }
        val sdk = try {
            getSdk()
        } catch (exception: Exception) {
            Log.e(TAG, "SDK initialization failed", exception)
            resetSdk()
            finish(id, error("TangemFailed"))
            return
        }
        try {
            sdk.forceEnableReaderMode()
            val request = JSONObject(params)
            when (method) {
                "readTangemCard" -> readCard(id, sdk, request)
                "signWithTangem" -> sign(id, sdk, request)
                else -> finish(id, error("TangemUnsupportedOperation"))
            }
        } catch (exception: Exception) {
            Log.e(TAG, "NFC request failed: $method", exception)
            // SDK marks its session Active before inflating the NFC UI. A synchronous
            // startup failure leaves that state stuck; discard that SDK before retrying.
            resetSdk()
            val code = if (exception is IllegalArgumentException || exception is JSONException) {
                "TangemInvalidWallet"
            } else {
                "TangemFailed"
            }
            finish(id, error(code))
        }
    }

    private fun getSdk(): TangemSdk {
        sdk?.let { return it }
        val nfc = nfcManager ?: NfcManager().also {
            it.setCurrentActivity(activity)
            activity.lifecycle.addObserver(it)
            nfcManager = it
        }
        val config = Config().apply {
            tangemApiBaseUrl = "https://api.tangem.org/"
        }
        val delegate = DefaultSessionViewDelegate(nfc, activity).apply { sdkConfig = config }
        viewDelegate = delegate
        return TangemSdk(
            reader = nfc.reader,
            viewDelegate = delegate,
            nfcAvailabilityProvider = AndroidNfcAvailabilityProvider(activity),
            secureStorage = SecureStorage.create(activity),
            wordlist = Wordlist.getWordlist(),
            config = config
        ).also { sdk = it }
    }

    private fun readCard(id: Long, sdk: TangemSdk, request: JSONObject) {
        val hasExplicitPath = request.has("derivationPath")
        val rawPath = when {
            !hasExplicitPath -> DEFAULT_TON_PATH
            request.isNull("derivationPath") -> null
            else -> request.getString("derivationPath")
        }
        val path = rawPath?.let { parsePath(it) }
        sdk.config.defaultDerivationPaths = if (path == null) {
            mutableMapOf()
        } else {
            mutableMapOf(EllipticCurve.Ed25519Slip0010 to listOf(path))
        }
        sdk.startSessionWithRunnable(TangemReadTask()) { result ->
            mainHandler.post {
                if (!sessions.isActive(id)) return@post
                when (result) {
                    is CompletionResult.Failure -> finish(id, sdkError(result.error))

                    is CompletionResult.Success -> {
                        val card = result.data
                        val wallet = selectTangemTonWallet(card.wallets)
                        val masterKey = wallet?.publicKey
                        if (wallet == null || masterKey == null) {
                            finish(id, error("TangemUnsupportedCard"))
                            return@post
                        }
                        val derivedKey = path?.let { wallet.derivedKeys[it]?.publicKey }
                        if (path != null && derivedKey == null &&
                            (hasExplicitPath || wallet.curve == EllipticCurve.Ed25519Slip0010)
                        ) {
                            finish(id, error("TangemUnsupportedCard"))
                            return@post
                        }
                        val publicKey = derivedKey ?: masterKey
                        if (publicKey.size != PUBLIC_KEY_SIZE) {
                            finish(id, error("TangemUnsupportedCard"))
                            return@post
                        }
                        val info = JSONObject()
                            .put("cardId", card.cardId)
                            .put("walletPublicKey", masterKey.toHex())
                            .put("publicKey", publicKey.toHex())
                        if (derivedKey != null) info.put("derivationPath", rawPath)
                        finish(id, info)
                    }
                }
            }
        }
    }

    private fun sign(id: Long, sdk: TangemSdk, request: JSONObject) {
        val cardId = request.getString("cardId").also { require(it.isNotBlank()) }
        val walletPublicKey = parsePublicKey(request.getString("walletPublicKey"))
        val publicKey = parsePublicKey(request.getString("publicKey"))
        val path = request.optString("derivationPath").takeIf { it.isNotEmpty() }?.let(::parsePath)
        require(path != null || walletPublicKey.contentEquals(publicKey))
        val encodedHashes = request.getJSONArray("hashes")
        require(encodedHashes.length() in 1..MAX_HASHES)
        val hashes = Array(encodedHashes.length()) { index ->
            Base64.decode(encodedHashes.getString(index), Base64.NO_WRAP).also {
                require(it.size == HASH_SIZE)
            }
        }
        sdk.sign(hashes, walletPublicKey, cardId, path) { result ->
            mainHandler.post {
                if (!sessions.isActive(id)) return@post
                when (result) {
                    is CompletionResult.Failure -> finish(id, sdkError(result.error))

                    is CompletionResult.Success -> {
                        val response = result.data
                        if (response.cardId != cardId) {
                            finish(id, error("TangemWrongCard"))
                            return@post
                        }
                        val valid = response.signatures.size == hashes.size &&
                            response.signatures.withIndex().all { (index, signature) ->
                                signature.size == SIGNATURE_SIZE && runCatching {
                                    CryptoUtils.verifyHash(
                                        publicKey,
                                        hashes[index],
                                        signature,
                                        EllipticCurve.Ed25519
                                    )
                                }.getOrDefault(false)
                            }
                        if (!valid) {
                            finish(id, error("TangemInvalidSignature"))
                            return@post
                        }
                        finish(
                            id,
                            JSONObject().put("cardId", response.cardId).put(
                                "signatures",
                                JSONArray(
                                    response.signatures.map {
                                        Base64.encodeToString(it, Base64.NO_WRAP)
                                    }
                                )
                            )
                        )
                    }
                }
            }
        }
    }

    private fun finish(id: Long, result: JSONObject) {
        if (!sessions.isActive(id)) return
        Log.i(TAG, "session=$id result=${result.optString("error", "success")}")
        runCatching { sdk?.forceDisableReaderMode() }
        sessions.finish(id, result)
    }

    override fun cancel() {
        sessions.cancel(error("TangemCancelled"))
        resetSdk()
    }

    private fun resetSdk() {
        val readerScope = nfcManager?.reader?.scope
        runCatching { nfcManager?.reader?.stopSession(cancelled = true) }
        runCatching { sdk?.forceDisableReaderMode() }
        runCatching { viewDelegate?.dismiss() }
        readerScope?.cancel()
        nfcManager?.reader?.scope = null
        sdk = null
        viewDelegate = null
    }

    override fun onStop(owner: LifecycleOwner) {
        cancel()
    }

    override fun onDestroy(owner: LifecycleOwner) {
        cancel()
        if (TangemBridge.handler === this) TangemBridge.handler = null
        activity.lifecycle.removeObserver(this)
        sdk = null
        viewDelegate = null
        nfcManager = null
    }

    private fun sdkError(error: TangemError): JSONObject = error(
        when (error) {
            is TangemSdkError.UserCancelled,
            is TangemSdkError.AuthenticationCanceled -> "TangemCancelled"

            is TangemSdkError.Busy -> "TangemBusy"

            is TangemSdkError.WrongCardNumber -> "TangemWrongCard"

            is TangemSdkError.WalletNotFound,
            is TangemSdkError.WrongCardType -> "TangemUnsupportedCard"

            is TangemSdkError.NfcFeatureIsUnavailable -> "TangemUnavailable"

            else -> "TangemFailed"
        }
    )

    private fun error(code: String) = JSONObject().put("error", code)

    private fun parsePublicKey(value: String): ByteArray {
        require(value.matches(Regex("[0-9a-fA-F]{64}")))
        return ByteArray(PUBLIC_KEY_SIZE) { value.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
    }

    private fun parsePath(value: String): DerivationPath {
        require(value.matches(Regex("m(?:/(?:0|[1-9]\\d*)'?){1,10}")))
        require(value.substring(2).split('/').all { it.removeSuffix("'").toLong() < 0x80000000L })
        return DerivationPath(value)
    }

    private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }

    companion object {
        private const val TAG = "TangemManager"
        const val DEFAULT_TON_PATH = "m/44'/607'/0'"
        private const val PUBLIC_KEY_SIZE = 32
        private const val HASH_SIZE = 32
        private const val SIGNATURE_SIZE = 64
        private const val MAX_HASHES = 255
    }
}
