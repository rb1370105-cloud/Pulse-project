import { config, freshnessOf } from "./config.js";
import { db, insertSignal, recentBars } from "./db.js";
import { BY_SYMBOL } from "./universe.js";
import { collect, persistQuotes, type ProviderHealth, type Reconciled } from "./providers/registry.js";
import { detectSymbol } from "./analytics/detectors.js";
import { classifyPending } from "./news/classify.js";
import { clamp, logReturns, robustZ } from "./analytics/stats.js";
import { broadcast } from "./sse.js";

export type IngestReport = {
  at: number;
  symbols: number;
  applied: number;
  rejected: number;
  disputed: number;
  newSignals: number;
  classified: number;
  durationMs: number;
  providers: ProviderHealth[];
};

let last: IngestReport | null = null;
export const lastReport = () => last;

/**
 * We poll the union of every user's watchlist, once. Ingest cost is therefore a
 * function of how many distinct symbols anyone cares about, not of how many
 * users are online — a thousand users watching the same forty names is one
 * upstream request per tick, and each user's view is a cheap join at read time.
 */
function activeSymbols(): string[] {
  const rows = db.prepare(`SELECT DISTINCT symbol FROM watchlist_items`).all() as { symbol: string }[];
  return rows.map((r) => r.symbol);
}

/**
 * Intraday escalation. Settled daily bars drive the main detectors, but a name
 * that is falling apart right now should not have to wait for the close. The
 * dedupe key buckets on the integer sigma, so an alert re-fires when the move
 * gets materially worse and stays quiet while it merely persists.
 */
function detectIntraday(q: Reconciled): number {
  if (q.disputed) return 0; // never raise an alert off a price two sources dispute
  const fresh = freshnessOf(q.asOf);
  if (fresh !== "live" && fresh !== "delayed") return 0;

  const bars = recentBars(q.symbol, config.statsWindow);
  if (bars.length < 40) return 0;

  const rets = logReturns(bars.map((b) => b.c));
  const r = Math.log(q.price / q.prevClose);
  const z = robustZ(r, rets);
  if (Math.abs(z) < 2) return 0;

  const name = BY_SYMBOL.get(q.symbol)?.name ?? q.symbol;
  const pct = (Math.exp(r) - 1) * 100;
  const session = new Date(q.asOf).toISOString().slice(0, 10);

  return insertSignal.run({
    symbol: q.symbol,
    category: "price",
    kind: "intraday_move",
    direction: r > 0 ? "up" : "down",
    severity: 0.3 + 0.7 * clamp((Math.abs(z) - 2) / 2.5),
    headline: `${name} is ${pct >= 0 ? "up" : "down"} ${Math.abs(pct).toFixed(2)}% today — ${Math.abs(z).toFixed(1)} sigma and still trading`,
    evidence: { z: +z.toFixed(2), pct: +pct.toFixed(2), price: +q.price.toFixed(2), source: q.source },
    occurred_at: q.asOf,
    dedupe_key: `${q.symbol}|intraday|${session}|${Math.floor(Math.abs(z))}|${r > 0 ? "u" : "d"}`,
  }).changes;
}

export async function tick(sessions = 2): Promise<IngestReport> {
  const started = Date.now();
  const job = db
    .prepare(`INSERT INTO job_runs (job, started_at) VALUES ('ingest', ?)`)
    .run(started);

  const symbols = activeSymbols();
  let applied: Reconciled[] = [];
  let health: ProviderHealth[] = [];
  let newSignals = 0;
  let classified = 0;
  let error: string | null = null;

  try {
    if (symbols.length) {
      const res = await collect(symbols);
      health = res.health;
      applied = persistQuotes(res.quotes);
      for (const q of applied) newSignals += detectIntraday(q);
    }
    classified = await classifyPending();
    for (const s of symbols) newSignals += detectSymbol(s, sessions);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const report: IngestReport = {
    at: started,
    symbols: symbols.length,
    applied: applied.length,
    // Quotes we fetched but refused to write, almost always because they were
    // not newer than what we already had.
    rejected: Math.max(0, health.reduce((a, h) => a + h.count, 0) - applied.length),
    disputed: applied.filter((q) => q.disputed).length,
    newSignals,
    classified,
    durationMs: Date.now() - started,
    providers: health,
  };

  db.prepare(`UPDATE job_runs SET ended_at = ?, ok = ?, items = ?, error = ? WHERE id = ?`).run(
    Date.now(),
    error ? 0 : 1,
    applied.length,
    error,
    job.lastInsertRowid,
  );

  last = report;
  broadcast("tick", report);
  return report;
}

let timer: NodeJS.Timeout | null = null;

/** Self-scheduling loop: the next tick is set after the previous one finishes,
 *  so a slow upstream cannot cause overlapping runs to pile up. */
export function startScheduler() {
  const run = async () => {
    try {
      await tick();
    } catch {
      /* tick already records its own failure */
    }
    const jitter = 0.85 + Math.random() * 0.3;
    timer = setTimeout(run, config.tickSeconds * 1000 * jitter);
  };
  run();
  return () => timer && clearTimeout(timer);
}
