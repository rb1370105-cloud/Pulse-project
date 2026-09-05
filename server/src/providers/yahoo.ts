import type { ProviderQuote, QuoteProvider } from "./types.js";

/**
 * Live NSE quotes via Yahoo's chart endpoint. Off unless PROVIDERS includes
 * `yahoo`. It is deliberately the *only* place in the codebase that knows about
 * Yahoo's response shape: everything downstream sees a ProviderQuote.
 *
 * Yahoo does not promise stability or coverage, which is the point of running
 * it alongside a second provider — see registry.ts for how disagreements and
 * outages are handled.
 */
export class YahooProvider implements QuoteProvider {
  readonly name = "yahoo";
  readonly priority = 10;
  private readonly concurrency = 6;
  private readonly timeoutMs = 6000;

  async fetch(symbols: string[]): Promise<ProviderQuote[]> {
    const out: ProviderQuote[] = [];
    const queue = [...symbols];

    const worker = async () => {
      while (queue.length) {
        const symbol = queue.shift()!;
        const q = await this.one(symbol).catch(() => null);
        if (q) out.push(q);
      }
    };
    await Promise.all(Array.from({ length: this.concurrency }, worker));

    // A partial page is fine; the caller treats a short result as degraded, not
    // as a wipe of the symbols that did not come back.
    if (!out.length) throw new Error("yahoo returned nothing");
    return out;
  }

  private async one(symbol: string): Promise<ProviderQuote | null> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}.NS?range=1d&interval=1m`;
      const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": "pulse/1.0" } });
      if (!res.ok) throw new Error(`http ${res.status}`);
      const json: any = await res.json();
      const meta = json?.chart?.result?.[0]?.meta;
      if (!meta?.regularMarketPrice) return null;
      return {
        symbol,
        price: Number(meta.regularMarketPrice),
        prevClose: Number(meta.chartPreviousClose ?? meta.previousClose ?? meta.regularMarketPrice),
        asOf: Number(meta.regularMarketTime ?? 0) * 1000 || Date.now(),
        volume: Number(meta.regularMarketVolume ?? 0) || undefined,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
