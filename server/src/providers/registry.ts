import { config } from "../config.js";
import { chaos } from "../chaos.js";
import { db } from "../db.js";
import { SyntheticProvider } from "./synthetic.js";
import { YahooProvider } from "./yahoo.js";
import type { ProviderQuote, QuoteProvider } from "./types.js";

function build(name: string): QuoteProvider | null {
  if (name === "synthetic") return new SyntheticProvider();
  if (name === "yahoo") return new YahooProvider();
  return null;
}

export const providers: QuoteProvider[] = config.providers
  .map(build)
  .filter((p): p is QuoteProvider => p !== null)
  .sort((a, b) => a.priority - b.priority);

/**
 * One breaker per provider. A flaky upstream is expected, not exceptional: we
 * back off, keep serving the last good price with an honest freshness label,
 * and let the other provider carry the tick.
 */
class Breaker {
  failures = 0;
  openUntil = 0;
  lastError = "";

  get open() {
    return Date.now() < this.openUntil;
  }

  succeed() {
    this.failures = 0;
    this.openUntil = 0;
    this.lastError = "";
  }

  fail(err: unknown) {
    this.failures++;
    this.lastError = err instanceof Error ? err.message : String(err);
    const base = Math.min(30_000 * 2 ** (this.failures - 1), 900_000);
    this.openUntil = Date.now() + base * (0.75 + Math.random() * 0.5); // jitter
  }
}

export const breakers = new Map<string, Breaker>(providers.map((p) => [p.name, new Breaker()]));

export type Reconciled = ProviderQuote & {
  source: string;
  disputed: boolean;
  disputeNote: string | null;
};

/**
 * Ask every healthy provider, then pick one price per symbol.
 *
 * Rules, in order:
 *  1. Ignore anything stamped in the future or absurdly old.
 *  2. Prefer the highest-priority provider that answered.
 *  3. If a second provider disagrees by more than the dispute threshold, keep
 *     the winner but flag the quote. Downstream, a disputed quote is displayed
 *     and never used to raise a signal — a wrong alert costs more than a late one.
 */
export async function collect(symbols: string[]): Promise<{ quotes: Reconciled[]; health: ProviderHealth[] }> {
  const now = Date.now();
  const results = new Map<string, ProviderQuote[]>();
  const health: ProviderHealth[] = [];

  for (const p of providers) {
    const br = breakers.get(p.name)!;
    if (br.open) {
      health.push({ name: p.name, state: "backing_off", retryInMs: br.openUntil - now, error: br.lastError, count: 0 });
      continue;
    }
    const started = Date.now();
    try {
      if (chaos.mode === "outage") throw new Error("injected outage");
      const rows = await p.fetch(symbols);
      br.succeed();
      let kept = 0;
      for (const q of rows) {
        if (!Number.isFinite(q.price) || q.price <= 0) continue;
        if (q.asOf > now + 60_000) continue; // clock skew or a bad stamp
        if (now - q.asOf > 30 * 86_400_000) continue;
        if (chaos.mode === "stale") q.asOf = now - 45 * 60_000;
        let bucket = results.get(q.symbol);
        if (!bucket) results.set(q.symbol, (bucket = []));
        bucket.push({ ...q, source: p.name } as ProviderQuote);
        kept++;
      }
      health.push({ name: p.name, state: "ok", latencyMs: Date.now() - started, count: kept });
    } catch (err) {
      br.fail(err);
      health.push({ name: p.name, state: "failing", error: br.lastError, retryInMs: br.openUntil - Date.now(), count: 0 });
    }
  }

  const quotes: Reconciled[] = [];
  for (const [symbol, candidates] of results) {
    const ranked = [...candidates].sort((a, b) => {
      const pa = providers.find((p) => p.name === (a as any).source)!.priority;
      const pb = providers.find((p) => p.name === (b as any).source)!.priority;
      return pa - pb || b.asOf - a.asOf;
    });
    const win = ranked[0] as ProviderQuote & { source: string };

    let disputed = chaos.mode === "dispute";
    let note: string | null = disputed
      ? `${win.source} ${win.price.toFixed(2)} vs injected second source (${(config.disputeThreshold * 100).toFixed(1)}%+ apart)`
      : null;
    for (const other of ranked.slice(1)) {
      const gap = Math.abs(other.price - win.price) / win.price;
      if (gap > config.disputeThreshold) {
        disputed = true;
        note = `${win.source} ${win.price.toFixed(2)} vs ${(other as any).source} ${other.price.toFixed(2)} (${(gap * 100).toFixed(2)}% apart)`;
        break;
      }
    }
    quotes.push({ ...win, disputed, disputeNote: note });
  }
  return { quotes, health };
}

export type ProviderHealth = {
  name: string;
  state: "ok" | "failing" | "backing_off";
  latencyMs?: number;
  retryInMs?: number;
  error?: string;
  count: number;
};

const readQuote = db.prepare(`SELECT as_of FROM quotes WHERE symbol = ?`);
const writeQuote = db.prepare(`
  INSERT INTO quotes (symbol, price, prev_close, as_of, received_at, source, disputed, dispute_note)
  VALUES (@symbol, @price, @prev_close, @as_of, @received_at, @source, @disputed, @dispute_note)
  ON CONFLICT(symbol) DO UPDATE SET
    price = excluded.price, prev_close = excluded.prev_close, as_of = excluded.as_of,
    received_at = excluded.received_at, source = excluded.source,
    disputed = excluded.disputed, dispute_note = excluded.dispute_note
`);

/** Writes only forward in exchange time, so a late or replayed packet cannot
 *  rewind a symbol. Returns the quotes that were actually applied. */
export const persistQuotes = db.transaction((quotes: Reconciled[]): Reconciled[] => {
  const applied: Reconciled[] = [];
  const now = Date.now();
  for (const q of quotes) {
    const existing = readQuote.get(q.symbol) as { as_of: number } | undefined;
    if (existing && existing.as_of >= q.asOf) continue;
    writeQuote.run({
      symbol: q.symbol,
      price: q.price,
      prev_close: q.prevClose,
      as_of: q.asOf,
      received_at: now,
      source: q.source,
      disputed: q.disputed ? 1 : 0,
      dispute_note: q.disputeNote,
    });
    applied.push(q);
  }
  return applied;
});
