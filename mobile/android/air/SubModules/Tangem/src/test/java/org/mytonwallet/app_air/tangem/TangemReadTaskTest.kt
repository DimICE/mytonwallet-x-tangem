package org.mytonwallet.app_air.tangem

import com.tangem.operations.PreflightReadMode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class TangemReadTaskTest {
    @Test
    fun importReadsWalletsWithoutRequestingMasterSecretOrBackupVerification() {
        val task = TangemReadTask()
        val mode = task.preflightReadMode()

        // Either of these options makes SDK 6.3 issue ReadMasterSecretCommand
        // on firmware v8, even when the card already contains active wallets.
        assertEquals(setOf(PreflightReadMode.FullCardRead.Option.AccessCodeCheck), mode.options)
        assertFalse(mode.options.contains(PreflightReadMode.FullCardRead.Option.ReadMasterSecret))
        assertFalse(mode.options.contains(PreflightReadMode.FullCardRead.Option.VerifyBackup))
        assertFalse(task.shouldAskForAccessCode)
    }
}
