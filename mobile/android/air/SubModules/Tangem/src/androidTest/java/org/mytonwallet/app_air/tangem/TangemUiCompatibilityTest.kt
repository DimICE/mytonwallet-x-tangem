package org.mytonwallet.app_air.tangem

import android.os.Build
import android.view.LayoutInflater
import android.view.View
import android.view.inputmethod.EditorInfo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.tangem.sdk.extensions.sdkThemeContext
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class TangemUiCompatibilityTest {
    @Test
    fun nfcDialogLayoutInflatesWithTheAppsMaterialDependency() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        instrumentation.runOnMainSync {
            val context = instrumentation.targetContext.sdkThemeContext()
            val view = LayoutInflater.from(context).inflate(
                com.tangem.sdk.R.layout.bottom_sheet_layout,
                null,
                false
            )
            assertNotNull(view)
            val input = view.findViewById<TangemAccessCodeEditText>(com.tangem.sdk.R.id.etPinCode)
            assertNotNull(input)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                assertEquals(View.AUTOFILL_TYPE_NONE, input.autofillType)
            }
            val info = EditorInfo()
            input.onCreateInputConnection(info)
            assertTrue(info.imeOptions and EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING != 0)
        }
    }
}
