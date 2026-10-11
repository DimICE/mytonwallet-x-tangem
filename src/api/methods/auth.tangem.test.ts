import { Buffer as NodeBuffer } from 'node:buffer';

import { ApiTangemError } from '../types';

import { callWindow } from '../../util/windowProvider/connector';
import { getWalletVersionInfos, getWalletVersions, publicKeyToAddress } from '../chains/ton/wallet';
import { getNewAccountId, setAccountValue } from '../common/accounts';
import { TANGEM_TON_DERIVATION_PATH } from '../common/tangem';
import { importTangemAccount } from './auth';

jest.mock('../../util/windowProvider/connector', () => ({ callWindow: jest.fn() }));
jest.mock('../chains', () => ({ __esModule: true, default: {} }));
jest.mock('../chains/ton', () => ({}));
jest.mock('../chains/ton/wallet', () => ({
  ...jest.requireActual('../chains/ton/wallet'),
  getWalletVersionInfos: jest.fn(),
}));
jest.mock('../common/accounts', () => ({
  getNewAccountId: jest.fn(),
  setAccountValue: jest.fn(),
  getAccountChains: jest.fn((account) => account.byChain),
}));
jest.mock('../common/mnemonic', () => ({}));
jest.mock('../common/tokens', () => ({}));
jest.mock('../db', () => ({ tokenRepository: { clear: jest.fn() } }));
jest.mock('../environment', () => ({ getEnvironment: jest.fn().mockReturnValue({}) }));
jest.mock('../storages', () => ({ storage: { removeItem: jest.fn() } }));
jest.mock('./accounts', () => ({ activateAccount: jest.fn(), deactivateAllAccounts: jest.fn() }));
jest.mock('./dapps', () => ({}));
jest.mock('./other', () => ({}));
jest.mock('./polling', () => ({ addPollingAccount: jest.fn() }));

global.Buffer = NodeBuffer;

const info = {
  cardId: 'card-1', walletPublicKey: '11'.repeat(32), publicKey: '22'.repeat(32),
  derivationPath: TANGEM_TON_DERIVATION_PATH,
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(callWindow).mockResolvedValue(info);
  jest.mocked(getNewAccountId).mockResolvedValue('0-mainnet');
});

it('stores a distinct Tangem account with the master key, path, TON key and wallet version', async () => {
  const address = publicKeyToAddress('mainnet', Buffer.from(info.publicKey, 'hex'), 'v4R2');
  const result = await importTangemAccount('mainnet', { version: 'v4R2', expectedAddress: address });
  expect(result.byChain.ton).toEqual({ address, publicKey: info.publicKey, version: 'v4R2', index: 0 });
  expect(setAccountValue).toHaveBeenCalledWith('0-mainnet', 'accounts', {
    type: 'tangem',
    tangem: { cardId: info.cardId, walletPublicKey: info.walletPublicKey, derivationPath: info.derivationPath },
    byChain: result.byChain,
  });
});

it('rejects a different wallet version when an existing address is supplied', async () => {
  const address = publicKeyToAddress('mainnet', Buffer.from(info.publicKey, 'hex'), 'v4R2');
  await expect(importTangemAccount('mainnet', { version: 'W5', expectedAddress: address }))
    .rejects.toThrow(ApiTangemError.InvalidWallet);
  expect(setAccountValue).not.toHaveBeenCalled();
});

it.each(['v3R2', 'v4R2', 'W5'] as const)('matches an existing %s address in automatic mode', async (version) => {
  const address = publicKeyToAddress('mainnet', Buffer.from(info.publicKey, 'hex'), version);
  const result = await importTangemAccount('mainnet', { version: 'auto', expectedAddress: address });
  expect(result.byChain.ton).toMatchObject({ address, version });
  expect(getWalletVersionInfos).not.toHaveBeenCalled();
});

it.each([true, false])('matches W5 testnet subwallet ID mode %s', async (isTestnetSubwalletId) => {
  const address = publicKeyToAddress('testnet', Buffer.from(info.publicKey, 'hex'), 'W5', isTestnetSubwalletId);
  const result = await importTangemAccount('testnet', { version: 'auto', expectedAddress: address });
  expect(result.byChain.ton).toMatchObject({ address, version: 'W5' });
});

it('discovers an existing W5 wallet instead of importing an empty v4R2 wallet', async () => {
  const candidates = getWalletVersions('mainnet', Buffer.from(info.publicKey, 'hex'), ['v3R2', 'v4R2', 'W5']);
  jest.mocked(getWalletVersionInfos).mockResolvedValue(candidates.map((wallet) => ({
    ...wallet, balance: wallet.version === 'W5' ? 100n : 0n,
    isInitialized: wallet.version === 'W5', seqno: 0,
  })));
  const result = await importTangemAccount('mainnet', { version: 'auto' });
  expect(result.byChain.ton).toMatchObject({ version: 'W5', address: candidates[2].address });
});

it('discovers an initialized wallet even when its TON balance is zero', async () => {
  const candidates = getWalletVersions('mainnet', Buffer.from(info.publicKey, 'hex'), ['v3R2', 'v4R2', 'W5']);
  jest.mocked(getWalletVersionInfos).mockResolvedValue(candidates.map((wallet) => ({
    ...wallet, balance: 0n, isInitialized: wallet.version === 'v3R2', seqno: 0,
  })));
  const result = await importTangemAccount('mainnet', { version: 'auto' });
  expect(result.byChain.ton).toMatchObject({ version: 'v3R2', address: candidates[0].address });
});

it('rejects an unrelated expected address in automatic mode without storing an account', async () => {
  const address = publicKeyToAddress('mainnet', Buffer.alloc(32, 9), 'v4R2');
  await expect(importTangemAccount('mainnet', { version: 'auto', expectedAddress: address }))
    .rejects.toThrow(ApiTangemError.InvalidWallet);
  expect(setAccountValue).not.toHaveBeenCalled();
});

it('rejects a derivation path different from the requested path', async () => {
  await expect(importTangemAccount('mainnet', { version: 'v4R2', derivationPath: 'm/44\'/607\'/1\'' }))
    .rejects.toThrow(ApiTangemError.InvalidWallet);
  expect(setAccountValue).not.toHaveBeenCalled();
});

it('accepts the non-HD card key and omits derivation', async () => {
  jest.mocked(callWindow).mockResolvedValue({ ...info, publicKey: info.walletPublicKey, derivationPath: undefined });
  await importTangemAccount('mainnet', { version: 'v4R2' });
  expect(setAccountValue).toHaveBeenCalledWith('0-mainnet', 'accounts', expect.objectContaining({
    byChain: { ton: expect.objectContaining({ publicKey: info.walletPublicKey }) },
  }));
});

it.each([
  ApiTangemError.Cancelled, ApiTangemError.Unavailable, ApiTangemError.Busy,
  ApiTangemError.UnsupportedCard, ApiTangemError.InvalidWallet, ApiTangemError.Failed,
])(
  'does not create an account after %s', async (error) => {
    jest.mocked(callWindow).mockResolvedValue({ error });
    await expect(importTangemAccount('mainnet', { version: 'v4R2' })).rejects.toThrow(error);
    expect(setAccountValue).not.toHaveBeenCalled();
  },
);

it('preserves the NFC error code through the JSON serialization used by the Android bridge', async () => {
  jest.mocked(callWindow).mockResolvedValue({ error: ApiTangemError.Unavailable });
  const response = await importTangemAccount('mainnet', { version: 'v4R2' }).catch((error: unknown) => (
    JSON.parse(JSON.stringify(error)) as unknown
  ));
  expect(response).toEqual({ error: ApiTangemError.Unavailable });
  expect(setAccountValue).not.toHaveBeenCalled();
});
