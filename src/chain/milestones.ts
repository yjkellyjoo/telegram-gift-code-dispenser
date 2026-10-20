import { inKpiWindow } from '../core/checkin.js';
import type { OutgoingTx } from './blockscout.js';

/** Swarm's PostageStamp contract on Gnosis Chain ("PostageStamp v2.1"). */
export const POSTAGE_STAMP = '0x45a1502382541Cd610CC9068e88727426b696293';

export interface Milestones {
  redeemed: boolean;
  boughtStorage: boolean;
}

/** Counts only transactions sent after the claim and within 30 days of it. */
export function milestones(txs: readonly OutgoingTx[], claimedAt: number): Milestones {
  const inWindow = txs.filter((tx) => inKpiWindow(claimedAt, tx.timestamp));
  return {
    redeemed: inWindow.length > 0,
    boughtStorage: inWindow.some((tx) => tx.ok && tx.to?.toLowerCase() === POSTAGE_STAMP.toLowerCase()),
  };
}
