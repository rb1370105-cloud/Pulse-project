import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { config, freshnessOf } from "./config.js";
import { db, recentBars } from "./db.js";
import { UNIVERSE, BY_SYMBOL } from "./universe.js";
import { buildInbox, markSeen } from "./analytics/attention.js";
import { diversification } from "./analytics/correlation.js";
import { breakers, providers } from "./providers/registry.js";
import { lastReport, tick } from "./ingest.js";
import { addClient, clientCount } from "./sse.js";
import { chaos, type ChaosMode } from "./chaos.js";

/** Demo identity. In production this is whatever the session middleware
 *  resolves to; every query below is already scoped by it. */
const userOf = (req: FastifyRequest) => String(req.headers[config.userHeader] ?? "demo");

const symbolSchema = z.string().trim().toUpperCase().min(1).max(20);

export async function routes(app: FastifyInstance) {
  app.get("/api/watchlist", (req) => {
    const user = userOf(req);
    const rows = buildInbox(user);
    const needsLook = rows.filter((r) => r.unreadCount > 0);
    return {
      user,
      generatedAt: Date.now(),
      summary: {
        total: rows.length,
        needsLook: needsLook.length,
        topAttention: rows[0]?.attention ?? 0,
        degraded: rows.filter((r) => r.disputed || r.freshness === "stale" || r.freshness === "dead").length,
        lastVisit: rows.reduce<number | null>(
          (acc, r) => (r.lastSeenAt && (acc === null || r.lastSeenAt > acc) ? r.lastSeenAt : acc),
          null,
        ),
      },
      rows,
    };
  });

  app.post("/api/watchlist", (req, reply) => {
    const body = z.object({ symbol: symbolSchema }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "symbol required" });
    if (!BY_SYMBOL.has(body.data.symbol)) return reply.code(404).send({ error: "not in the covered universe" });
    db.prepare(`INSERT OR IGNORE INTO watchlist_items (user_id, symbol, added_at) VALUES (?, ?, ?)`).run(
      userOf(req),
      body.data.symbol,
      Date.now(),
    );
    return { ok: true, symbol: body.data.symbol };
  });

  app.delete("/api/watchlist/:symbol", (req) => {
    const { symbol } = req.params as { symbol: string };
    const s = symbolSchema.parse(symbol);
    db.prepare(`DELETE FROM watchlist_items WHERE user_id = ? AND symbol = ?`).run(userOf(req), s);
    return { ok: true };
  });

  /** Advance the read cursor. This is the only write that changes what counts
   *  as "new" for a user, and it is server-side so every device agrees. */
  app.post("/api/seen", (req, reply) => {
    const body = z.object({ symbols: z.array(symbolSchema).min(1).max(500) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "symbols required" });
    markSeen(userOf(req), body.data.symbols);
    return { ok: true, marked: body.data.symbols.length };
  });

  app.get("/api/symbol/:symbol", (req, reply) => {
    const { symbol } = req.params as { symbol: string };
    const s = symbolSchema.parse(symbol);
    const meta = BY_SYMBOL.get(s);
    if (!meta) return reply.code(404).send({ error: "unknown symbol" });

    const user = userOf(req);
    const quote = db.prepare(`SELECT * FROM quotes WHERE symbol = ?`).get(s) as any;
    const read = db.prepare(`SELECT last_seen_at FROM read_state WHERE user_id = ? AND symbol = ?`).get(user, s) as any;
    const cursor = read?.last_seen_at ?? 0;

    return {
      symbol: s,
      name: meta.name,
      sector: meta.sector,
      mcapCr: meta.mcap_cr,
      quote: quote
        ? { ...quote, disputed: !!quote.disputed, freshness: freshnessOf(quote.as_of) }
        : null,
      bars: recentBars(s, 90),
      signals: (db
        .prepare(`SELECT * FROM signals WHERE symbol = ? ORDER BY occurred_at DESC LIMIT 30`)
        .all(s) as any[]).map((r) => ({
        ...r,
        evidence: JSON.parse(r.evidence),
        unread: r.occurred_at > cursor,
      })),
      events: db
        .prepare(`SELECT * FROM events WHERE symbol = ? ORDER BY published_at DESC LIMIT 15`)
        .all(s),
    };
  });

  app.get("/api/diversification", (req) => {
    const rows = db
      .prepare(`SELECT symbol FROM watchlist_items WHERE user_id = ?`)
      .all(userOf(req)) as { symbol: string }[];
    return diversification(rows.map((r) => r.symbol));
  });

  app.get("/api/universe", (req) => {
    const held = new Set(
      (db.prepare(`SELECT symbol FROM watchlist_items WHERE user_id = ?`).all(userOf(req)) as any[]).map(
        (r) => r.symbol,
      ),
    );
    return UNIVERSE.map((u) => ({
      symbol: u.symbol,
      name: u.name,
      sector: u.sector,
      mcapCr: u.mcap_cr,
      held: held.has(u.symbol),
    }));
  });

  app.get("/api/health", () => {
    const counts = db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM symbols) AS symbols,
                (SELECT COUNT(*) FROM bars)    AS bars,
                (SELECT COUNT(*) FROM signals) AS signals,
                (SELECT COUNT(*) FROM events)  AS events`,
      )
      .get();
    return {
      ok: true,
      now: Date.now(),
      chaos: chaos.mode,
      llm: config.llm.enabled ? config.llm.model : "lexicon",
      tickSeconds: config.tickSeconds,
      streamClients: clientCount(),
      counts,
      lastTick: lastReport(),
      providers: providers.map((p) => {
        const br = breakers.get(p.name)!;
        return {
          name: p.name,
          priority: p.priority,
          state: br.open ? "backing_off" : br.failures ? "recovering" : "ok",
          consecutiveFailures: br.failures,
          retryInMs: br.open ? br.openUntil - Date.now() : 0,
          lastError: br.lastError || null,
        };
      }),
      recentJobs: db.prepare(`SELECT * FROM job_runs ORDER BY id DESC LIMIT 5`).all(),
    };
  });

  app.post("/api/chaos", (req, reply) => {
    const body = z.object({ mode: z.enum(["none", "outage", "stale", "dispute"]) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "mode must be none|outage|stale|dispute" });
    chaos.mode = body.data.mode as ChaosMode;
    // Clear any open breaker so the next tick reflects the new mode immediately
    // rather than the backoff left over from the previous one.
    for (const br of breakers.values()) br.succeed();

    // Stale mode ages what we already hold. Pushing a backdated packet in
    // through ingest would be rejected by the monotonic guard — correctly, but
    // then nothing visible happens. This simulates the state instead: the last
    // good price is still on screen and is now honestly labelled as old.
    if (chaos.mode === "stale") {
      db.prepare(`UPDATE quotes SET as_of = ?`).run(Date.now() - 45 * 60_000);
    }
    return { ok: true, mode: chaos.mode };
  });

  app.post("/api/refresh", async () => tick());

  app.get("/api/stream", (req, reply) => {
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });
    reply.raw.write(`event: hello\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`);
    addClient(reply);
    const keepAlive = setInterval(() => reply.raw.write(`: ping\n\n`), 25_000);
    reply.raw.on("close", () => clearInterval(keepAlive));
  });
}
