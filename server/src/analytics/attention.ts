import { config, freshnessOf, type FreshnessState } from "../config.js";
import { db, type SignalRow } from "../db.js";
import { clamp, decay, noisyOr, pctChange } from "./stats.js";

/**
 * How much each kind of evidence is allowed to contribute. An announcement from
 * the exchange outranks a volume blip because it changes the facts rather than
 * the tape.
 */
const CATEGORY_WEIGHT: Record<SignalRow["category"], number> = {
  event: 0.90,
  price: 0.85,
  breakout: 0.75,
  volume: 0.55,
};

export type ScoredSignal = SignalRow & { evidenceJson: Record<string, unknown>; ageHours: number };

export type InboxRow = {
  symbol: string;
  name: string;
  sector: string;
  price: number | null;
  prevClose: number | null;
  dayChangePct: number | null;
  /** Change since this user last opened the symbol — the whole point. */
  sinceSeenPct: number | null;
  lastSeenAt: number | null;
  freshness: FreshnessState | "unknown";
  asOf: number | null;
  source: string | null;
  disputed: boolean;
  disputeNote: string | null;
  attention: number;
  unreadCount: number;
  reasons: ScoredSignal[];
  categories: Partial<Record<SignalRow["category"], number>>;
};

/**
 * Score = the chance that at least one piece of unread evidence deserves this
 * person's attention, under a noisy-OR over categories. Within a category we
 * take the strongest item rather than the sum, so twelve small news blurbs
 * cannot out-shout one 4-sigma move. Everything decays with a half-life, so an
 * inbox left alone for a week goes quiet on its own instead of accumulating
 * a permanent wall of red.
 */
export function scoreSignals(signals: ScoredSignal[], now = Date.now()) {
  const byCategory = new Map<SignalRow["category"], number>();
  for (const s of signals) {
    const weighted = s.severity * decay(now - s.occurred_at, config.attentionHalfLifeHours);
    byCategory.set(s.category, Math.max(byCategory.get(s.category) ?? 0, weighted));
  }
  const terms = [...byCategory.entries()].map(([cat, v]) => clamp(CATEGORY_WEIGHT[cat] * v));
  const categories: Partial<Record<SignalRow["category"], number>> = {};
  for (const [cat, v] of byCategory) categories[cat] = +(CATEGORY_WEIGHT[cat] * v).toFixed(3);
  return { attention: Math.round(noisyOr(terms) * 100), categories };
}

const unreadStmt = db.prepare(`
  SELECT s.* FROM signals s
   WHERE s.symbol = ? AND s.occurred_at > ?
   ORDER BY s.occurred_at DESC LIMIT 40
`);

export function buildInbox(userId: string, now = Date.now()): InboxRow[] {
  const rows = db
    .prepare(
      `SELECT w.symbol, w.added_at, sy.name, sy.sector,
              q.price, q.prev_close, q.as_of, q.source, q.disputed, q.dispute_note,
              r.last_seen_at, r.seen_price
         FROM watchlist_items w
         JOIN symbols sy ON sy.symbol = w.symbol
    LEFT JOIN quotes  q  ON q.symbol  = w.symbol
    LEFT JOIN read_state r ON r.symbol = w.symbol AND r.user_id = w.user_id
        WHERE w.user_id = ?`,
    )
    .all(userId) as any[];

  const out: InboxRow[] = rows.map((r) => {
    // Never seen before? Then only the last two sessions count as "new", so a
    // freshly added symbol does not arrive with a year of backlog.
    const cursor = r.last_seen_at ?? now - 2 * 86_400_000;
    const raw = unreadStmt.all(r.symbol, cursor) as SignalRow[];
    const signals: ScoredSignal[] = raw.map((s) => ({
      ...s,
      evidenceJson: safeJson(s.evidence),
      ageHours: +((now - s.occurred_at) / 3_600_000).toFixed(1),
    }));

    const scored = scoreSignals(signals, now);
    // A stock that makes a new high four days running produces four identical
    // sentences. Keep the strongest of each kind so the reasons read as three
    // distinct facts rather than one fact repeated.
    const strongestOfKind = new Map<string, ScoredSignal>();
    for (const s of signals) {
      const rank = (x: ScoredSignal) =>
        CATEGORY_WEIGHT[x.category] * x.severity * decay(now - x.occurred_at, config.attentionHalfLifeHours);
      const prev = strongestOfKind.get(s.kind);
      if (!prev || rank(s) > rank(prev)) strongestOfKind.set(s.kind, s);
    }
    const reasons = [...strongestOfKind.values()]
      .sort(
        (a, b) =>
          CATEGORY_WEIGHT[b.category] * b.severity * decay(now - b.occurred_at, config.attentionHalfLifeHours) -
          CATEGORY_WEIGHT[a.category] * a.severity * decay(now - a.occurred_at, config.attentionHalfLifeHours),
      )
      .slice(0, 3);

    // Something unread is never scored as nothing; rounding should not make an
    // item disappear from a list sorted by attention.
    const attention = signals.length ? Math.max(1, scored.attention) : 0;
    const categories = scored.categories;

    return {
      symbol: r.symbol,
      name: r.name,
      sector: r.sector,
      price: r.price ?? null,
      prevClose: r.prev_close ?? null,
      dayChangePct: r.price && r.prev_close ? +(pctChange(r.prev_close, r.price) * 100).toFixed(2) : null,
      sinceSeenPct: r.price && r.seen_price ? +(pctChange(r.seen_price, r.price) * 100).toFixed(2) : null,
      lastSeenAt: r.last_seen_at ?? null,
      freshness: r.as_of ? freshnessOf(r.as_of, now) : "unknown",
      asOf: r.as_of ?? null,
      source: r.source ?? null,
      disputed: !!r.disputed,
      disputeNote: r.dispute_note ?? null,
      attention,
      unreadCount: signals.length,
      reasons,
      categories,
    };
  });

  return out.sort((a, b) => b.attention - a.attention || b.unreadCount - a.unreadCount || a.symbol.localeCompare(b.symbol));
}

function safeJson(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

const markStmt = db.prepare(`
  INSERT INTO read_state (user_id, symbol, last_seen_at, seen_price)
  VALUES (@user_id, @symbol, @last_seen_at, @seen_price)
  ON CONFLICT(user_id, symbol) DO UPDATE SET
    last_seen_at = MAX(last_seen_at, excluded.last_seen_at),
    seen_price   = excluded.seen_price
`);

/** Advancing the cursor is monotonic, so a stale tab replaying an old
 *  "mark read" can never un-read something the user has since caught up on. */
export const markSeen = db.transaction((userId: string, symbols: string[], at = Date.now()) => {
  for (const symbol of symbols) {
    const q = db.prepare(`SELECT price FROM quotes WHERE symbol = ?`).get(symbol) as { price: number } | undefined;
    markStmt.run({ user_id: userId, symbol, last_seen_at: at, seen_price: q?.price ?? null });
  }
});
