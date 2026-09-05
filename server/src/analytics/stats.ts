export const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

/**
 * Median absolute deviation, scaled to be a consistent estimator of sigma for
 * normal data. We use this rather than the sample stdev because a single 8%
 * gap inflates the stdev enough to hide itself — the anomaly ends up
 * suppressing its own z-score. MAD does not move for one outlier.
 */
export function madSigma(xs: number[]): number {
  const m = median(xs);
  return 1.4826 * median(xs.map((x) => Math.abs(x - m)));
}

/** Modified z-score against a robust centre and scale. */
export function robustZ(x: number, history: number[]): number {
  const sigma = madSigma(history);
  if (sigma < 1e-9) return 0;
  return (x - median(history)) / sigma;
}

export function logReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0 && closes[i] > 0) out.push(Math.log(closes[i] / closes[i - 1]));
  }
  return out;
}

/** Wilder's RSI. Returns null when there is not enough history. */
export function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (loss < 1e-12) return 100;
  return 100 - 100 / (1 + gain / loss);
}

export function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = mean(a.slice(0, n));
  const mb = mean(b.slice(0, n));
  let num = 0;
  let da = 0;
  let dbv = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    dbv += y * y;
  }
  const den = Math.sqrt(da * dbv);
  return den < 1e-12 ? 0 : clamp(num / den, -1, 1);
}

/**
 * Combine independent pieces of evidence without letting any one of them run
 * away with the score. Each term is treated as an independent chance that this
 * symbol deserves a look; the result is the chance that at least one fires.
 * Two 0.5 signals give 0.75, not 1.0 — and nothing can ever exceed 1.
 */
export function noisyOr(ps: number[]): number {
  return 1 - ps.reduce((acc, p) => acc * (1 - clamp(p)), 1);
}

/** Exponential decay so a three-day-old surprise stops shouting. */
export function decay(ageMs: number, halfLifeHours: number): number {
  return Math.pow(0.5, ageMs / (halfLifeHours * 3_600_000));
}

export function pctChange(from: number, to: number): number {
  return from === 0 ? 0 : (to - from) / from;
}
