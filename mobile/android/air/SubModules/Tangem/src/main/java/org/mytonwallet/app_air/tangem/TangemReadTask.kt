package org.mytonwallet.app_air.tangem

import com.tangem.common.card.Card
import com.tangem.common.core.CardSessionRunnable
import com.tangem.operations.PreflightReadMode
import com.tangem.operations.ScanTask

/** Reads existing wallets, derives public keys and attests the card without requesting backup secrets. */
internal class TangemReadTask : CardSessionRunnable<Card> by ScanTask() {
    // SDK 6.3 ScanTask also requests ReadMasterSecret and VerifyBackup. Both cause
    // ReadMasterSecretCommand on firmware v8; an activated card may reject that
    // request. Import only needs card metadata and existing wallet public keys.
    override fun preflightReadMode() = PreflightReadMode.FullCardRead(
        setOf(PreflightReadMode.FullCardRead.Option.AccessCodeCheck)
    )
}
