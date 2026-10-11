import { beginCell, internal, SendMode } from '@ton/core';
import type { SignDataPayload } from '@tonconnect/protocol';
import { Buffer as NodeBuffer } from 'node:buffer';
import nacl from 'tweetnacl';

import type { ApiAccountWithChain, ApiTangemSignRequest, ApiTonWallet } from '../../../types';
import { ApiTangemError } from '../../../types';

import { callWindow } from '../../../../util/windowProvider/connector';
import { TANGEM_TON_DERIVATION_PATH } from '../../../common/tangem';
import { signDataWithPrivateKey, signTonProofWithPrivateKey } from '../../../dappProtocols/adapters/tonConnect/signing';
import { publicKeyToAddress } from '../wallet';
import { getSigner } from './signer';
import { TangemSigner } from './tangemSigner';

jest.mock('../../../../util/windowProvider/connector', () => ({ callWindow: jest.fn() }));
jest.mock('../auth', () => ({ fetchPrivateKey: jest.fn() }));

// Keep Buffer in the Node Uint8Array realm installed by tests/init.ts for crypto and TON cells.
global.Buffer = NodeBuffer;

const keyPair = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(7));
const publicKey = Buffer.from(keyPair.publicKey).toString('hex');
const key = { cardId: 'card-1', walletPublicKey: publicKey, derivationPath: TANGEM_TON_DERIVATION_PATH };
const transaction = {
  seqno: 5,
  timeout: 1900000000,
  sendMode: SendMode.PAY_GAS_SEPARATELY,
  messages: [internal({ to: publicKeyToAddress('mainnet', keyPair.publicKey, 'v4R2'), value: 1000000n })],
};

function createWallet(version: 'v3R2' | 'v4R2' | 'W5' = 'W5', testnet?: boolean): ApiTonWallet {
  return {
    publicKey, version, index: 0,
    address: publicKeyToAddress(testnet ? 'testnet' : 'mainnet', keyPair.publicKey, version, testnet),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(1703731900000);
  jest.mocked(callWindow).mockImplementation((...args) => {
    const request: ApiTangemSignRequest = JSON.parse(args[1] as string);
    return Promise.resolve({
      cardId: request.cardId,
      signatures: request.hashes.map((hash) => Buffer.from(
        nacl.sign.detached(Buffer.from(hash, 'base64'), keyPair.secretKey),
      ).toString('base64')),
    });
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

it.each(['v3R2', 'v4R2', 'W5'] as const)('matches existing %s transfers and batches NFC requests', async (version) => {
  const wallet = createWallet(version);
  const tangem = new TangemSigner(wallet, key);
  const mnemonicAccount: ApiAccountWithChain<'ton'> = { type: 'ton', byChain: { ton: wallet } };
  // The software signer is the reference for message layout and W5 action order.
  const { fetchPrivateKey } = await import('../auth');
  jest.mocked(fetchPrivateKey).mockResolvedValue(keyPair.secretKey);
  const transactions = [transaction, {
    ...transaction, seqno: 6, messages: [...transaction.messages, ...transaction.messages],
  }];
  const expected = await getSigner('0-mainnet', mnemonicAccount, 'token').signTransactions(transactions);
  const actual = await tangem.signTransactions(transactions);
  if ('error' in actual || 'error' in expected) throw new Error('Unexpected signing failure');
  expect(actual.map((cell) => cell.toBoc().toString('base64')))
    .toEqual(expected.map((cell) => cell.toBoc().toString('base64')));
  expect(callWindow).toHaveBeenCalledTimes(1);
  expect(JSON.parse(jest.mocked(callWindow).mock.calls[0][1] as string)).toMatchObject({
    ...key, publicKey, hashes: [expect.any(String), expect.any(String)],
  });
});

it('selects Tangem without an enclave token and accepts the testnet W5 address', async () => {
  const wallet = createWallet('W5', true);
  const signer = getSigner('0-testnet', { type: 'tangem', tangem: key, byChain: { ton: wallet } });
  expect(signer).toBeInstanceOf(TangemSigner);
  expect(await signer.signTransactions([transaction])).not.toHaveProperty('error');
});

it('matches ton_proof signatures', async () => {
  const wallet = createWallet();
  const proof = { timestamp: 1703731900, domain: 'example.com', payload: 'proof' };
  expect(await new TangemSigner(wallet, key).signTonProof(proof))
    .toEqual(Buffer.from(await signTonProofWithPrivateKey(wallet.address, keyPair.secretKey, proof)));
});

it.each<SignDataPayload>([
  { type: 'text', text: 'Hello TON' },
  { type: 'binary', bytes: Buffer.from('Hello TON').toString('base64') },
  {
    type: 'cell', schema: 'message#_ value:uint32 = Message;',
    cell: beginCell().storeUint(42, 32).endCell().toBoc().toString('base64'),
  },
])('matches signData for $type', async (payload) => {
  const wallet = createWallet();
  const expected = await signDataWithPrivateKey(wallet.address, 1703731900, 'example.com', payload, keyPair.secretKey);
  expect(await new TangemSigner(wallet, key).signData(1703731900, 'example.com', payload))
    .toEqual(Buffer.from(expected));
});

it('matches MFA install, transfer and removal signatures', async () => {
  const wallet = createWallet();
  const { fetchPrivateKey } = await import('../auth');
  jest.mocked(fetchPrivateKey).mockResolvedValue(keyPair.secretKey);
  const reference = getSigner('0-mainnet', { type: 'ton', byChain: { ton: wallet } }, 'token');
  const tangem = new TangemSigner(wallet, key);
  const init = { code: beginCell().storeUint(1, 8).endCell(), data: beginCell().endCell() };
  const install = await tangem.signInstallMfaRequest(init, 5);
  const expectedInstall = await reference.signInstallMfaRequest(init, 5);
  if ('error' in install || 'error' in expectedInstall) throw new Error('MFA install failed');
  expect(install.toBoc().toString('base64')).toBe(expectedInstall.toBoc().toString('base64'));
  const transfers = await tangem.signMfaTransactions([transaction], 3, [1000000n]);
  const expectedTransfers = await reference.signMfaTransactions([transaction], 3, [1000000n]);
  if ('error' in transfers || 'error' in expectedTransfers) throw new Error('MFA transfer failed');
  expect(transfers.map(({ payload, signature, transaction: cell }) => [
    payload.toBoc().toString('base64'), signature.toString('base64'), cell.toBoc().toString('base64'),
  ])).toEqual(expectedTransfers.map(({ payload, signature, transaction: cell }) => [
    payload.toBoc().toString('base64'), signature.toString('base64'), cell.toBoc().toString('base64'),
  ]));
  const remove = await tangem.signRemoveMfaRequest(4);
  const expectedRemove = await reference.signRemoveMfaRequest(4);
  if ('error' in remove || 'error' in expectedRemove) throw new Error('MFA removal failed');
  expect(remove.payload.toBoc().toString('base64')).toBe(expectedRemove.payload.toBoc().toString('base64'));
  expect(remove.signature).toEqual(expectedRemove.signature);
});

it.each([ApiTangemError.Cancelled, ApiTangemError.WrongCard, ApiTangemError.Failed])(
  'returns %s without producing signed messages', async (error) => {
    jest.mocked(callWindow).mockResolvedValue({ error });
    expect(await new TangemSigner(createWallet(), key).signTransactions([transaction])).toEqual({ error });
  },
);

it.each([
  { cardId: 'other-card', signatures: [] },
  { cardId: key.cardId, signatures: [] },
  { cardId: key.cardId, signatures: [Buffer.alloc(64).toString('base64')] },
])('rejects mismatched card or invalid signatures', async (response) => {
  jest.mocked(callWindow).mockResolvedValue(response);
  expect(await new TangemSigner(createWallet(), key).signTransactions([transaction])).toEqual({
    error: response.cardId !== key.cardId ? ApiTangemError.WrongCard : ApiTangemError.InvalidSignature,
  });
});

it('rejects a stored address that differs from its key and wallet version before NFC', async () => {
  const wallet = { ...createWallet('v4R2'), address: createWallet('W5').address };
  expect(await new TangemSigner(wallet, key).signTransactions([transaction]))
    .toEqual({ error: ApiTangemError.InvalidWallet });
  expect(callWindow).not.toHaveBeenCalled();
});

it('rejects a whole batch when only its second signature is invalid', async () => {
  jest.mocked(callWindow).mockImplementation((...args) => {
    const request: ApiTangemSignRequest = JSON.parse(args[1] as string);
    return Promise.resolve({
      cardId: key.cardId,
      signatures: [
        Buffer.from(nacl.sign.detached(Buffer.from(request.hashes[0], 'base64'), keyPair.secretKey)).toString('base64'),
        Buffer.alloc(64).toString('base64'),
      ],
    });
  });
  expect(await new TangemSigner(createWallet(), key).signTransactions([transaction, transaction]))
    .toEqual({ error: ApiTangemError.InvalidSignature });
});

it('rejects invalid message construction before starting NFC', async () => {
  expect(await new TangemSigner(createWallet('v4R2'), key).signTransactions([{
    ...transaction, messages: Array(5).fill(transaction.messages[0]),
  }])).toEqual({ error: ApiTangemError.InvalidWallet });
  expect(callWindow).not.toHaveBeenCalled();
});

it('rejects unsupported MFA and encrypted comments without NFC', async () => {
  const signer = new TangemSigner(createWallet('v4R2'), key);
  expect(await signer.signRemoveMfaRequest(0)).toEqual({ error: ApiTangemError.UnsupportedOperation });
  expect(signer.encryptComment()).toEqual({ error: ApiTangemError.UnsupportedOperation });
  expect(signer.decryptComment()).toEqual({ error: ApiTangemError.UnsupportedOperation });
  expect(callWindow).not.toHaveBeenCalled();
});
