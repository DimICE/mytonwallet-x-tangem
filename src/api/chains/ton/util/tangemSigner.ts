import {
  Address, beginCell, type Cell, contractAddress, internal, SendMode, type StateInit, storeMessageRelaxed,
} from '@ton/core';
import { WalletContractV3R2, WalletContractV4, WalletContractV5R1 } from '@ton/ton';
import type { SignDataPayload } from '@tonconnect/protocol';
import nacl from 'tweetnacl';

import type { TonConnectProof } from '../../../dappProtocols/adapters';
import type { ApiTangemKey, ApiTonWallet } from '../../../types';
import type { PreparedTransactionToSign } from '../types';
import type { SignedMfaRemoveRequest, SignedMfaRequest, Signer } from './signer';
import { ApiTangemError } from '../../../types';

import { MFA_INSTALL_FEE } from '../../../../config';
import { callWindow } from '../../../../util/windowProvider/connector';
import { getBodyFromRequest, OpCode, prepareBodyWithoutSignature } from '../contracts/MfaExtension';
import { isTangemWalletInfo, TANGEM_TON_WALLET_VERSIONS } from '../../../common/tangem';
import { getSignDataHash, getTonProofHash } from '../../../dappProtocols/adapters/tonConnect/signing';
import { getTonWallet } from '../wallet';

type ErrorResult = { error: ApiTangemError };
type CellSigner = (payload: Cell) => Promise<Buffer>;

class SigningError extends Error {
  constructor(public readonly code: ApiTangemError) {
    super(code);
  }
}

/** Receives payloads from MyTonWallet and delegates only Ed25519 signing to the Android NFC module. */
export class TangemSigner implements Signer {
  readonly isMock = false;

  constructor(private wallet: ApiTonWallet, private key: ApiTangemKey) {}

  getSigningPublicKey(): Uint8Array | ErrorResult {
    if (!this.isWalletValid()) return { error: ApiTangemError.InvalidWallet };
    return Buffer.from(this.wallet.publicKey!, 'hex');
  }

  async signTonProof(proof: TonConnectProof) {
    return this.signHash(await getTonProofHash(this.wallet.address, proof));
  }

  async signData(timestamp: number, domain: string, payload: SignDataPayload) {
    return this.signHash(await getSignDataHash(this.wallet.address, timestamp, domain, payload));
  }

  async signTransactions(transactions: PreparedTransactionToSign[]) {
    if (!this.isWalletValid()) return { error: ApiTangemError.InvalidWallet };
    const wallet = getTonWallet(this.wallet);
    if (!(wallet instanceof WalletContractV3R2 || wallet instanceof WalletContractV4
      || wallet instanceof WalletContractV5R1)) {
      return { error: ApiTangemError.UnsupportedOperation };
    }
    if (!(wallet instanceof WalletContractV5R1)
      && transactions.some(({ authType }) => authType !== undefined && authType !== 'external')) {
      return { error: ApiTangemError.UnsupportedOperation };
    }

    return this.signCells(transactions.map((transaction) => (signer) => {
      if (wallet instanceof WalletContractV5R1) {
        // Keep the same W5 action-order workaround as the existing mnemonic signer.
        return wallet.createTransfer({ ...transaction, messages: [...transaction.messages].reverse(), signer });
      }
      if (wallet instanceof WalletContractV4) return wallet.createTransfer({ ...transaction, signer });
      return wallet.createTransfer({ ...transaction, signer });
    }));
  }

  async signInstallMfaRequest(init: StateInit, seqno: number): Promise<Cell | ErrorResult> {
    if (!this.isWalletValid()) return { error: ApiTangemError.InvalidWallet };
    const wallet = getTonWallet(this.wallet);
    if (!(wallet instanceof WalletContractV5R1)) return { error: ApiTangemError.UnsupportedOperation };
    const extensionAddress = contractAddress(0, init);
    const result = await this.signCells([(signer) => wallet.createRequest({
      authType: 'external',
      seqno,
      signer,
      actions: [
        { type: 'addExtension', address: extensionAddress },
        {
          type: 'sendMsg',
          mode: SendMode.PAY_GAS_SEPARATELY,
          outMsg: internal({
            to: extensionAddress,
            value: MFA_INSTALL_FEE,
            body: beginCell().storeUint(OpCode.INSTALL, 32).endCell(),
            init,
          }),
        },
      ],
    })]);
    return 'error' in result ? result : result[0];
  }

  async signMfaTransactions(
    transactions: PreparedTransactionToSign[],
    mfaExtensionSeqno: number,
    fees: bigint[],
  ): Promise<SignedMfaRequest[] | ErrorResult> {
    if (!this.isWalletValid()) return { error: ApiTangemError.InvalidWallet };
    const wallet = getTonWallet(this.wallet);
    if (!(wallet instanceof WalletContractV5R1)) return { error: ApiTangemError.UnsupportedOperation };
    const requests = transactions.map((transaction, index) => {
      const message = internal({
        to: wallet.address,
        value: fees[index],
        body: wallet.createRequest({
          authType: 'extension',
          seqno: transaction.seqno,
          actions: transaction.messages.map((outMsg) => ({
            type: 'sendMsg', outMsg, mode: transaction.sendMode,
          })),
        }),
      });
      return {
        payload: getBodyFromRequest(mfaExtensionSeqno + index, message),
        transaction: beginCell().store(storeMessageRelaxed(message)).endCell(),
      };
    });
    const signatures = await this.signHashes(requests.map(({ payload }) => payload.hash()));
    return 'error' in signatures ? signatures : requests.map((request, index) => ({
      ...request, signature: signatures[index],
    }));
  }

  async signRemoveMfaRequest(seqno: number): Promise<SignedMfaRemoveRequest | ErrorResult> {
    if (this.wallet.version !== 'W5') return { error: ApiTangemError.UnsupportedOperation };
    const payload = prepareBodyWithoutSignature({
      opCode: OpCode.REMOVE_EXTENSION, payload: beginCell().endCell(), seqno,
    });
    const signature = await this.signHash(payload.hash());
    return 'error' in signature ? signature : { payload, signature };
  }

  encryptComment(): ErrorResult {
    return { error: ApiTangemError.UnsupportedOperation };
  }

  decryptComment(): ErrorResult {
    return { error: ApiTangemError.UnsupportedOperation };
  }

  private isWalletValid() {
    try {
      return isTangemWalletInfo({ ...this.key, publicKey: this.wallet.publicKey! })
        && (TANGEM_TON_WALLET_VERSIONS as readonly string[]).includes(this.wallet.version!)
        && getTonWallet(this.wallet).address.equals(Address.parse(this.wallet.address));
    } catch {
      return false;
    }
  }

  /** The TON library assembles the signed cells only after the complete signature batch has been verified. */
  private async signCells(builders: ((signer: CellSigner) => Promise<Cell>)[]): Promise<Cell[] | ErrorResult> {
    const hashes: Buffer[] = [];
    let complete!: (result: Buffer[] | ErrorResult) => void;
    const signatures = new Promise<Buffer[] | ErrorResult>((resolve) => {
      complete = resolve;
    });
    let buildFailed = false;
    const cells = builders.map((build) => {
      try {
        return build((payload) => {
          const index = hashes.push(payload.hash()) - 1;
          return signatures.then((result) => {
            if ('error' in result) throw new SigningError(result.error);
            return result[index];
          });
        });
      } catch {
        buildFailed = true;
        return Promise.reject(new SigningError(ApiTangemError.InvalidWallet));
      }
    });
    const result = Promise.all(cells).catch((error: unknown): ErrorResult => ({
      error: error instanceof SigningError ? error.code : ApiTangemError.Failed,
    }));
    complete(buildFailed ? { error: ApiTangemError.InvalidWallet } : await this.signHashes(hashes));
    return result;
  }

  private async signHash(hash: Uint8Array): Promise<Buffer | ErrorResult> {
    const signatures = await this.signHashes([hash]);
    return 'error' in signatures ? signatures : signatures[0];
  }

  private async signHashes(hashes: Uint8Array[]): Promise<Buffer[] | ErrorResult> {
    if (!this.isWalletValid()) return { error: ApiTangemError.InvalidWallet };
    if (!hashes.length) return [];
    try {
      const result = await callWindow('signWithTangem', JSON.stringify({
        ...this.key,
        publicKey: this.wallet.publicKey,
        hashes: hashes.map((hash) => Buffer.from(hash).toString('base64')),
      }));
      if ('error' in result) return result;
      if (result.cardId !== this.key.cardId) return { error: ApiTangemError.WrongCard };
      if (result.signatures.length !== hashes.length) return { error: ApiTangemError.InvalidSignature };
      const publicKey = Buffer.from(this.wallet.publicKey!, 'hex');
      const signatures = result.signatures.map((signature) => Buffer.from(signature, 'base64'));
      if (signatures.some((signature, index) => signature.length !== nacl.sign.signatureLength
        || !nacl.sign.detached.verify(hashes[index], signature, publicKey))) {
        return { error: ApiTangemError.InvalidSignature };
      }
      return signatures;
    } catch {
      return { error: ApiTangemError.Failed };
    }
  }
}
