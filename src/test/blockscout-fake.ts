export interface FakeTx {
  from: string;
  to: string | null;
  timestamp: string;
  status?: 'ok' | 'error';
  method?: string;
}

const address = (hash: string) => ({
  ens_domain_name: null, hash, implementations: [], is_contract: false, is_scam: false, is_verified: false,
  metadata: null, name: null, private_tags: [], proxy_type: null, public_tags: [], reputation: 'ok',
  watchlist_names: [],
});

/** A transaction item with every field the live Gnosis Blockscout v2 API returns (captured 2026-10-20). */
function apiTransaction(tx: FakeTx, n: number) {
  return {
    has_error_in_internal_transactions: false, block_number: 48_850_000 + n, exchange_rate: '1.0',
    transaction_types: ['contract_call'], historic_exchange_rate: null, nonce: n, timestamp: tx.timestamp,
    base_fee_per_gas: '15', token_transfers: null, fhe_operations_count: 0, decoded_input: null,
    gas_price: '140', gas_limit: '650291', fee: { type: 'actual', value: '64874320' },
    method: tx.method ?? null, authorization_list: [], to: tx.to === null ? null : address(tx.to),
    status: tx.status ?? 'ok', gas_used: '463388', from: address(tx.from), value: '0', created_contract: null,
    transaction_tag: null, max_priority_fee_per_gas: '125', position: 12, confirmations: 252,
    token_transfers_overflow: null, type: 2, transaction_burnt_fee: '6950820', confirmation_duration: [0, 5000],
    revert_reason: null, max_fee_per_gas: '140', hash: `0x${n.toString(16).padStart(64, '0')}`,
    result: tx.status === 'error' ? 'Reverted' : 'success', is_pending_update: false, raw_input: '0x',
    priority_fee: '58',
  };
}

/**
 * Serves /api/v2/addresses/:address/transactions?filter=from like the live API: the sender's
 * transactions, newest first, in pages. Refuses requests without filter=from.
 */
export class BlockscoutFake {
  readonly requests: string[] = [];
  private readonly txs: FakeTx[] = [];
  private readonly queued: number[] = [];

  constructor(private readonly pageSize = 50) {}

  add(...txs: FakeTx[]): void {
    this.txs.push(...txs);
  }

  /** The next request answers with this HTTP status instead. */
  failNext(status: number): void {
    this.queued.push(status);
  }

  readonly fetch: typeof fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    this.requests.push(url.toString());
    const status = this.queued.shift();
    if (status !== undefined) return new Response('{"message":"Too Many Requests"}', { status });
    const match = /^\/api\/v2\/addresses\/(0x[0-9a-fA-F]{40})\/transactions$/.exec(url.pathname);
    if (!match?.[1] || url.searchParams.get('filter') !== 'from') return new Response('{}', { status: 400 });
    const sender = match[1].toLowerCase();
    const mine = this.txs
      .filter((tx) => tx.from.toLowerCase() === sender)
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    const page = Number(url.searchParams.get('page') ?? 0);
    const items = mine.slice(page * this.pageSize, (page + 1) * this.pageSize).map((tx, i) => apiTransaction(tx, i));
    const more = (page + 1) * this.pageSize < mine.length;
    return Response.json({ items, next_page_params: more ? { page: page + 1, filter: 'from' } : null });
  };
}
