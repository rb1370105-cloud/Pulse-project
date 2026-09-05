import { db, insertSignal, recentBars, type Bar } from "../db.js";
import { BY_SYMBOL } from "../universe.js";
import { clamp, logReturns, median, robustZ, rsi } from "./stats.js";

type Draft = {
  category: "price" | "volume" | "breakout" | "event";
  kind: string;
  direction: "up" | "down" | "neutral";
  severity: number;
  headline: string;
  evidence: Record<string, unknown>;
};

const inr = (n: number) =>
  n >= 1000 ? n.toLocaleString("en-IN", { maximumFractionDigits: 0 }) : n.toFixed(2);

/**
 * Every detector answers the same question: is today unusual *for this name*,
 * measured against its own recent behaviour rather than a global constant. A
 * 3% day is routine for Vodafone Idea and remarkable for Nestle, so all the
 * thresholds are expressed in units of the symbol's own dispersion.
 */
function detectForSession(bars: Bar[], i: number, name: string): Draft[] {
  const out: Draft[] = [];
  const today = bars[i];
  const hist = bars.slice(Math.max(0, i - 120), i); // strictly before today
  if (hist.length < 30) return out;

  const closes = hist.map((b) => b.c);
  const rets = logReturns([...closes, today.c]);
  const r = rets[rets.length - 1];
  const past = rets.slice(0, -1);

  // 1. Price move that is large relative to the name's own noise.
  const z = robustZ(r, past);
  if (Math.abs(z) >= 2) {
    const pct = (Math.exp(r) - 1) * 100;
    out.push({
      category: "price",
      kind: "price_anomaly",
      direction: r > 0 ? "up" : "down",
      severity: 0.3 + 0.7 * clamp((Math.abs(z) - 2) / 2.5),
      headline: `${name} moved ${pct >= 0 ? "+" : ""}${pct.toFixed(2)}% — a ${Math.abs(z).toFixed(1)}-sigma day`,
      evidence: { z: +z.toFixed(2), pct: +pct.toFixed(2), close: +today.c.toFixed(2), window: past.length },
    });
  }

  // 2. Volume against its own 20-session median, not an absolute share count.
  const medVol = median(hist.slice(-20).map((b) => b.v));
  const ratio = medVol > 0 ? today.v / medVol : 0;
  if (ratio >= 2) {
    out.push({
      category: "volume",
      kind: "volume_spike",
      direction: "neutral",
      severity: 0.25 + 0.75 * clamp((ratio - 2) / 3.5),
      headline: `${name} traded ${ratio.toFixed(1)}x its usual volume`,
      evidence: { ratio: +ratio.toFixed(2), volume: today.v, medianVolume: Math.round(medVol) },
    });
  }

  // 3. New extreme over the trailing year of available history.
  const yr = bars.slice(Math.max(0, i - 252), i);
  if (yr.length >= 60) {
    const hi = Math.max(...yr.map((b) => b.h));
    const lo = Math.min(...yr.map((b) => b.l));
    if (today.c > hi) {
      out.push({
        category: "breakout",
        kind: "range_high",
        direction: "up",
        severity: clamp(0.5 + ((today.c - hi) / hi) * 12, 0.5, 1),
        headline: `${name} closed at a ${yr.length}-session high of \u20b9${inr(today.c)}`,
        evidence: { close: +today.c.toFixed(2), priorHigh: +hi.toFixed(2), lookback: yr.length },
      });
    } else if (today.c < lo) {
      out.push({
        category: "breakout",
        kind: "range_low",
        direction: "down",
        severity: clamp(0.5 + ((lo - today.c) / lo) * 12, 0.5, 1),
        headline: `${name} closed at a ${yr.length}-session low of \u20b9${inr(today.c)}`,
        evidence: { close: +today.c.toFixed(2), priorLow: +lo.toFixed(2), lookback: yr.length },
      });
    }
  }

  // 4. Momentum extreme. Only reported when it is *newly* extreme, otherwise a
  //    stock in a long trend would refile the same alert every single day.
  const rNow = rsi([...closes, today.c]);
  const rPrev = rsi(closes);
  if (rNow !== null && rPrev !== null) {
    const crossedUp = rNow >= 70 && rPrev < 70;
    const crossedDown = rNow <= 30 && rPrev > 30;
    if (crossedUp || crossedDown) {
      out.push({
        category: "breakout",
        kind: crossedUp ? "overbought" : "oversold",
        direction: crossedUp ? "up" : "down",
        severity: clamp((Math.abs(rNow - 50) - 20) / 25, 0.25, 1),
        headline: `${name} crossed into ${crossedUp ? "overbought" : "oversold"} territory (RSI ${rNow.toFixed(0)})`,
        evidence: { rsi: +rNow.toFixed(1), previous: +rPrev.toFixed(1) },
      });
    }
  }

  return out;
}

const EVENT_WEIGHT: Record<string, number> = {
  results: 0.9,
  regulatory: 0.8,
  board_meeting: 0.55,
  dividend: 0.35,
  news: 0.45,
};

/**
 * Runs all detectors for one symbol across the trailing `sessions` days.
 * Idempotent: dedupe_key is (symbol, kind, session), so replaying a tick or
 * restarting the server never double-posts to anyone's inbox.
 */
export function detectSymbol(symbol: string, sessions = 10): number {
  const bars = recentBars(symbol, 400);
  if (bars.length < 40) return 0;
  const name = BY_SYMBOL.get(symbol)?.name ?? symbol;
  let written = 0;

  const start = Math.max(30, bars.length - sessions);
  const write = db.transaction(() => {
    for (let i = start; i < bars.length; i++) {
      const session = bars[i].session;
      // Signals are stamped at the session close, which is when the
      // information became available — not when we happened to compute it.
      const occurred = Date.parse(`${session}T10:00:00Z`);
      for (const d of detectForSession(bars, i, name)) {
        const res = insertSignal.run({
          symbol,
          category: d.category,
          kind: d.kind,
          direction: d.direction,
          severity: +d.severity.toFixed(4),
          headline: d.headline,
          evidence: JSON.stringify(d.evidence),
          occurred_at: occurred,
          dedupe_key: `${symbol}|${d.kind}|${session}`,
        });
        written += res.changes;
      }
    }

    // Corporate announcements become signals once they have been classified.
    const events = db
      .prepare(
        `SELECT id, kind, headline, source, published_at, sentiment, confidence
           FROM events WHERE symbol = ? AND published_at > ? ORDER BY published_at DESC LIMIT 40`,
      )
      .all(symbol, Date.now() - sessions * 86_400_000) as any[];

    for (const e of events) {
      const base = EVENT_WEIGHT[e.kind] ?? 0.4;
      const severity = clamp(base * (0.55 + 0.45 * Math.abs(e.sentiment)) * (0.6 + 0.4 * e.confidence));
      const res = insertSignal.run({
        symbol,
        category: "event",
        kind: e.kind,
        direction: e.sentiment > 0.15 ? "up" : e.sentiment < -0.15 ? "down" : "neutral",
        severity: +severity.toFixed(4),
        headline: e.headline,
        evidence: JSON.stringify({
          source: e.source,
          sentiment: +Number(e.sentiment).toFixed(2),
          confidence: +Number(e.confidence).toFixed(2),
        }),
        occurred_at: e.published_at,
        dedupe_key: `${symbol}|event|${e.id}`,
      });
      written += res.changes;
    }
  });
  write();
  return written;
}
