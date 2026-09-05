import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

const num = (v: string | undefined, d: number) => (v === undefined ? d : Number(v));
const bool = (v: string | undefined, d: boolean) => (v === undefined ? d : v === "true" || v === "1");

export const config = {
  port: num(process.env.PORT, 8787),
  dbPath: process.env.DB_PATH ?? path.join(here, "..", "data", "pulse.db"),

  /** Which quote providers to run, highest priority first. */
  providers: (process.env.PROVIDERS ?? "synthetic").split(",").map((s) => s.trim()).filter(Boolean),

  /** Seconds between ingest ticks. */
  tickSeconds: num(process.env.TICK_SECONDS, 20),

  /** Freshness ladder, in seconds since the exchange timestamp on a quote. */
  freshness: {
    live: num(process.env.FRESH_LIVE_S, 90),
    delayed: num(process.env.FRESH_DELAYED_S, 900),
    stale: num(process.env.FRESH_STALE_S, 86_400),
  },

  /**
   * If two providers disagree on price by more than this fraction, the quote is
   * marked disputed and we refuse to derive signals from it.
   */
  disputeThreshold: num(process.env.DISPUTE_THRESHOLD, 0.015),

  /** Half-life (hours) for attention decay on an unread signal. */
  attentionHalfLifeHours: num(process.env.ATTENTION_HALFLIFE_H, 48),

  /** Trailing daily bars used for return statistics and correlation. */
  statsWindow: num(process.env.STATS_WINDOW, 120),
  minOverlap: num(process.env.MIN_OVERLAP, 60),

  /** Optional LLM headline classifier. Falls back to a lexicon model when off. */
  llm: {
    enabled: bool(process.env.LLM_ENABLED, false),
    apiKey: process.env.ANTHROPIC_API_KEY ?? "",
    model: process.env.LLM_MODEL ?? "claude-sonnet-4-6",
  },

  /** Demo auth: the user id is read from this header, defaulting to `demo`. */
  userHeader: "x-pulse-user",
} as const;

export type FreshnessState = "live" | "delayed" | "stale" | "dead";

export function freshnessOf(asOfMs: number, now = Date.now()): FreshnessState {
  const age = (now - asOfMs) / 1000;
  if (age <= config.freshness.live) return "live";
  if (age <= config.freshness.delayed) return "delayed";
  if (age <= config.freshness.stale) return "stale";
  return "dead";
}
