import { db, upsertBar, insertEvent } from "../db.js";
import { UNIVERSE, BY_SYMBOL, SECTORS, type Spec } from "../universe.js";
import type { ProviderQuote, QuoteProvider } from "./types.js";

/** Small, fast, seedable PRNG. Same seed always gives the same market. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rnd: () => number): number {
  const u = Math.max(rnd(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Weekday sessions ending today, most recent last. */
export function sessionDates(count: number, end = new Date()): string[] {
  const out: string[] = [];
  const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (out.length < count) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out.reverse();
}

const HEADLINES: Record<string, string[]> = {
  results: [
    "{name} reports Q{q} revenue up {pct}% YoY; margin at {m}%",
    "{name} Q{q} profit misses street estimates on higher input costs",
    "{name} posts record Q{q} order book, guidance raised",
  ],
  board_meeting: [
    "{name} board to meet on {date} to consider fund raising",
    "{name} schedules board meeting to consider buyback proposal",
  ],
  dividend: ["{name} declares interim dividend of Rs {d} per share"],
  regulatory: [
    "SEBI seeks clarification from {name} on related-party disclosures",
    "{name} receives show-cause notice; company says impact not material",
    "RBI approves reappointment of {name} managing director for three years",
  ],
  news: [
    "{name} wins multi-year deal from European client",
    "Brokerage downgrades {name} to hold, cuts target price",
    "{name} announces capacity expansion at its {sector} facility",
  ],
};

const SOURCES: Record<string, string> = {
  results: "NSE",
  board_meeting: "BSE",
  dividend: "BSE",
  regulatory: "SEBI",
  news: "NSE",
};

/**
 * Builds `days` of daily bars for the whole universe from a two-factor model:
 * one market factor, one sector factor, plus name-specific noise. Also plants
 * corporate announcements. Deterministic for a given seed, so the demo is
 * reproducible and the correlation panel is not measuring pure noise.
 */
export function generateHistory(days: number, seed = 20260101): void {
  const dates = sessionDates(days);
  const rnd = mulberry32(seed);
  const prices = new Map<string, number>();

  // Walk backwards from today's listed price so the series ends near it.
  for (const s of UNIVERSE) prices.set(s.symbol, s.price * (0.72 + rnd() * 0.2));

  const insertSym = db.prepare(
    `INSERT OR REPLACE INTO symbols (symbol, name, exchange, sector, mcap_cr) VALUES (?, ?, ?, 'NSE', ?)`,
  );
  const writeAll = db.transaction(() => {
    for (const s of UNIVERSE) insertSym.run(s.symbol, s.name, s.sector, s.mcap_cr);

    for (let d = 0; d < dates.length; d++) {
      const session = dates[d];
      const marketF = gauss(rnd) * 0.0085;
      const sectorF = new Map(SECTORS.map((sec) => [sec, gauss(rnd) * 0.010]));

      // Roughly one macro shock a quarter, felt by everything at once.
      const shock = rnd() < 0.016 ? (rnd() < 0.5 ? -1 : 1) * (0.02 + rnd() * 0.025) : 0;

      for (const s of UNIVERSE) {
        const prev = prices.get(s.symbol)!;
        const idioShock = rnd() < 0.012 ? (rnd() < 0.5 ? -1 : 1) * (0.045 + rnd() * 0.06) : 0;
        const r =
          0.00028 +
          s.beta * (marketF + shock) +
          s.gamma * (sectorF.get(s.sector) ?? 0) * 0.55 +
          s.idio * gauss(rnd) +
          idioShock;

        const c = Math.max(prev * Math.exp(r), 0.5);
        const o = prev * (1 + gauss(rnd) * 0.002);
        const h = Math.max(o, c) * (1 + Math.abs(gauss(rnd)) * 0.004);
        const l = Math.min(o, c) * (1 - Math.abs(gauss(rnd)) * 0.004);

        const baseVol = 250_000 + (s.mcap_cr / 1000) * 900;
        const volMult = Math.exp(gauss(rnd) * 0.28) * (1 + Math.abs(r) * 22);
        upsertBar.run({ symbol: s.symbol, session, o, h, l, c, v: Math.round(baseVol * volMult) });
        prices.set(s.symbol, c);

        // An announcement on the day, occasionally.
        if (rnd() < 0.006 || (idioShock !== 0 && rnd() < 0.5)) {
          plantEvent(s, session, rnd);
        }
      }
    }
  });
  writeAll();
}

function plantEvent(s: Spec, session: string, rnd: () => number) {
  const kinds = Object.keys(HEADLINES);
  const kind = kinds[Math.floor(rnd() * kinds.length)];
  const tpl = HEADLINES[kind][Math.floor(rnd() * HEADLINES[kind].length)];
  const headline = tpl
    .replace("{name}", s.name)
    .replace("{sector}", s.sector)
    .replace("{q}", String(1 + Math.floor(rnd() * 4)))
    .replace("{pct}", (4 + rnd() * 18).toFixed(1))
    .replace("{m}", (11 + rnd() * 14).toFixed(1))
    .replace("{d}", (2 + Math.floor(rnd() * 30)).toString())
    .replace("{date}", session);

  // Announcements land after the close, which is when they actually move things.
  const published = Date.parse(`${session}T10:30:00Z`) + Math.floor(rnd() * 6 * 3_600_000);
  insertEvent.run({
    symbol: s.symbol,
    kind,
    headline,
    url: null,
    source: SOURCES[kind],
    published_at: published,
    sentiment: 0,
    confidence: 0,
    classifier: "pending",
    dedupe_key: `${s.symbol}|${kind}|${session}|${hash(headline) % 9973}`,
  });
}

/**
 * Live quotes. Each tick continues today's bar with a bounded random walk that
 * is a pure function of (symbol, minute, seed), so a restart mid-session does
 * not teleport prices and two server instances agree.
 */
export class SyntheticProvider implements QuoteProvider {
  readonly name = "synthetic";
  readonly priority = 50;

  async fetch(symbols: string[]): Promise<ProviderQuote[]> {
    const now = Date.now();
    const minute = Math.floor(now / 60_000);
    const rows = db
      .prepare(
        `SELECT b.symbol, b.c, b.v, b.session,
                (SELECT c FROM bars p WHERE p.symbol = b.symbol AND p.session < b.session
                  ORDER BY p.session DESC LIMIT 1) AS prev_c
           FROM bars b
           WHERE b.session = (SELECT MAX(session) FROM bars WHERE symbol = b.symbol)
             AND b.symbol IN (${symbols.map(() => "?").join(",")})`,
      )
      .all(...symbols) as { symbol: string; c: number; prev_c: number | null; v: number }[];

    return rows.map((r) => {
      const spec = BY_SYMBOL.get(r.symbol);
      const rnd = mulberry32(hash(r.symbol) ^ minute);
      const drift = gauss(rnd) * (spec?.idio ?? 0.01) * 0.35;
      return {
        symbol: r.symbol,
        price: Math.max(r.c * Math.exp(drift), 0.5),
        prevClose: r.prev_c ?? r.c,
        // Deliberately lagged: a real feed is never stamped "now".
        asOf: now - 15_000,
        volume: r.v,
      };
    });
  }
}
