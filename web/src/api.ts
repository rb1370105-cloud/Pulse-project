export type Signal = {
  id: number;
  symbol: string;
  category: "price" | "volume" | "breakout" | "event";
  kind: string;
  direction: "up" | "down" | "neutral";
  severity: number;
  headline: string;
  evidenceJson?: Record<string, unknown>;
  evidence?: Record<string, unknown> | string;
  occurred_at: number;
  ageHours?: number;
  unread?: boolean;
};

export type Freshness = "live" | "delayed" | "stale" | "dead" | "unknown";

export type InboxRow = {
  symbol: string;
  name: string;
  sector: string;
  price: number | null;
  prevClose: number | null;
  dayChangePct: number | null;
  sinceSeenPct: number | null;
  lastSeenAt: number | null;
  freshness: Freshness;
  asOf: number | null;
  source: string | null;
  disputed: boolean;
  disputeNote: string | null;
  attention: number;
  unreadCount: number;
  reasons: Signal[];
  categories: Partial<Record<Signal["category"], number>>;
};

export type Watchlist = {
  user: string;
  generatedAt: number;
  summary: {
    total: number;
    needsLook: number;
    topAttention: number;
    degraded: number;
    lastVisit: number | null;
  };
  rows: InboxRow[];
};

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

export type Bar = { session: string; o: number; h: number; l: number; c: number; v: number };

export type SymbolDetail = {
  symbol: string;
  name: string;
  sector: string;
  mcapCr: number;
  quote: { price: number; prev_close: number; as_of: number; source: string; disputed: boolean; freshness: Freshness } | null;
  bars: Bar[];
  signals: Signal[];
  events: { id: number; kind: string; headline: string; source: string; published_at: number; sentiment: number; classifier: string }[];
};

export type Health = {
  ok: boolean;
  now: number;
  chaos: "none" | "outage" | "stale" | "dispute";
  llm: string;
  tickSeconds: number;
  streamClients: number;
  counts: { symbols: number; bars: number; signals: number; events: number };
  lastTick: null | {
    at: number;
    symbols: number;
    applied: number;
    rejected: number;
    disputed: number;
    newSignals: number;
    durationMs: number;
    providers: { name: string; state: string; latencyMs?: number; error?: string; count: number }[];
  };
  providers: { name: string; state: string; consecutiveFailures: number; retryInMs: number; lastError: string | null }[];
};

export type UniverseEntry = { symbol: string; name: string; sector: string; mcapCr: number; held: boolean };

/** Everything a person sees is scoped to this id. Swapping it in the URL
 *  (?user=priya) is enough to prove the read cursor is per-user, not global. */
export const currentUser =
  new URLSearchParams(location.search).get("user")?.trim() || "demo";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-pulse-user": currentUser,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  watchlist: () => call<Watchlist>("/watchlist"),
  diversification: () => call<Diversification>("/diversification"),
  health: () => call<Health>("/health"),
  universe: () => call<UniverseEntry[]>("/universe"),
  symbol: (s: string) => call<SymbolDetail>(`/symbol/${encodeURIComponent(s)}`),
  add: (symbol: string) => call<{ ok: true }>("/watchlist", { method: "POST", body: JSON.stringify({ symbol }) }),
  remove: (symbol: string) => call<{ ok: true }>(`/watchlist/${encodeURIComponent(symbol)}`, { method: "DELETE" }),
  markSeen: (symbols: string[]) => call<{ ok: true }>("/seen", { method: "POST", body: JSON.stringify({ symbols }) }),
  chaos: (mode: string) => call<{ ok: true }>("/chaos", { method: "POST", body: JSON.stringify({ mode }) }),
  refresh: () => call<unknown>("/refresh", { method: "POST" }),
};

/** Push, not poll. One socket per browser; the server broadcasts once per tick. */
export function subscribe(onTick: () => void): () => void {
  const es = new EventSource("/api/stream");
  es.addEventListener("tick", onTick);
  return () => es.close();
}
