import type { ApiTangemError } from './errors';
import type { ApiTangemKey } from './storage';

export type ApiTangemWalletVersion = 'v3R2' | 'v4R2' | 'W5';

export type ApiTangemImportOptions = {
  version: ApiTangemWalletVersion | 'auto';
  /** Omit to use Tangem's TON path on HD cards; null selects the non-derived card key explicitly. */
  derivationPath?: string | null;
  /** If provided, an import must reproduce this address exactly. */
  expectedAddress?: string;
};

export type ApiTangemWalletInfo = ApiTangemKey & {
  /** Ed25519 public key at derivationPath, or walletPublicKey for a non-HD card. */
  publicKey: string;
};

export type ApiTangemSignRequest = ApiTangemKey & {
  publicKey: string;
  /** Base64-encoded, 32-byte payload hashes in signing order. */
  hashes: string[];
};

export type ApiTangemErrorResult = { error: ApiTangemError };
export type ApiTangemReadResult = ApiTangemWalletInfo | ApiTangemErrorResult;
export type ApiTangemSignResult = { cardId: string; signatures: string[] } | ApiTangemErrorResult;
