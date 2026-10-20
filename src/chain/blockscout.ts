export interface OutgoingTx {
  to: string | null;
  timestamp: number;
  ok: boolean;
}

export interface Blockscout {
  /** Transactions sent from `address`, newest first, back to at least `since`. */
  outgoingTransactions(address: string, since: number): Promise<OutgoingTx[]>;
}

export interface BlockscoutOptions {
  baseUrl: string;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
}

export class BlockscoutError extends Error {
  override name = 'BlockscoutError';
}

interface ApiTransaction {
  timestamp: string;
  status: string | null;
  from: { hash: string };
  to: { hash: string } | null;
}

interface ApiPage {
  items: ApiTransaction[];
  next_page_params: Record<string, string | number> | null;
}

/** Waits between requests to stay under Blockscout's rate limit. */
const REQUEST_GAP_MS = 250;
const MAX_RETRIES = 5;
const MAX_PAGES = 20;

export function createBlockscout(options: BlockscoutOptions): Blockscout {
  let requests = 0;

  async function getPage(url: URL): Promise<ApiPage> {
    for (let attempt = 0; ; attempt += 1) {
      if (requests > 0) await options.sleep(REQUEST_GAP_MS);
      requests += 1;
      const response = await options.fetch(url, { headers: { accept: 'application/json' } });
      if (response.status === 429 && attempt < MAX_RETRIES) {
        await options.sleep(retryDelay(response));
        continue;
      }
      if (!response.ok) throw new BlockscoutError(`Blockscout answered ${response.status}`);
      return (await response.json()) as ApiPage;
    }
  }

  return {
    async outgoingTransactions(address, since) {
      const found: OutgoingTx[] = [];
      let params: Record<string, string | number> | null = {};
      for (let page = 0; params !== null && page < MAX_PAGES; page += 1) {
        const url = new URL(`/api/v2/addresses/${address}/transactions`, options.baseUrl);
        for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
        url.searchParams.set('filter', 'from');
        const body = await getPage(url);
        for (const tx of body.items) {
          if (tx.from.hash.toLowerCase() !== address.toLowerCase()) continue;
          found.push({ to: tx.to?.hash ?? null, timestamp: Date.parse(tx.timestamp), ok: tx.status === 'ok' });
        }
        const oldest = body.items.at(-1);
        params = oldest !== undefined && Date.parse(oldest.timestamp) > since ? body.next_page_params : null;
      }
      return found;
    },
  };
}

function retryDelay(response: Response): number {
  const reset = Number(response.headers.get('x-ratelimit-reset'));
  return Number.isFinite(reset) && reset > 0 && reset <= 60_000 ? reset : 2_000;
}
