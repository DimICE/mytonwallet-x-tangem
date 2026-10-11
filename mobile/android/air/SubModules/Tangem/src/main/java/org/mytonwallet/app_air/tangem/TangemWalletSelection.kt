package org.mytonwallet.app_air.tangem

import com.tangem.common.card.CardWallet
import com.tangem.common.card.EllipticCurve

internal fun selectTangemTonWallet(wallets: List<CardWallet>): CardWallet? {
    // HD TON keys use SLIP-0010, as in the reference Tangem integration.
    // Plain Ed25519 is only a fallback for older cards without an HD wallet.
    val hdWallets = wallets.filter { it.curve == EllipticCurve.Ed25519Slip0010 }
    val candidates = hdWallets.ifEmpty { wallets.filter { it.curve == EllipticCurve.Ed25519 } }
    return candidates.singleOrNull()?.takeIf { it.status.isAvailable && it.publicKey?.size == 32 }
}
