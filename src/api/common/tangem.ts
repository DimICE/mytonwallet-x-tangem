import type { ApiTangemWalletInfo } from '../types';

export const TANGEM_TON_DERIVATION_PATH = 'm/44\'/607\'/0\'';
export const TANGEM_TON_WALLET_VERSIONS = ['v3R2', 'v4R2', 'W5'] as const;

export function isTangemPublicKey(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
}

export function isTangemDerivationPath(value: unknown): value is string {
  if (typeof value !== 'string' || !/^m(?:\/(?:0|[1-9]\d*)'?){1,10}$/.test(value)) return false;
  return value.slice(2).split('/').every((node) => Number(node.replace('\'', '')) < 0x80000000);
}

export function isTangemWalletInfo(info: ApiTangemWalletInfo): boolean {
  return typeof info.cardId === 'string' && info.cardId.length > 0
    && isTangemPublicKey(info.walletPublicKey) && isTangemPublicKey(info.publicKey)
    && (info.derivationPath !== undefined
      ? isTangemDerivationPath(info.derivationPath)
      : info.walletPublicKey.toLowerCase() === info.publicKey.toLowerCase());
}
