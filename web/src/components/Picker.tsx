import { useMemo, useState } from "react";
import type { UniverseEntry } from "../api";

export function Picker({ universe, onAdd }: { universe: UniverseEntry[]; onAdd: (s: string) => void }) {
  const [q, setQ] = useState("");

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const pool = needle
      ? universe.filter(
          (u) =>
            u.symbol.toLowerCase().includes(needle) ||
            u.name.toLowerCase().includes(needle) ||
            u.sector.toLowerCase().includes(needle),
        )
      : universe;
    return pool.slice(0, 40);
  }, [q, universe]);

  return (
    <section>
      <h3>Add a name</h3>
      <div className="picker">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search 43 NSE names by ticker, company or sector"
          aria-label="Search the covered universe"
        />
        <ul>
          {matches.map((u) => (
            <li key={u.symbol}>
              <button disabled={u.held} onClick={() => onAdd(u.symbol)}>
                <span>
                  {u.symbol} <em>{u.name}</em>
                </span>
                <em>{u.held ? "on your list" : u.sector}</em>
              </button>
            </li>
          ))}
          {matches.length === 0 && (
            <li>
              <button disabled>Nothing matches “{q}”. Coverage is 43 NSE large caps.</button>
            </li>
          )}
        </ul>
      </div>
    </section>
  );
}
