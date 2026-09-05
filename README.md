# Pulse

A market watchlist that behaves like an inbox.

The ordinary watchlist is a grid of prices that renders the same information
forever, so people stop reading it. Pulse only tells you **what changed since
you last looked**, ranks each name by whether it has earned your attention, and
lets you mark it read. Attention is the scarce resource, not data.

---

## Run it

Requires Node 20.11+ (developed on 22). Nothing else — no database server, no
API keys, no network.

```bash
npm install
npm run dev
```

Open **http://localhost:5173**.

The first start generates 400 sessions of market history, backfills signals and
seeds a demo watchlist; it takes about 30 seconds and prints its progress. Every
start after that is instant. The API runs on `:8787`, the UI proxies to it.

```bash
npm run build      # production bundle for the web app
npm run typecheck  # strict tsc across both packages
npm run reset      # wipe the database; it rebuilds on next start
```

To watch as a second person and prove the read cursor is per-user, open
`http://localhost:5173/?user=priya`. Same market, separate inbox.

### Optional: live prices

`server/.env`:

```
PROVIDERS=yahoo,synthetic
```

Yahoo becomes the primary source and the synthetic feed stays behind it. With
two sources running, cross-source disagreement detection becomes real rather
than simulated. See `.env.example` for every knob; all of them have defaults.

### Optional: LLM headline sentiment

```
LLM_ENABLED=true
ANTHROPIC_API_KEY=sk-ant-...
```

Off by default. A lexicon classifier runs instead and the product is fully
functional without it — see *Graceful degradation* below.

---

## Try these

1. **Open a name.** It expands in place with its full signal history; closing it
   is what marks it read, so the list never re-sorts out from under you.
2. **Break the feed.** The Feed panel has an Outage / Stale data / Sources
   disagree switch. Every failure mode is real code paths, not a mock:
   - *Outage* — circuit breakers open, backoff with jitter, last good prices
     stay on screen labelled honestly.
   - *Stale data* — the freshness badge flips and the header counts untrustworthy
     prices.
   - *Sources disagree* — quotes are flagged and **signal generation stops** for
     those symbols. A wrong alert costs more than a late one.
3. **Add an uncorrelated name.** The Diversification panel suggests the three
   candidates least correlated to what you already hold. Watch the effective-bets
   number move.

---

## The decisions

### What counts as a meaningful change

Not "the price moved". A 3% day is routine for Vodafone Idea and remarkable for
Nestlé, so every threshold is expressed in units of the symbol's *own*
dispersion:

| Detector | Fires when | Notes |
|---|---|---|
| Price anomaly | robust \|z\| ≥ 2 on daily log returns | median/MAD, not mean/stdev |
| Volume spike | ≥ 2× its own 20-session median | ratio, never an absolute share count |
| Range break | close beyond the trailing 252-session extreme | |
| Momentum | RSI **crosses** 70 / 30 | crossing only, so a long trend doesn't refile daily |
| Corporate event | exchange/regulator announcement | weighted by kind and sentiment |
| Intraday escalation | robust \|z\| ≥ 2 against prev close, still trading | re-fires only on the next integer sigma |

The z-scores use a **median/MAD** scale, not the sample standard deviation. With
stdev, a single 8% gap inflates σ enough to hide itself — the anomaly suppresses
its own score. MAD does not move for one outlier.

### What gets surfaced, and in what order

Each name gets an **attention score**: the probability that at least one piece
of unread evidence deserves a look, combined as a noisy-OR across four
categories (event 0.90, price 0.85, breakout 0.75, volume 0.55).

```
attention = 1 - Π (1 - wᶜ · maxᶜ(severity · decay))
```

Three properties that matter:

- **Within a category we take the max, not the sum.** Twelve small news blurbs
  cannot out-shout one 4-sigma move.
- **Noisy-OR saturates.** Independent evidence accumulates, nothing exceeds 100,
  and two 0.5 signals give 0.75 rather than 1.0.
- **Everything decays** on a 48-hour half-life. An inbox left alone for a week
  goes quiet by itself instead of accreting a permanent wall of red.

Rows carry the sentence that earned the score, not a number to decode:
*"HCL Technologies moved −2.39% — a 2.2-sigma day."* Repeated kinds are
collapsed, so a stock making a new high four days running produces one line and
not four identical ones.

### How state persists across sessions and devices

`read_state(user_id, symbol, last_seen_at, seen_price)` — a per-user, per-symbol
cursor held on the server. A signal is unread if it occurred after that cursor.
Because the cursor is server-side, phone and laptop agree; because it is per
symbol, catching up on one name does not silently mark the rest read. Advancing
it is monotonic (`MAX(existing, incoming)`), so a stale tab replaying an old
"mark read" cannot un-read something.

`seen_price` is what makes the headline number **"−4.14% since you looked"**
rather than the day change everyone already has.

A newly added symbol backfills only two sessions, so it does not arrive with a
year of backlog.

### Stale, delayed and conflicting data

- **Freshness is a ladder, not a boolean**: live → delayed → stale → dead, keyed
  on the exchange timestamp, never on when we happened to fetch. The UI states
  which rung it is on. A stale price is shown and labelled; it is never silently
  rendered as current.
- **Writes are monotonic in exchange time.** A late, retried or out-of-order
  packet can never rewind a symbol.
- **Conflicts are first-class.** With multiple providers, a >1.5% disagreement
  keeps the higher-priority price but marks the quote `disputed`, shows both
  numbers, and **suppresses signal generation** from it.
- **Sanity gates.** Quotes stamped in the future, absurdly old, or non-positive
  are dropped at the boundary.
- **Failure is expected.** Per-provider circuit breakers with exponential backoff
  and jitter. A partial page is degraded, not a wipe: symbols that did not come
  back keep their last good value.
- **Signal writes are idempotent** via a `dedupe_key` unique index, so replays,
  retries and restarts cannot double-post to anyone's inbox.
- **A failed refresh never blanks the screen.** The last good render stays and an
  error band explains what happened.

### Diversification

Your notes asked for mean pairwise correlation. That is computed, but it is not
what gets shown first, because ρ̄ = 0.36 means nothing to a person. This does:

```
effective bets  =  n / (1 + (n − 1) · ρ̄)
```

An equally weighted basket of *n* names with average correlation ρ̄ has the
variance of that many independent positions. The seeded demo list of ten names
scores **2.3 independent bets** — the user thinks they hold ten.

Alongside it: the closest pair, the name that adds the least (highest average
correlation to the rest), sector concentration, and the three names in the
universe *least* correlated to current holdings, one click to add.

Correlations are computed on the sessions both names actually traded. Aligning
on the intersection matters — a newly listed or suspended name would otherwise
be compared against a shifted series and produce a confident, meaningless
number. Below 60 overlapping sessions the result is flagged as soft rather than
rendered as fact.

### Graceful degradation

The LLM classifier is an **upgrade, not a dependency**. Default is a lexicon
model with negation handling: free, instant, offline. If the key is absent, the
call times out, or the response does not parse, it falls back silently and the
row records which model actually produced the label. Nothing breaks when the API
is down. Same shape for quotes: the synthetic provider is always available
behind whatever live source you configure.

### Scale

The thing that would kill a naive build is fanning ingestion out per user.

- Ingest polls the **union** of all watchlists, once per tick. A thousand users
  watching the same forty names is one upstream cycle, not a thousand.
- Bars, quotes, events and signals are computed **once per symbol** and shared.
  Only `read_state` and `watchlist_items` are per-user, so a user's view is a
  cheap indexed join at read time.
- Pair correlations are cached per session in `pair_corr`, keyed on the sorted
  pair. A fifty-name watchlist is 1,225 pairs computed once and reused across
  every user holding any of those names.
- The browser gets **SSE push**, one broadcast per tick, instead of every tab
  running its own poll.
- The scheduler is self-rescheduling, so a slow upstream cannot pile overlapping
  runs on top of each other.

### Where it stays simple

- **SQLite, not Mongo/Postgres.** The core read is a relational join and the
  submission has to actually run on your machine. `npm install && npm run dev`
  with zero services to install is worth more here than the flexibility.
- **No ORM, no state library, no CSS framework.** Prepared statements, React
  state, one stylesheet.
- **No auth.** Identity is a header with a demo default. Every query is already
  scoped by `user_id`, so real sessions are a middleware swap and nothing else.
- **TypeScript via `tsx`**, so there is no build step to get wrong in dev.

---

## Layout

```
server/
  src/
    config.ts              env-driven knobs, freshness ladder
    db.ts                  schema + prepared statements
    universe.ts            43 NSE names with factor-model parameters
    chaos.ts               runtime fault injection
    ingest.ts              tick loop, intraday escalation, job bookkeeping
    routes.ts              HTTP API
    sse.ts                 push fan-out
    providers/
      types.ts             the one interface everything downstream sees
      synthetic.ts         deterministic offline market + history generator
      yahoo.ts             optional live adapter
      registry.ts          breakers, reconciliation, monotonic writes
    analytics/
      stats.ts             robust statistics, noisy-OR, decay
      detectors.ts         bars + events -> explainable signals
      attention.ts         per-user scoring and inbox assembly
      correlation.ts       pairwise rho, effective bets, concentration
    news/classify.ts       lexicon baseline, optional LLM upgrade
web/
  src/
    api.ts                 typed client, SSE subscription
    App.tsx                shell
    components/            Row, Xray, Feed, Picker, Sparkline
    styles.css             tokens + stylesheet
```

### About the synthetic market

Returns come from a two-factor model — one market factor, one sector factor,
plus name-specific noise, with occasional macro shocks and idiosyncratic gaps.
This is deliberate: it means the correlation matrix is genuinely *structured*, so
an all-IT watchlist really does score badly and a spread one really does score
well. A random walk per symbol would have made the diversification panel a
measurement of noise. Seeded, so the demo is reproducible.

## API

| Method | Path | |
|---|---|---|
| GET | `/api/watchlist` | inbox rows, scored and sorted |
| POST | `/api/watchlist` | `{ symbol }` |
| DELETE | `/api/watchlist/:symbol` | |
| POST | `/api/seen` | `{ symbols: [] }` — advance the read cursor |
| GET | `/api/symbol/:symbol` | bars, signals, events, quote |
| GET | `/api/diversification` | correlation x-ray |
| GET | `/api/universe` | covered names |
| GET | `/api/health` | providers, breakers, last tick, counts |
| POST | `/api/chaos` | `{ mode: none\|outage\|stale\|dispute }` |
| POST | `/api/refresh` | force a tick |
| GET | `/api/stream` | SSE |

All requests are scoped by the `x-pulse-user` header.

## What I would do next

Backtest the attention weights against forward returns rather than setting them
by judgement; move ingest to a queue with per-symbol leases once one process is
not enough; replace the synthetic provider with a real NSE feed and add a second
paid source so conflict detection earns its keep; per-user threshold learning
from which alerts get opened versus dismissed.
