package org.mytonwallet.app_air.tangem

import com.tangem.common.card.CardWallet
import com.tangem.common.card.EllipticCurve
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test

class TangemWalletSelectionTest {
    private fun wallet(curve: EllipticCurve, status: CardWallet.Status = CardWallet.Status.Loaded) =
        CardWallet(
            publicKey = ByteArray(32),
            chainCode = null,
            curve = curve,
            settings = CardWallet.Settings(isPermanent = false),
            totalSignedHashes = 0,
            remainingSignatures = null,
            index = 0,
            isImported = false,
            hasBackup = false,
            status = status
        )

    @Test
    fun selectsSlip0010KeyEvenWhenPlainEd25519IsPresent() {
        val hd = wallet(EllipticCurve.Ed25519Slip0010)
        assertSame(hd, selectTangemTonWallet(listOf(wallet(EllipticCurve.Ed25519), hd)))
    }

    @Test
    fun supportsLegacyCardWithoutHdKey() {
        val legacy = wallet(EllipticCurve.Ed25519)
        assertSame(legacy, selectTangemTonWallet(listOf(wallet(EllipticCurve.Secp256k1), legacy)))
    }

    @Test
    fun doesNotSubstituteAnotherKeyForAnUnavailableHdWallet() {
        assertNull(
            selectTangemTonWallet(
                listOf(
                    wallet(EllipticCurve.Ed25519),
                    wallet(EllipticCurve.Ed25519Slip0010, CardWallet.Status.Purged)
                )
            )
        )
    }

    @Test
    fun rejectsAmbiguousHdWallets() {
        assertNull(selectTangemTonWallet(List(2) { wallet(EllipticCurve.Ed25519Slip0010) }))
    }
}
