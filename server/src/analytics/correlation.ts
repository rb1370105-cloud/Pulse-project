import { config } from "../config.js";
import { db, latestSession } from "../db.js";
import { UNIVERSE, BY_SYMBOL } from "../universe.js";
import { clamp, logReturns, pearson } from "./stats.js";

type Series = { sessions: string[]; returns: number[] };

const seriesCache = new Map<string, { session: string; s: Series }>();

function seriesFor(symbol: string, session: string): Series {
  const hit = seriesCache.get(symbol);
  if (hit && hit.session === session) return hit.s;

  const bars = db
    .prepare(`SELECT session, c FROM bars WHERE symbol = ? ORDER BY session DESC LIMIT ?`)
    .all(symbol, config.statsWindow + 1)
    .reverse() as { session: string; c: number }[];

  const s: Series = { sessions: bars.slice(1).map((b) => b.session), returns: logReturns(bars.map((b) => b.c)) };
  seriesCache.set(symbol, { session, s });
  return s;
}

const readPair = db.prepare(`SELECT rho, n FROM pair_corr WHERE a = ? AND b = ? AND session = ?`);
const writePair = db.prepare(
  `INSERT OR REPLACE INTO pair_corr (a, b, session, rho, n) VALUES (?, ?, ?, ?, ?)`,
);

/**
 * Correlation of daily log returns on the sessions both names actually traded.
 * Aligning on the intersection matters: a newly listed or suspended name would
 * otherwise be compared against a shifted series and produce a confident,
 * meaningless number.
 */
export function pairCorrelation(x: string, y: string, session = latestSession()): { rho: number; n: number } {
  const [a, b] = x < y ? [x, y] : [y, x];
  if (a === b) return { rho: 1, n: 0 };

  const cached = readPair.get(a, b, session) as { rho: number; n: number } | undefined;
  if (cached) return cached;

  const sa = seriesFor(a, session);
  const sb = seriesFor(b, session);
  const index = new Map(sa.sessions.map((d, i) => [d, i]));
  const va: number[] = [];
  const vb: number[] = [];
  for (let i = 0; i < sb.sessions.length; i++) {
    const j = index.get(sb.sessions[i]);
    if (j !== undefined) {
      va.push(sa.returns[j]);
      vb.push(sb.returns[i]);
    }
  }

  const n = va.length;
  // Below the overlap floor we report 0 with n attached rather than a number
  // the caller might mistake for a measurement.
  const rho = n >= config.minOverlap ? pearson(va, vb) : 0;
  writePair.run(a, b, session, rho, n);
  return { rho, n };
}

export type Diversification = {
  n: number;
  meanRho: number | null;
  effectiveBets: number | null;
  quality: number | null;
  reliable: boolean;
  matrix: { symbols: string[]; rows: number[][] };
  redundantPairs: { a: string; b: string; rho: number }[];
  concentration: { sector: string; weight: number }[];
  mostRedundant: { symbol: string; avgRho: number } | null;
  suggestions: { symbol: string; name: string; sector: string; avgRho: number }[];
  verdict: string;
};

export function diversification(symbols: string[]): Diversification {
  const session = latestSession();
  const syms = [...new Set(symbols)].sort();
  const n = syms.length;

  const matrixRows: number[][] = syms.map(() => new Array(n).fill(1));
  const pairs: { a: string; b: string; rho: number }[] = [];
  let sum = 0;
  let count = 0;
  let thinPairs = 0;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const { rho, n: overlap } = pairCorrelation(syms[i], syms[j], session);
      matrixRows[i][j] = matrixRows[j][i] = rho;
      pairs.push({ a: syms[i], b: syms[j], rho });
      if (overlap < config.minOverlap) thinPairs++;
      sum += rho;
      count++;
    }
  }

  const sectors = new Map<string, number>();
  for (const s of syms) {
    const sec = BY_SYMBOL.get(s)?.sector ?? "Unknown";
    sectors.set(sec, (sectors.get(sec) ?? 0) + 1 / Math.max(n, 1));
  }
  const concentration = [...sectors.entries()]
    .map(([sector, weight]) => ({ sector, weight: +weight.toFixed(3) }))
    .sort((a, b) => b.weight - a.weight);

  if (count === 0) {
    return {
      n, meanRho: null, effectiveBets: null, quality: null, reliable: false,
      matrix: { symbols: syms, rows: matrixRows }, redundantPairs: [], concentration,
      mostRedundant: null, suggestions: [],
      verdict: n === 0 ? "Nothing on the list yet." : "One name is not a portfolio — add a second to measure anything.",
    };
  }

  const meanRho = sum / count;

  /**
   * Effective bets. An equally weighted basket of n names with average
   * correlation p has the variance of n / (1 + (n-1)p) independent names. Ten
   * IT stocks at p = 0.8 are worth about 1.2 bets; the user thinks they hold ten.
   * That single number is more honest than the correlation average itself.
   */
  const floor = -1 / (n - 1) + 1e-6;
  const pClamped = clamp(meanRho, floor, 1);
  const effectiveBets = n / (1 + (n - 1) * pClamped);
  const quality = clamp((effectiveBets - 1) / (n - 1)) * 100;

  const redundantPairs = [...pairs].sort((a, b) => b.rho - a.rho).slice(0, 3);

  const avgTo = (s: string, against: string[]) => {
    const others = against.filter((o) => o !== s);
    if (!others.length) return 0;
    return others.reduce((acc, o) => acc + pairCorrelation(s, o, session).rho, 0) / others.length;
  };

  const ranked = syms.map((s) => ({ symbol: s, avgRho: avgTo(s, syms) })).sort((a, b) => b.avgRho - a.avgRho);
  const mostRedundant = ranked[0] ? { symbol: ranked[0].symbol, avgRho: +ranked[0].avgRho.toFixed(3) } : null;

  // What would actually help: the candidates least correlated to what is
  // already held, skipping sectors the list is already leaning on.
  const heavy = new Set(concentration.filter((c) => c.weight >= 0.3).map((c) => c.sector));
  const held = new Set(syms);
  const suggestions = UNIVERSE.filter((u) => !held.has(u.symbol) && !heavy.has(u.sector))
    .map((u) => ({ symbol: u.symbol, name: u.name, sector: u.sector, avgRho: +avgTo(u.symbol, syms).toFixed(3) }))
    .sort((a, b) => a.avgRho - b.avgRho)
    .slice(0, 3);

  const top = concentration[0];
  const verdict =
    quality >= 70
      ? `Spread out. ${n} names behave like ${effectiveBets.toFixed(1)} independent positions.`
      : quality >= 40
        ? `Middling. ${n} names, but only ${effectiveBets.toFixed(1)} independent bets — ${top.sector} is ${Math.round(top.weight * 100)}% of the list.`
        : `Concentrated. These ${n} names move as roughly ${effectiveBets.toFixed(1)} position${effectiveBets < 1.5 ? "" : "s"}; ${top.sector} alone is ${Math.round(top.weight * 100)}% of the list.`;

  return {
    n,
    meanRho: +meanRho.toFixed(4),
    effectiveBets: +effectiveBets.toFixed(2),
    quality: Math.round(quality),
    // Flagged rather than hidden: a thin overlap makes the number soft, and the
    // UI says so instead of quietly rendering it as fact.
    reliable: thinPairs === 0,
    matrix: { symbols: syms, rows: matrixRows.map((r) => r.map((v) => +v.toFixed(3))) },
    redundantPairs: redundantPairs.map((p) => ({ ...p, rho: +p.rho.toFixed(3) })),
    concentration,
    mostRedundant,
    suggestions,
    verdict,
  };
}
