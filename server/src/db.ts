import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("synchronous = NORMAL");

/**
 * Schema notes
 * ------------
 * Everything derived from market data (bars, quotes, events, signals) is stored
 * once per symbol and shared by every user. The only per-user rows are
 * `watchlist_items` and `read_state`. That is what keeps ingest cost O(universe)
 * instead of O(users x symbols).
 *
 * `read_state.last_seen_at` is the cursor that defines "meaningful change": a
 * signal is unread for a user if it occurred after that user last opened the
 * symbol. It lives on the server, so the cursor is identical on every device.
 */
db.exec(`
CREATE TABLE IF NOT EXISTS symbols (
  symbol      TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  exchange    TEXT NOT NULL,
  sector      TEXT NOT NULL,
  mcap_cr     REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS bars (
  symbol  TEXT NOT NULL REFERENCES symbols(symbol) ON DELETE CASCADE,
  session TEXT NOT NULL,              -- YYYY-MM-DD, exchange session date
  o REAL NOT NULL, h REAL NOT NULL, l REAL NOT NULL, c REAL NOT NULL,
  v REAL NOT NULL,
  PRIMARY KEY (symbol, session)
);
CREATE INDEX IF NOT EXISTS bars_session ON bars(session);

-- Latest reconciled quote per symbol. Never overwritten by an older as_of.
CREATE TABLE IF NOT EXISTS quotes (
  symbol      TEXT PRIMARY KEY REFERENCES symbols(symbol) ON DELETE CASCADE,
  price       REAL NOT NULL,
  prev_close  REAL NOT NULL,
  as_of       INTEGER NOT NULL,       -- exchange timestamp, ms
  received_at INTEGER NOT NULL,       -- when we ingested it, ms
  source      TEXT NOT NULL,
  disputed    INTEGER NOT NULL DEFAULT 0,
  dispute_note TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol       TEXT NOT NULL REFERENCES symbols(symbol) ON DELETE CASCADE,
  kind         TEXT NOT NULL,         -- results | board_meeting | dividend | regulatory | news
  headline     TEXT NOT NULL,
  url          TEXT,
  source       TEXT NOT NULL,         -- NSE | BSE | SEBI | RBI | ...
  published_at INTEGER NOT NULL,
  sentiment    REAL NOT NULL DEFAULT 0,   -- -1..1
  confidence   REAL NOT NULL DEFAULT 0,   -- 0..1
  classifier   TEXT NOT NULL DEFAULT 'none',
  dedupe_key   TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS events_symbol_time ON events(symbol, published_at DESC);

-- A signal is one detected, explainable change. dedupe_key makes ingest
-- idempotent: a retried or replayed tick can never double-post to an inbox.
CREATE TABLE IF NOT EXISTS signals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol      TEXT NOT NULL REFERENCES symbols(symbol) ON DELETE CASCADE,
  category    TEXT NOT NULL,          -- price | volume | breakout | event
  kind        TEXT NOT NULL,
  direction   TEXT NOT NULL,          -- up | down | neutral
  severity    REAL NOT NULL,          -- 0..1
  headline    TEXT NOT NULL,
  evidence    TEXT NOT NULL,          -- JSON, the numbers behind the claim
  occurred_at INTEGER NOT NULL,
  dedupe_key  TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS signals_symbol_time ON signals(symbol, occurred_at DESC);

CREATE TABLE IF NOT EXISTS watchlist_items (
  user_id  TEXT NOT NULL,
  symbol   TEXT NOT NULL REFERENCES symbols(symbol) ON DELETE CASCADE,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, symbol)
);

CREATE TABLE IF NOT EXISTS read_state (
  user_id      TEXT NOT NULL,
  symbol       TEXT NOT NULL REFERENCES symbols(symbol) ON DELETE CASCADE,
  last_seen_at INTEGER NOT NULL,
  seen_price   REAL,
  PRIMARY KEY (user_id, symbol)
);

-- Pair correlations are cached per session so a 50-name watchlist reuses the
-- 1,225 pairs across every user who holds any of those names.
CREATE TABLE IF NOT EXISTS pair_corr (
  a       TEXT NOT NULL,
  b       TEXT NOT NULL,            -- always a < b
  session TEXT NOT NULL,
  rho     REAL NOT NULL,
  n       INTEGER NOT NULL,
  PRIMARY KEY (a, b, session)
);

CREATE TABLE IF NOT EXISTS job_runs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  job        TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at   INTEGER,
  ok         INTEGER,
  items      INTEGER DEFAULT 0,
  error      TEXT
);
CREATE INDEX IF NOT EXISTS job_runs_job ON job_runs(job, started_at DESC);
`);

export type SymbolRow = {
  symbol: string;
  name: string;
  exchange: string;
  sector: string;
  mcap_cr: number;
};

export type Bar = { symbol: string; session: string; o: number; h: number; l: number; c: number; v: number };

export type QuoteRow = {
  symbol: string;
  price: number;
  prev_close: number;
  as_of: number;
  received_at: number;
  source: string;
  disputed: number;
  dispute_note: string | null;
};

export type SignalRow = {
  id: number;
  symbol: string;
  category: "price" | "volume" | "breakout" | "event";
  kind: string;
  direction: "up" | "down" | "neutral";
  severity: number;
  headline: string;
  evidence: string;
  occurred_at: number;
  dedupe_key: string;
};

/** Insert that silently ignores a replay of the same logical signal. */
export const insertSignal = db.prepare(`
  INSERT OR IGNORE INTO signals
    (symbol, category, kind, direction, severity, headline, evidence, occurred_at, dedupe_key)
  VALUES (@symbol, @category, @kind, @direction, @severity, @headline, @evidence, @occurred_at, @dedupe_key)
`);

export const insertEvent = db.prepare(`
  INSERT OR IGNORE INTO events
    (symbol, kind, headline, url, source, published_at, sentiment, confidence, classifier, dedupe_key)
  VALUES (@symbol, @kind, @headline, @url, @source, @published_at, @sentiment, @confidence, @classifier, @dedupe_key)
`);

export const upsertBar = db.prepare(`
  INSERT INTO bars (symbol, session, o, h, l, c, v) VALUES (@symbol, @session, @o, @h, @l, @c, @v)
  ON CONFLICT(symbol, session) DO UPDATE SET
    h = MAX(h, excluded.h), l = MIN(l, excluded.l), c = excluded.c, v = excluded.v
`);

export function recentBars(symbol: string, limit: number): Bar[] {
  return db
    .prepare(`SELECT * FROM bars WHERE symbol = ? ORDER BY session DESC LIMIT ?`)
    .all(symbol, limit)
    .reverse() as Bar[];
}

export function latestSession(): string {
  const row = db.prepare(`SELECT MAX(session) AS s FROM bars`).get() as { s: string | null };
  return row.s ?? new Date().toISOString().slice(0, 10);
}
