import type { Diversification } from "../api";

/**
 * Correlation on one axis only: how close to moving together. Paper is
 * independent, ink is lockstep. A second hue would imply a second dimension
 * that is not there.
 *
 * The ramp is stretched over 0 to 0.7 rather than the full -1 to 1, because
 * that is the range real equity pairs actually occupy — mapping the whole
 * theoretical span turns every matrix into the same flat mid-tone square.
 */
function shade(rho: number): string {
  const t = Math.max(0, Math.min(1, rho / 0.7));
  return `rgba(46, 42, 143, ${(t * t * 0.92 + 0.04).toFixed(3)})`;
}

export function Xray({ data, onAdd }: { data: Diversification; onAdd: (symbol: string) => void }) {
  const { matrix } = data;
  const n = matrix.symbols.length;
  const cell = 7;
  const pad = 26; // room for the ticker labels down the left edge
  const size = cell * n;

  return (
    <section>
      <h3>Diversification</h3>

      {data.effectiveBets !== null ? (
        <>
          <div className="bets">
            <b>{data.effectiveBets.toFixed(1)}</b>
            <span>
              independent bets across {data.n} names
            </span>
          </div>
          <p className="verdict">{data.verdict}</p>

          {n > 1 && (
            <svg
              className="heat"
              viewBox={`0 0 ${size + pad} ${size + 9}`}
              role="img"
              aria-label={`Correlation matrix for ${matrix.symbols.join(", ")}`}
            >
              {matrix.symbols.map((s, i) => (
                <text key={s} x={pad - 2} y={i * cell + cell - 1.6} textAnchor="end">
                  {s.length > 8 ? `${s.slice(0, 7)}…` : s}
                </text>
              ))}
              {matrix.rows.map((r, i) =>
                r.map((v, j) => (
                  <rect
                    key={`${i}-${j}`}
                    x={pad + j * cell}
                    y={i * cell}
                    width={cell - 0.7}
                    height={cell - 0.7}
                    fill={i === j ? "var(--ink)" : shade(v)}
                  >
                    <title>{`${matrix.symbols[i]} vs ${matrix.symbols[j]}: ${v.toFixed(2)}`}</title>
                  </rect>
                )),
              )}
              <text x={pad} y={size + 7} fill="var(--ink-3)">
                independent
              </text>
              <text x={pad + size} y={size + 7} textAnchor="end" fill="var(--ink-3)">
                lockstep
              </text>
              <rect x={pad + size - 44} y={size + 2.5} width={22} height={4} fill="url(#ramp)" />
              <defs>
                <linearGradient id="ramp">
                  <stop offset="0%" stopColor={shade(0)} />
                  <stop offset="100%" stopColor={shade(0.7)} />
                </linearGradient>
              </defs>
            </svg>
          )}

          <dl className="facts">
            <div>
              <dt>Average pair correlation</dt>
              <dd>{data.meanRho?.toFixed(2)}</dd>
            </div>
            {data.redundantPairs[0] && (
              <div>
                <dt>Closest pair</dt>
                <dd>
                  {data.redundantPairs[0].a} · {data.redundantPairs[0].b} ({data.redundantPairs[0].rho.toFixed(2)})
                </dd>
              </div>
            )}
            {data.mostRedundant && (
              <div>
                <dt>Adds the least</dt>
                <dd>{data.mostRedundant.symbol}</dd>
              </div>
            )}
            <div>
              <dt>Largest sector</dt>
              <dd>
                {data.concentration[0]?.sector} {Math.round((data.concentration[0]?.weight ?? 0) * 100)}%
              </dd>
            </div>
          </dl>

          {data.suggestions.length > 0 && (
            <>
              <p className="note">
                Least correlated to what you already hold — click to add:
              </p>
              <div className="chaos">
                {data.suggestions.map((s) => (
                  <button key={s.symbol} className="btn" onClick={() => onAdd(s.symbol)} title={`${s.name} · average correlation ${s.avgRho.toFixed(2)}`}>
                    {s.symbol} <em style={{ color: "var(--ink-3)", fontStyle: "normal" }}>{s.avgRho.toFixed(2)}</em>
                  </button>
                ))}
              </div>
            </>
          )}

          {!data.reliable && (
            <p className="note">
              Some pairs share fewer than 60 overlapping sessions, so treat this as a rough read.
            </p>
          )}
        </>
      ) : (
        <p className="verdict">{data.verdict}</p>
      )}
    </section>
  );
}
