type Props = { values: number[]; width?: number; height?: number; seenIndex?: number | null };

/**
 * A price line with one annotation: where the user last looked. The shaded
 * region to its right is the part of the chart they have not seen, which is the
 * only part this product claims to be about.
 */
export function Sparkline({ values, width = 260, height = 56, seenIndex = null }: Props) {
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => (i / (values.length - 1)) * width;
  const y = (v: number) => height - ((v - min) / span) * (height - 6) - 3;

  const path = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const rising = values[values.length - 1] >= (seenIndex != null ? values[seenIndex] : values[0]);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={`Price over the last ${values.length} sessions`}
    >
      {seenIndex != null && seenIndex < values.length - 1 && (
        <>
          <rect x={x(seenIndex)} y={0} width={width - x(seenIndex)} height={height} fill="var(--mark-soft)" />
          <line x1={x(seenIndex)} y1={0} x2={x(seenIndex)} y2={height} stroke="var(--mark)" strokeWidth={1} strokeDasharray="2 3" />
        </>
      )}
      <path d={path} fill="none" stroke={rising ? "var(--up)" : "var(--down)"} strokeWidth={1.4} strokeLinejoin="round" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={2.4} fill={rising ? "var(--up)" : "var(--down)"} />
    </svg>
  );
}
