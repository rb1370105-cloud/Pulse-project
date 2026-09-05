import { useEffect, useState } from "react";
import { api, type InboxRow, type SymbolDetail } from "../api";
import { Sparkline } from "./Sparkline";

const pct = (v: number | null) => (v === null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`);
const tone = (v: number | null) => (v === null ? "flat" : v > 0.05 ? "up" : v < -0.05 ? "down" : "flat");

const rupees = (n: number) =>
  `\u20b9${n.toLocaleString("en-IN", { maximumFractionDigits: n < 100 ? 2 : 0 })}`;

function ago(ms: number, now: number): string {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 90) return "just now";
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 172_800) return `${Math.round(s / 3600)} hr ago`;
  return `${Math.round(s / 86_400)} days ago`;
}

const FRESHNESS_COPY: Record<string, string> = {
  delayed: "delayed",
  stale: "price is stale",
  dead: "no recent price",
  unknown: "no price yet",
};

type Props = { row: InboxRow; now: number; onRead: (symbol: string) => void; onRemove: (symbol: string) => void };

export function Row({ row, now, onRead, onRemove }: Props) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<SymbolDetail | null>(null);
  const unread = row.unreadCount > 0;

  useEffect(() => {
    if (!open || detail) return;
    let live = true;
    api.symbol(row.symbol).then((d) => live && setDetail(d)).catch(() => {});
    return () => {
      live = false;
    };
  }, [open, detail, row.symbol]);

  /**
   * Closing the row is what advances the read cursor, not opening it. Marking
   * on open re-sorts the list out from under the person mid-sentence; marking
   * on close means the row sits still while it is being read, and then visibly
   * files itself away. There is no separate "mark as read" button to remember.
   */
  const toggle = () => {
    if (open && unread) onRead(row.symbol);
    setOpen(!open);
  };

  const seenIndex =
    detail && row.lastSeenAt
      ? detail.bars.findIndex((b) => Date.parse(`${b.session}T10:00:00Z`) >= row.lastSeenAt!)
      : -1;

  return (
    <article
      className={`row ${unread ? "" : "is-read"}`}
      style={{ ["--mark-height" as string]: `${Math.max(22, Math.sqrt(row.attention / 100) * 100)}%` }}
    >
      <button className="row-head" onClick={toggle} aria-expanded={open}>
        <span className="ticker">{row.symbol}</span>
        <span className="company">{row.name}</span>
        <span className={`delta ${tone(row.sinceSeenPct ?? row.dayChangePct)}`}>
          {pct(row.sinceSeenPct ?? row.dayChangePct)}
          <small>{row.sinceSeenPct !== null ? "since you looked" : "today"}</small>
        </span>
      </button>

      {unread && row.reasons.length > 0 && (
        <ul className="reasons">
          {row.reasons.map((s) => (
            <li key={s.id}>
              {s.headline}
              <span className="when">{ago(s.occurred_at, now)}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="row-foot">
        {unread && <span className="chip chip-mark">{row.attention} attention</span>}
        {row.disputed && <span className="chip chip-warn">sources disagree</span>}
        {row.freshness in FRESHNESS_COPY && (
          <span className="chip chip-warn">{FRESHNESS_COPY[row.freshness]}</span>
        )}
        {!unread && row.price !== null && (
          <span className="chip">
            {rupees(row.price)} · {pct(row.dayChangePct)} today
          </span>
        )}
        <span className="spacer" />
        <button className="btn-quiet" onClick={() => onRemove(row.symbol)}>
          remove
        </button>
      </div>

      {open && (
        <div className="detail">
          {!detail ? (
            <p className="skeleton">Loading {row.symbol}…</p>
          ) : (
            <>
              <div className="detail-grid">
                <Sparkline
                  values={detail.bars.map((b) => b.c)}
                  seenIndex={seenIndex >= 0 ? seenIndex : null}
                />
                <dl>
                  <dt>Last price</dt>
                  <dd>{detail.quote ? rupees(detail.quote.price) : "—"}</dd>
                  <dt>Sector</dt>
                  <dd>{detail.sector}</dd>
                  <dt>Feed</dt>
                  <dd>
                    {detail.quote
                      ? `${detail.quote.source}, ${ago(detail.quote.as_of, now)}`
                      : "no quote"}
                  </dd>
                  {row.disputeNote && (
                    <>
                      <dt>Conflict</dt>
                      <dd>{row.disputeNote}</dd>
                    </>
                  )}
                </dl>
              </div>

              <ul className="log">
                {detail.signals.slice(0, 8).map((s) => (
                  <li key={s.id}>
                    <span className={`dot ${s.unread ? "" : "read"}`} />
                    <time dateTime={new Date(s.occurred_at).toISOString()}>{ago(s.occurred_at, now)}</time>
                    <span className="headline">{s.headline}</span>
                  </li>
                ))}
                {detail.signals.length === 0 && (
                  <li>
                    <span className="headline">Nothing notable on record for {row.symbol}.</span>
                  </li>
                )}
              </ul>
            </>
          )}
        </div>
      )}
    </article>
  );
}
