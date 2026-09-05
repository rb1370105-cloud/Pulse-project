import { config } from "../config.js";
import { db } from "../db.js";
import { clamp } from "../analytics/stats.js";

/**
 * Two classifiers behind one interface.
 *
 * The lexicon model is the default because it is free, instant, offline and
 * good enough to rank a headline as broadly good or bad. The LLM is an
 * *upgrade*, not a dependency: if the key is missing, the call times out, or
 * the response does not parse, we fall back silently and record which model
 * actually produced the label. Nothing in the product breaks when the API is down.
 */

const POSITIVE = [
  ["record", 0.6], ["beats", 0.7], ["beat", 0.6], ["raised", 0.5], ["raises", 0.5],
  ["upgrade", 0.7], ["wins", 0.6], ["win", 0.5], ["approval", 0.6], ["approves", 0.5],
  ["expansion", 0.4], ["buyback", 0.6], ["dividend", 0.35], ["profit", 0.3],
  ["order book", 0.5], ["multi-year deal", 0.6], ["growth", 0.3], ["up", 0.2],
] as const;

const NEGATIVE = [
  ["miss", -0.6], ["misses", -0.65], ["downgrade", -0.7], ["cuts", -0.45],
  ["show-cause", -0.8], ["notice", -0.4], ["probe", -0.7], ["investigation", -0.7],
  ["penalty", -0.7], ["fraud", -0.9], ["resigns", -0.6], ["resignation", -0.6],
  ["default", -0.85], ["decline", -0.4], ["loss", -0.6], ["weak", -0.45],
  ["seeks clarification", -0.5], ["impact not material", -0.2], ["higher input costs", -0.4],
] as const;

const NEGATORS = ["not", "no", "denies", "denied", "rules out"];

export function lexiconSentiment(headline: string): { sentiment: number; confidence: number } {
  const text = headline.toLowerCase();
  let score = 0;
  let hits = 0;

  for (const [term, w] of [...POSITIVE, ...NEGATIVE]) {
    const at = text.indexOf(term);
    if (at === -1) continue;
    // A negator within the preceding few words flips the term.
    const before = text.slice(Math.max(0, at - 24), at);
    const flipped = NEGATORS.some((n) => before.includes(` ${n} `) || before.startsWith(`${n} `));
    score += flipped ? -w * 0.7 : w;
    hits++;
  }

  if (!hits) return { sentiment: 0, confidence: 0.2 };
  return {
    sentiment: clamp(score / Math.sqrt(hits), -1, 1),
    confidence: clamp(0.35 + hits * 0.12, 0, 0.8),
  };
}

async function llmSentiment(headlines: string[]): Promise<{ sentiment: number; confidence: number }[] | null> {
  if (!config.llm.enabled || !config.llm.apiKey) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": config.llm.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.llm.model,
        max_tokens: 1000,
        system:
          "You label Indian equity market headlines for a watchlist. For each headline return the likely direction of impact on the company's share price and how sure you are. Reply with JSON only: an array of {sentiment, confidence} where sentiment is -1..1 and confidence is 0..1. No prose, no code fences.",
        messages: [{ role: "user", content: headlines.map((h, i) => `${i + 1}. ${h}`).join("\n") }],
      }),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const text = (data.content ?? []).map((c: any) => c.text ?? "").join("").replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed) || parsed.length !== headlines.length) return null;
    return parsed.map((p: any) => ({
      sentiment: clamp(Number(p.sentiment) || 0, -1, 1),
      confidence: clamp(Number(p.confidence) || 0, 0, 1),
    }));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const pending = db.prepare(
  `SELECT id, headline FROM events WHERE classifier IN ('pending', 'none') ORDER BY published_at DESC LIMIT ?`,
);
const update = db.prepare(
  `UPDATE events SET sentiment = ?, confidence = ?, classifier = ? WHERE id = ?`,
);

/** Classifies a batch of unlabelled headlines. Safe to call on every tick. */
export async function classifyPending(batch = 40): Promise<number> {
  const rows = pending.all(batch) as { id: number; headline: string }[];
  if (!rows.length) return 0;

  const llm = await llmSentiment(rows.map((r) => r.headline));
  const apply = db.transaction(() => {
    rows.forEach((r, i) => {
      const v = llm?.[i] ?? lexiconSentiment(r.headline);
      update.run(v.sentiment, v.confidence, llm ? `llm:${config.llm.model}` : "lexicon", r.id);
    });
  });
  apply();
  return rows.length;
}
