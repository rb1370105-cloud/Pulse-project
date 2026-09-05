import type { Health } from "../api";

const MODES = [
  { id: "none", label: "Healthy" },
  { id: "outage", label: "Outage" },
  { id: "stale", label: "Stale data" },
  { id: "dispute", label: "Sources disagree" },
];

export function Feed({ health, onChaos }: { health: Health | null; onChaos: (mode: string) => void }) {
  if (!health) return null;

  const failing = health.providers.filter((p) => p.state !== "ok");
  const pip = failing.length === health.providers.length ? "bad" : failing.length ? "warn" : "";
  const tick = health.lastTick;

  return (
    <section>
      <h3>Feed</h3>

      <div className="status" style={{ marginBottom: "0.6rem" }}>
        <span className={`pip ${pip}`} />
        {health.providers.map((p) => `${p.name} ${p.state}`).join(", ")}
      </div>

      <dl className="facts">
        <div>
          <dt>Polling</dt>
          <dd>every {health.tickSeconds}s</dd>
        </div>
        {tick && (
          <>
            <div>
              <dt>Last cycle</dt>
              <dd>
                {tick.applied} applied, {tick.rejected} rejected
              </dd>
            </div>
            <div>
              <dt>Cycle time</dt>
              <dd>{tick.durationMs} ms</dd>
            </div>
          </>
        )}
        <div>
          <dt>Headline model</dt>
          <dd>{health.llm}</dd>
        </div>
        <div>
          <dt>Stored</dt>
          <dd>
            {health.counts.signals} signals · {health.counts.bars.toLocaleString()} bars
          </dd>
        </div>
      </dl>

      <p className="note">
        Market feeds break, lag and disagree. Break this one on purpose and watch the list stay
        honest about what it knows.
      </p>

      <div className="chaos">
        {MODES.map((m) => (
          <button
            key={m.id}
            className={`btn ${m.id === "none" ? "" : "fault"}`}
            aria-pressed={health.chaos === m.id}
            onClick={() => onChaos(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      {failing.length > 0 && failing[0].lastError && (
        <p className="note">
          {failing[0].name}: {failing[0].lastError}. Retrying in{" "}
          {Math.max(0, Math.round(failing[0].retryInMs / 1000))}s; last good prices stay on screen,
          labelled.
        </p>
      )}
    </section>
  );
}
