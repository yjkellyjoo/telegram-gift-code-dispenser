import { KPI_WINDOW_MS } from '../core/checkin.js';
import type { GnosisRpc } from './gnosis-rpc.js';

/** Swarm's PostageStamp contract on Gnosis Chain ("PostageStamp v2.1"). */
export const POSTAGE_STAMP = '0x45a1502382541Cd610CC9068e88727426b696293';
/** keccak256("BatchCreated(bytes32,uint256,uint256,address,uint8,uint8,bool)"). */
export const BATCH_CREATED = '0x9b088e2c89b322a3c1d81515e1c88db3d386d022926f0e2d0b9b5813b7413d58';

export interface Claim {
  address: string;
  claimedAt: number;
}

export interface Milestones {
  redeemed: boolean;
  boughtStorage: boolean;
}

/**
 * Looks only at blocks after each claim and within 30 days of it (or up to now).
 * Redeemed: the address sent any transaction. Bought storage: a postage batch was created with
 * the address as its owner, as Bee does when the key is imported into it.
 */
export async function milestones(rpc: GnosisRpc, claims: readonly Claim[], now: number): Promise<Milestones[]> {
  const windows: { start: number; end: number }[] = [];
  for (const claim of claims) {
    windows.push({
      start: await rpc.blockAt(claim.claimedAt),
      end: await rpc.blockAt(Math.min(claim.claimedAt + KPI_WINDOW_MS, now)),
    });
  }
  const from = Math.min(...windows.map((w) => w.start)) + 1;
  const to = Math.max(...windows.map((w) => w.end));
  const batches = claims.length > 0 && from <= to ? await rpc.batchesCreated(from, to) : [];

  const results: Milestones[] = [];
  for (const [i, claim] of claims.entries()) {
    const { start, end } = windows[i] as { start: number; end: number };
    const owner = claim.address.toLowerCase();
    results.push({
      redeemed: end > start && (await rpc.nonce(claim.address, end)) > (await rpc.nonce(claim.address, start)),
      boughtStorage: batches.some((b) => b.owner === owner && b.block > start && b.block <= end),
    });
  }
  return results;
}
