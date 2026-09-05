import Fastify from "fastify";
import { config } from "./config.js";
import { db } from "./db.js";
import { DEFAULT_WATCHLIST } from "./universe.js";
import { generateHistory } from "./providers/synthetic.js";
import { detectSymbol } from "./analytics/detectors.js";
import { classifyPending } from "./news/classify.js";
import { routes } from "./routes.js";
import { startScheduler, tick } from "./ingest.js";

const HISTORY_DAYS = Number(process.env.HISTORY_DAYS ?? 400);

async function bootstrap() {
  const bars = db.prepare(`SELECT COUNT(*) AS n FROM bars`).get() as { n: number };
  if (bars.n === 0) {
    console.log(`seeding ${HISTORY_DAYS} sessions of history...`);
    generateHistory(HISTORY_DAYS);
    await classifyPending(400);
  }

  const items = db.prepare(`SELECT COUNT(*) AS n FROM watchlist_items WHERE user_id = 'demo'`).get() as { n: number };
  if (items.n === 0) {
    const ins = db.prepare(`INSERT OR IGNORE INTO watchlist_items (user_id, symbol, added_at) VALUES ('demo', ?, ?)`);
    const now = Date.now();
    db.transaction(() => DEFAULT_WATCHLIST.forEach((s) => ins.run(s, now)))();
    // Pretend the demo user last looked four days ago, so the inbox opens with
    // something real to say instead of an empty "all caught up".
    const seenAt = now - 4 * 86_400_000;
    const seen = db.prepare(
      `INSERT OR REPLACE INTO read_state (user_id, symbol, last_seen_at, seen_price)
       VALUES ('demo', ?, ?, (SELECT c FROM bars WHERE symbol = ? ORDER BY session DESC LIMIT 1 OFFSET 4))`,
    );
    db.transaction(() => DEFAULT_WATCHLIST.forEach((s) => seen.run(s, seenAt, s)))();
  }

  const signals = db.prepare(`SELECT COUNT(*) AS n FROM signals`).get() as { n: number };
  if (signals.n === 0) {
    console.log("backfilling signals...");
    const syms = db.prepare(`SELECT symbol FROM symbols`).all() as { symbol: string }[];
    for (const s of syms) detectSymbol(s.symbol, 40);
  }
}

const app = Fastify({ logger: false });

app.addHook("onRequest", async (req, reply) => {
  reply.header("access-control-allow-origin", "*");
  reply.header("access-control-allow-headers", `content-type, ${config.userHeader}`);
  reply.header("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
  if (req.method === "OPTIONS") reply.code(204).send();
});

app.setErrorHandler((err, _req, reply) => {
  const status = (err as any).statusCode ?? 500;
  reply.code(status).send({ error: err.message });
});

await app.register(routes);
await bootstrap();
await tick(10);

await app.listen({ port: config.port, host: "0.0.0.0" });
console.log(`pulse api on :${config.port}  providers=[${config.providers.join(", ")}]  tick=${config.tickSeconds}s`);
startScheduler();

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    app.close().then(() => {
      db.close();
      process.exit(0);
    });
  });
}
