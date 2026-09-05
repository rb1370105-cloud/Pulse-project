import { useCallback, useEffect, useState } from "react";
import {
  api,
  currentUser,
  subscribe,
  type Diversification,
  type Health,
  type UniverseEntry,
  type Watchlist,
} from "./api";
import { Row } from "./components/Row";
import { Xray } from "./components/Xray";
import { Feed } from "./components/Feed";
import { Picker } from "./components/Picker";

const WORDS = ["Nothing", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
const count = (n: number) => WORDS[n] ?? String(n);

function visitPhrase(ts: number | null): string {
  if (!ts) return "This is your first visit.";
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  const when = new Date(ts).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
  if (days < 1) return `You were last here earlier today.`;
  return `Last visit ${when}.`;
}

export default function App() {
  const [list, setList] = useState<Watchlist | null>(null);
  const [div, setDiv] = useState<Diversification | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [universe, setUniverse] = useState<UniverseEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      const [w, d, h, u] = await Promise.all([
        api.watchlist(),
        api.diversification(),
        api.health(),
        api.universe(),
      ]);
      setList(w);
      setDiv(d);
      setHealth(h);
      setUniverse(u);
      setError(null);
    } catch (err) {
      // A failed reload must not blank a list the person is reading. Keep the
      // last good render on screen and say what went wrong above it.
      setError(err instanceof Error ? err.message : "Could not reach the server.");
    }
  }, []);

  useEffect(() => {
    load();
    const stop = subscribe(load);
    const clock = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      stop();
      clearInterval(clock);
    };
  }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
    }
  };

  if (!list) {
    return (
      <div className="shell">
        <p className="skeleton">{error ?? "Reading your watchlist…"}</p>
      </div>
    );
  }

  const needsLook = list.rows.filter((r) => r.unreadCount > 0);
  const caughtUp = list.rows.filter((r) => r.unreadCount === 0);

  return (
    <div className="shell">
      <header className="masthead">
        <h1 className="wordmark">
          Pulse<span>watching as {currentUser}</span>
        </h1>
        <div className="status">
          <span className={`pip ${health?.chaos !== "none" ? "warn" : ""}`} />
          {list.summary.degraded > 0
            ? `${list.summary.degraded} of ${list.summary.total} prices are not trustworthy right now`
            : `${list.summary.total} names, prices current`}
        </div>
      </header>

      {error && (
        <div className="error">
          <strong>{error}</strong>
          Showing the last data that loaded successfully.
        </div>
      )}

      <section className="hero">
        <div>
          <h2>
            {needsLook.length === 0
              ? "Nothing on your list has moved enough to bother you."
              : `${count(needsLook.length)} of ${list.summary.total} names did something while you were away.`}
          </h2>
          <p>
            {visitPhrase(list.summary.lastVisit)}{" "}
            {needsLook.length === 0
              ? "That is a finding, not an empty screen — the quiet names are below."
              : "Ordered by how much they want your attention, not by how much you hold."}
          </p>
        </div>
        {needsLook.length > 0 && (
          <div className="hero-actions">
            <button
              className="btn btn-primary"
              onClick={() => act(() => api.markSeen(needsLook.map((r) => r.symbol)))}
            >
              Mark all as read
            </button>
          </div>
        )}
      </section>

      <div className="columns">
        <main>
          {needsLook.map((row) => (
            <Row
              key={row.symbol}
              row={row}
              now={now}
              onRead={(s) => act(() => api.markSeen([s]))}
              onRemove={(s) => act(() => api.remove(s))}
            />
          ))}

          {caughtUp.length > 0 && (
            <>
              <div className="divider">{needsLook.length ? "Caught up" : "Everything"}</div>
              {caughtUp.map((row) => (
                <Row
                  key={row.symbol}
                  row={row}
                  now={now}
                  onRead={(s) => act(() => api.markSeen([s]))}
                  onRemove={(s) => act(() => api.remove(s))}
                />
              ))}
            </>
          )}

          {list.rows.length === 0 && (
            <p className="empty">
              Your watchlist is empty. Add a few names from the panel on the right and Pulse will
              start keeping track of what changes between your visits.
            </p>
          )}
        </main>

        <aside className="rail">
          {div && <Xray data={div} onAdd={(s) => act(() => api.add(s))} />}
          <Feed health={health} onChaos={(mode) => act(() => api.chaos(mode))} />
          <Picker universe={universe} onAdd={(s) => act(() => api.add(s))} />
        </aside>
      </div>
    </div>
  );
}
