// Shared skeleton primitives - a plain pulsing block, sized by whatever
// className the caller passes in, so one component covers KPI tiles,
// chart cards, and table rows alike.
export function SkeletonBlock({ className = "", style }) {
  return <div className={`animate-pulse rounded-md bg-surface-2 ${className}`} style={style} />;
}

export function SkeletonKpiCard() {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <SkeletonBlock className="h-3 w-24" />
      <SkeletonBlock className="mt-3 h-7 w-20" />
      <SkeletonBlock className="mt-2 h-3 w-16" />
    </div>
  );
}

export function SkeletonChartCard({ height = 260 }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <SkeletonBlock className="h-3 w-40" />
      <SkeletonBlock className="mt-4 w-full" style={{ height: `${height}px` }} />
    </div>
  );
}

export function SkeletonTableRows({ rows = 6, cols = 6 }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <tr key={rowIndex}>
          {Array.from({ length: cols }).map((_, colIndex) => (
            <td key={colIndex} className="px-4 py-3">
              <SkeletonBlock className="h-3.5 w-full max-w-[120px]" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
