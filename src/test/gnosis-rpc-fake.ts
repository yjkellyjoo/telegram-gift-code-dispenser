import { POSTAGE_STAMP } from '../chain/milestones.js';

/** keccak256("BatchCreated(bytes32,uint256,uint256,address,uint8,uint8,bool)"), checked against live logs 2026-11-16. */
export const BATCH_CREATED = '0x9b088e2c89b322a3c1d81515e1c88db3d386d022926f0e2d0b9b5813b7413d58';

export interface FakeTx {
  from: string;
  timestamp: string;
  /** A createBatch call: when it succeeds, the PostageStamp contract logs BatchCreated with this owner. */
  batchOwner?: string;
  status?: 'ok' | 'error';
}

const GENESIS_MS = Date.parse('2026-11-01T00:00:00Z');
/** Like Gnosis Chain, a block every 5 s slot, but every 7th slot is missed, so block times are uneven. */
const blockTime = (n: number): number => GENESIS_MS + 5_000 * (n + Math.floor(n / 6));
/** The first block at or after `ms`. */
function blockOf(ms: number): number {
  let n = Math.max(0, Math.floor((ms - GENESIS_MS) / 6_000));
  while (blockTime(n) < ms) n += 1;
  return n;
}
/** The last block at or before `ms`. */
const lastBlockAt = (ms: number): number => (blockTime(blockOf(ms)) === ms ? blockOf(ms) : blockOf(ms) - 1);

const hex = (n: number): string => `0x${n.toString(16)}`;
const word = (value: string): string => value.replace(/^0x/, '').toLowerCase().padStart(64, '0');

/** Like hosted RPC providers, the fake refuses eth_getLogs over more blocks than this. */
export const MAX_LOG_RANGE = 100_000;

interface RpcRequest {
  jsonrpc: string;
  id: number;
  method: string;
  params: unknown[];
}

/**
 * Serves the JSON-RPC methods `stats` uses over a chain whose head follows `now`: blocks, nonces
 * and PostageStamp BatchCreated logs. Transactions after the head do not exist yet.
 */
export class GnosisRpcFake {
  readonly requests: RpcRequest[] = [];
  private readonly txs: FakeTx[] = [];
  private readonly queued: ({ status: number } | { rpcError: string })[] = [];

  constructor(private readonly now: () => number) {}

  add(...txs: FakeTx[]): void {
    this.txs.push(...txs);
  }

  /** The next request answers with this HTTP status instead. */
  failNext(status: number): void {
    this.queued.push({ status });
  }

  /** The next request answers with this JSON-RPC error instead. */
  rpcErrorNext(message: string): void {
    this.queued.push({ rpcError: message });
  }

  private get head(): number {
    return lastBlockAt(this.now());
  }

  private mined(): { tx: FakeTx; block: number; index: number }[] {
    return this.txs
      .map((tx, index) => ({ tx, block: blockOf(Date.parse(tx.timestamp)), index }))
      .filter(({ block }) => block <= this.head);
  }

  private block(tag: unknown): number {
    if (tag === 'latest') return this.head;
    if (typeof tag !== 'string' || !/^0x[0-9a-f]+$/.test(tag)) throw new Error(`bad block tag ${String(tag)}`);
    return Number(tag);
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== 'https://rpc.test/' || init?.method !== 'POST') return new Response('not found', { status: 404 });
    const request = JSON.parse(String(init.body)) as RpcRequest;
    this.requests.push(request);
    const queued = this.queued.shift();
    if (queued && 'status' in queued) return new Response('{"message":"Too Many Requests"}', { status: queued.status });
    const reply = (body: object) => Response.json({ jsonrpc: '2.0', id: request.id, ...body });
    if (queued) return reply({ error: { code: -32000, message: queued.rpcError } });
    try {
      return reply({ result: this.answer(request) });
    } catch (err) {
      return reply({ error: { code: -32602, message: (err as Error).message } });
    }
  };

  private answer({ method, params }: RpcRequest): unknown {
    if (method === 'eth_getBlockByNumber') {
      const n = this.block(params[0]);
      return n > this.head ? null : { number: hex(n), timestamp: hex(blockTime(n) / 1000) };
    }
    if (method === 'eth_getTransactionCount') {
      const [address, tag] = params as [string, string];
      const n = this.block(tag);
      if (n > this.head) throw new Error('header not found');
      // Reverted transactions use up a nonce too.
      return hex(this.mined().filter(({ tx, block }) => block <= n && tx.from.toLowerCase() === address.toLowerCase()).length);
    }
    if (method === 'eth_getLogs') {
      const [filter] = params as [{ address: string; topics: string[]; fromBlock: string; toBlock: string }];
      if (filter.address.toLowerCase() !== POSTAGE_STAMP.toLowerCase()) throw new Error('unexpected log address');
      if (filter.topics.length !== 1 || filter.topics[0] !== BATCH_CREATED) throw new Error('unexpected topics');
      const from = this.block(filter.fromBlock);
      const to = this.block(filter.toBlock);
      if (from > to || to > this.head) throw new Error('invalid block range');
      if (to - from + 1 > MAX_LOG_RANGE) throw new Error(`query exceeds max block range ${MAX_LOG_RANGE}`);
      return this.mined()
        .filter(({ tx, block }) => tx.batchOwner !== undefined && (tx.status ?? 'ok') === 'ok' && block >= from && block <= to)
        .map(({ tx, block, index }) => ({
          address: POSTAGE_STAMP.toLowerCase(),
          topics: [BATCH_CREATED, `0x${word(hex(index + 1))}`],
          // totalAmount, normalisedBalance, owner, depth, bucketDepth, immutableFlag
          data: `0x${[hex(1e15), hex(1e12), tx.batchOwner ?? '', hex(20), hex(16), hex(0)].map(word).join('')}`,
          blockNumber: hex(block),
          transactionHash: `0x${word(hex(index + 1000))}`,
          logIndex: '0x0',
          removed: false,
        }));
    }
    throw new Error(`method ${method} not supported`);
  }
}
