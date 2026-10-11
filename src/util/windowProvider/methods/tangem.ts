import type { ApiTangemReadResult, ApiTangemSignResult } from '../../../api/types';
import { ApiTangemError } from '../../../api/types';

/** Implemented by the Android Air bridge. Tangem NFC is unavailable in a browser. */
export function readTangemCard(optionsJson: string): Promise<ApiTangemReadResult> {
  return Promise.resolve({ error: ApiTangemError.Unavailable });
}

export function signWithTangem(requestJson: string): Promise<ApiTangemSignResult> {
  return Promise.resolve({ error: ApiTangemError.Unavailable });
}
