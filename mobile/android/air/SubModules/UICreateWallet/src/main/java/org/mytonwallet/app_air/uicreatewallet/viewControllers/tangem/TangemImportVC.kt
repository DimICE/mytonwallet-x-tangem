package org.mytonwallet.app_air.uicreatewallet.viewControllers.tangem

import android.content.Context
import android.text.InputType
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Spinner
import androidx.core.view.isVisible
import org.json.JSONObject
import org.mytonwallet.app_air.uicomponents.base.WViewController
import org.mytonwallet.app_air.uicomponents.extensions.dp
import org.mytonwallet.app_air.uicomponents.helpers.ToastHelper
import org.mytonwallet.app_air.uicomponents.helpers.WFont
import org.mytonwallet.app_air.uicomponents.widgets.WButton
import org.mytonwallet.app_air.uicomponents.widgets.WEditText
import org.mytonwallet.app_air.uicomponents.widgets.WLabel
import org.mytonwallet.app_air.uicomponents.widgets.hideKeyboard
import org.mytonwallet.app_air.uicreatewallet.viewControllers.walletAdded.WalletAddedVC
import org.mytonwallet.app_air.walletbasecontext.localization.LocaleController
import org.mytonwallet.app_air.walletbasecontext.theme.WColor
import org.mytonwallet.app_air.walletbasecontext.theme.color
import org.mytonwallet.app_air.walletcontext.globalStorage.WGlobalStorage
import org.mytonwallet.app_air.walletcontext.models.MBlockchainNetwork
import org.mytonwallet.app_air.walletcore.TangemBridge
import org.mytonwallet.app_air.walletcore.WalletCore
import org.mytonwallet.app_air.walletcore.WalletEvent
import org.mytonwallet.app_air.walletcore.api.activateAccount
import org.mytonwallet.app_air.walletcore.models.MAccount
import org.mytonwallet.app_air.walletcore.moshi.api.ApiMethod
import org.mytonwallet.app_air.walletcore.pushNotifications.AirPushNotifications
import org.mytonwallet.app_air.walletcore.stores.AccountStore

class TangemImportVC(context: Context, private val network: MBlockchainNetwork) :
    WViewController(context) {
    @Suppress("ktlint:standard:property-naming")
    override val TAG = "TangemImport"
    override val isContentWidthCapped = true

    private val previousAccountsCount = WGlobalStorage.accountIds().size
    private val versions = listOf("auto", "v4R2", "W5", "v3R2")
    private var isImporting = false

    private fun label(value: String) = WLabel(context).apply {
        text = LocaleController.getString(value)
        setStyle(16f, WFont.Regular)
        setPadding(0, 20.dp, 0, 8.dp)
    }

    private val versionPicker = Spinner(context).apply {
        adapter = ArrayAdapter(
            context,
            android.R.layout.simple_spinner_dropdown_item,
            listOf(LocaleController.getString("Automatic")) + versions.drop(1)
        )
    }
    private val pathPicker = Spinner(context).apply {
        adapter = ArrayAdapter(
            context,
            android.R.layout.simple_spinner_dropdown_item,
            listOf(
                LocaleController.getString("Automatic"),
                "m/44'/607'/0'",
                "m/44'/607'/0'/0/0",
                LocaleController.getString("Card key without derivation"),
                LocaleController.getString("Custom")
            )
        )
        onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(
                parent: AdapterView<*>?,
                view: View?,
                position: Int,
                id: Long
            ) {
                customPath.isVisible = position == 4
            }

            override fun onNothingSelected(parent: AdapterView<*>?) = Unit
        }
    }
    private val customPath = WEditText(context, multilinePaste = false).apply {
        isVisible = false
        isSingleLine = true
        inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
        hint = "m/44'/607'/0'"
        setStyle(16f)
    }
    private val expectedAddress = WEditText(context, multilinePaste = false).apply {
        isSingleLine = true
        inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
        hint = LocaleController.getString("Optional")
        setStyle(16f)
    }
    private val importButton = WButton(context).apply {
        text = LocaleController.getString("Scan Tangem Card")
        setOnClickListener { importCard() }
    }
    private val content = LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(20.dp, 20.dp, 20.dp, 32.dp)
        addView(
            label(
                "Use the same derivation path and wallet version as in Tangem to access your existing address."
            )
        )
        addView(label("Wallet version"))
        addView(versionPicker, LinearLayout.LayoutParams(MATCH_PARENT, 48.dp))
        addView(label("Derivation path"))
        addView(pathPicker, LinearLayout.LayoutParams(MATCH_PARENT, 48.dp))
        addView(customPath, LinearLayout.LayoutParams(MATCH_PARENT, 48.dp))
        addView(label("Existing TON address"))
        addView(expectedAddress, LinearLayout.LayoutParams(MATCH_PARENT, 48.dp))
        addView(
            importButton,
            LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply {
                topMargin =
                    32.dp
            }
        )
    }
    private val scrollView = ScrollView(context).apply {
        id = View.generateViewId()
        addView(content)
    }

    override fun setupViews() {
        super.setupViews()
        setNavTitle("Tangem" + network.localizedIdentifier)
        setupNavBar(true)
        navigationBar?.addCloseButton()
        view.addView(scrollView)
        view.setConstraints { allEdges(scrollView) }
        insetsUpdated()
        updateTheme()
    }

    override fun insetsUpdated() {
        super.insetsUpdated()
        scrollView.setPaddingRelative(
            systemBarStartInset,
            navigationBar?.calculatedMinHeight ?: 0,
            systemBarEndInset,
            navigationController?.getSystemBars()?.bottom ?: 0
        )
    }

    override fun updateTheme() {
        super.updateTheme()
        view.setBackgroundColor(WColor.SecondaryBackground.color)
        customPath.updateTheme()
        expectedAddress.updateTheme()
    }

    private fun importCard() {
        if (isImporting) return
        val options = JSONObject().put("version", versions[versionPicker.selectedItemPosition])
        when (pathPicker.selectedItemPosition) {
            1 -> options.put("derivationPath", "m/44'/607'/0'")
            2 -> options.put("derivationPath", "m/44'/607'/0'/0/0")
            3 -> options.put("derivationPath", JSONObject.NULL)
            4 -> options.put("derivationPath", customPath.text.toString().trim())
        }
        expectedAddress.text.toString().trim().takeIf { it.isNotEmpty() }?.let {
            options.put("expectedAddress", it)
        }
        view.hideKeyboard()
        isImporting = true
        importButton.isLoading = true
        importButton.isEnabled = false
        WalletCore.call(ApiMethod.Auth.ImportTangemAccount(network, options)) { result, error ->
            if (isDestroyed) return@call
            isImporting = false
            importButton.isLoading = false
            importButton.isEnabled = true
            if (error != null || result == null) {
                showError(error?.parsed)
                return@call
            }
            val count = WGlobalStorage.accountIds().count {
                AccountStore.accountById(it)?.isTangem ==
                    true
            }
            WGlobalStorage.addAccount(
                accountId = result.accountId,
                accountType = MAccount.AccountType.HARDWARE.value,
                byChain = MAccount.byChainToJson(result.byChain),
                name = if (count == 0) "Tangem" else "Tangem ${count + 1}",
                importedAt = null,
                hardwareWalletManufacturer = MAccount.HardwareWalletManufacturer.TANGEM.value
            )
            AirPushNotifications.subscribe(result.accountId, ignoreIfLimitReached = true)
            WalletCore.activateAccount(result.accountId, notifySDK = true) { _, activateError ->
                if (activateError != null) {
                    showError(activateError)
                    return@activateAccount
                }
                if (previousAccountsCount == 0) {
                    push(WalletAddedVC(context, false)) {
                        navigationController?.removePrevViewControllers()
                    }
                } else {
                    WalletCore.notifyEvent(WalletEvent.AddNewWalletCompletion)
                    ToastHelper.notifyWalletImported(this, AccountStore.activeAccount)
                    window?.dismissLastNav()
                }
            }
        }
    }

    override fun onDestroy() {
        if (isImporting) TangemBridge.handler?.cancel()
        super.onDestroy()
    }
}
