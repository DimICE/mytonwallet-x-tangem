# Tangem TON integration

This module owns NFC sessions, reading the Ed25519 wallet key and signing hashes. JS retains TON transaction construction, signature verification, message assembly and broadcasting. No card key is exported or substituted for `privateKey`.

Import uses `TangemReadTask` through `startSessionWithRunnable`, retaining SDK scanning, public-key derivation and attestation with only `AccessCodeCheck` in its preflight options. The SDK 6.3 `scanCard()` preflight also requests `ReadMasterSecret` and `VerifyBackup`; both trigger a master-secret read on firmware v8, which is unnecessary for importing an existing wallet and may be rejected by an activated card. Signing uses `sdk.sign()`. The integration never creates, imports or purges keys on the card, changes user codes, or manages backups.

GitHub Packages credentials come from the ignored `mobile/android/local.properties`:

```properties
gpr.user=YOUR_GITHUB_USERNAME
gpr.key=YOUR_GITHUB_TOKEN
```

The importer stores `type: tangem`, the card ID, master wallet public key and derivation path separately from the TON public key and wallet version. Android stores `hardwareWalletManufacturer: tangem`; older hardware accounts default to Ledger.

The HD wallet uses `Ed25519Slip0010`, with default path `m/44'/607'/0'`, matching the tonkeeper-x-tangem reference integration. Plain `Ed25519` is used only on legacy cards without a SLIP-0010 wallet. Tangem's older derivation configurations use `m/44'/607'/0'/0/0`; non-HD cards use their card key. The import screen supports both paths, custom paths, v3R2/v4R2/W5 and an existing address to verify against. Automatic version selection checks supported addresses on-chain and selects the existing wallet with the largest TON balance, falling back to v4R2 if none has activity. When an expected address is supplied, it must match a supported version exactly (including either W5 testnet subwallet ID). Use the same path as the original Tangem wallet; automatic version selection does not search other derivation paths.

Supported signing covers TON/jetton/NFT transfers, staking and other operations routed through the TON signer, dApp transactions, `ton_proof`, and text/binary/cell `signData`. W5 MFA install, transfer and removal signatures use the same payloads as the software signer. Encrypted comments are unsupported because the existing encryption protocol requires the private key; these requests return an error.

An operation uses one NFC request for its signature batch. Both Kotlin and JS verify the signatures before JS returns signed messages. Cancellation, backgrounding, bridge disposal, a different card or an invalid signature aborts the operation. Stale callbacks cannot complete a newer session.

The access-code layout overrides the SDK's input class with `TangemAccessCodeEditText`. The prebuilt SDK references `Material.R.attr.editTextStyle`, which is absent with the app's Material dependency; the replacement uses the AppCompat attr and preserves the SDK's autofill and keyboard-learning restrictions. An Android instrumentation test inflates the complete NFC layout and checks these restrictions. Synchronous SDK startup failures discard the SDK and cancel its reader scope so a retry cannot inherit its stuck active session.

Automated coverage compares signed messages and signatures against the existing software signer, checks import address/path mismatches, error propagation without broadcasting, and NFC session cancellation. Before shipping, exercise on a physical NFC device:

| Scenario | Expected result |
| --- | --- |
| Import HD and non-HD cards with the original Tangem address | Address matches; wrong path/version is rejected |
| TON, jetton, NFT and staking transfers | Verified signatures, then submission |
| TON Connect proof, all three signData payloads, dApp transfer | NFC confirmation and valid result |
| W5 MFA install, transfer and removal | Verified card signature and normal MFA confirmation flow |
| Cancel, scan another card, background the app or close the screen | No submission; retry can start a new session |
| Encrypt or decrypt a comment | Unsupported-operation error |
