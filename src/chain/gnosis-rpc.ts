import { BATCH_CREATED, POSTAGE_STAMP } from './milestones.js';

export interface Block {
  number: number;
  /** Milliseconds since the epoch. */
  timestamp: number;
}

export interface BatchCreatedLog {
  block: number;
  /** Lowercase. */
  owner: string;
}

export interface GnosisRpc {
  /** The last block mined at or before `at` (ms); the head when `at` is later. */
  blockAt(at: number): Promise<number>;
  /** How many transactions `address` had sent by the end of `block`. */
  nonce(address: string, block: number): Promise<number>;
  /** PostageStamp BatchCreated logs in blocks `from` to `to`, both included. */
  batchesCreated(from: number, to: number): Promise<BatchCreatedLog[]>;
}

export interface GnosisRpcOptions {
  url: string;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
}

export class GnosisRpcError extends Error {
  override name = 'GnosisRpcError';
}

/** Waits between requests to stay under public endpoints' rate limits. */
const REQUEST_GAP_MS = 100;
const MAX_RETRIES = 5;
/** Hosted endpoints commonly refuse eth_getLogs over more than 100,000 blocks. */
const LOG_RANGE = 50_000;

const hex = (n: number): string => `0x${n.toString(16)}`;
/** Error text from the endpoint can quote a claimant's address; the CLI never prints one. */
const redact = (text: string): string => text.replace(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g, '0x…');

export function createGnosisRpc(options: GnosisRpcOptions): GnosisRpc {
  let requests = 0;
  let head: Block | undefined;
  /** Every block fetched so far, sorted by number, to narrow later searches. */
  const known: Block[] = [];

  async function call<T>(method: string, params: unknown[]): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      if (requests > 0) await options.sleep(REQUEST_GAP_MS);
      requests += 1;
      let response: Response;
      let body: { result?: T; error?: { message?: unknown } };
      try {
        response = await options.fetch(options.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: requests, method, params }),
        });
        if (response.status === 429 && attempt < MAX_RETRIES) {
          await options.sleep(retryDelay(response));
          continue;
        }
        if (!response.ok) throw new GnosisRpcError(`Gnosis RPC answered ${response.status}; try again later`);
        body = (await response.json()) as typeof body;
      } catch (err) {
        if (err instanceof GnosisRpcError) throw err;
        throw new GnosisRpcError('could not reach the Gnosis RPC endpoint; try again later');
      }
      if (body.error) throw new GnosisRpcError(`Gnosis RPC error: ${redact(String(body.error.message))}`);
      return body.result as T;
    }
  }

  async function getBlock(tag: number | 'latest'): Promise<Block> {
    const raw = await call<{ number: string; timestamp: string } | null>('eth_getBlockByNumber', [
      tag === 'latest' ? tag : hex(tag),
      false,
    ]);
    if (raw === null) throw new GnosisRpcError(`Gnosis RPC has no block ${String(tag)}`);
    const block = { number: Number(raw.number), timestamp: Number(raw.timestamp) * 1000 };
    if (!known.some((b) => b.number === block.number)) {
      known.push(block);
      known.sort((a, b) => a.number - b.number);
    }
    return block;
  }

  return {
    async blockAt(at) {
      head ??= await getBlock('latest');
      if (at >= head.timestamp) return head.number;
      if (!known.some((b) => b.number === 0)) await getBlock(0);
      let lastSize = Infinity;
      for (;;) {
        const lo = known.findLast((b) => b.timestamp <= at);
        const hi = known.find((b) => b.timestamp > at);
        if (lo === undefined || hi === undefined) throw new GnosisRpcError('a claim is older than the chain');
        const size = hi.number - lo.number;
        if (size <= 1) return lo.number;
        // Interpolate on block times; bisect instead when the last step did not halve the range.
        const guess =
          size > lastSize / 2
            ? lo.number + Math.floor(size / 2)
            : lo.number + Math.round(((at - lo.timestamp) / (hi.timestamp - lo.timestamp)) * size);
        lastSize = size;
        await getBlock(Math.min(Math.max(guess, lo.number + 1), hi.number - 1));
      }
    },

    async nonce(address, block) {
      return Number(await call<string>('eth_getTransactionCount', [address, hex(block)]));
    },

    async batchesCreated(from, to) {
      const logs: BatchCreatedLog[] = [];
      for (let start = from; start <= to; start += LOG_RANGE) {
        const end = Math.min(start + LOG_RANGE - 1, to);
        const page = await call<{ data: string; blockNumber: string; removed?: boolean }[]>('eth_getLogs', [
          { address: POSTAGE_STAMP, topics: [BATCH_CREATED], fromBlock: hex(start), toBlock: hex(end) },
        ]);
        for (const log of page) {
          if (log.removed) continue;
          // Data words: totalAmount, normalisedBalance, owner, depth, bucketDepth, immutableFlag.
          logs.push({ block: Number(log.blockNumber), owner: `0x${log.data.slice(2 + 64 * 2 + 24, 2 + 64 * 3)}`.toLowerCase() });
        }
      }
      return logs;
    },
  };
}

function retryDelay(response: Response): number {
  const reset = Number(response.headers.get('x-ratelimit-reset'));
  return Number.isFinite(reset) && reset > 0 && reset <= 60_000 ? reset : 2_000;
}
