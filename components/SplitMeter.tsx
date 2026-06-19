"use client";

// The signature element: a live "split meter" — an audio-equalizer seek bar where
// each variant owns a colored segment proportional to its share of the USDC pot,
// with a glowing cyan playhead at the leader's split point. Pumps while voting is live.
const COLORS = ["var(--volt)", "var(--magenta)", "var(--cyan)", "#f59e0b"];

export default function SplitMeter({
  staked,
  pot,
  live = false,
  bars = 30,
  variant = "full",
}: {
  staked: bigint[];
  pot: bigint;
  live?: boolean;
  bars?: number;
  variant?: "full" | "mini";
}) {
  const total = staked.reduce((a, b) => a + b, 0n);
  // counts per variant, summing to `bars`
  let counts: number[];
  if (total === 0n) {
    const even = Math.floor(bars / staked.length) || 0;
    counts = staked.map(() => even);
  } else {
    counts = staked.map((s) => Math.round((Number(s) / Number(total)) * bars));
  }
  let sum = counts.reduce((a, b) => a + b, 0);
  // fix rounding drift onto the largest segment
  if (sum !== bars && counts.length) {
    const big = counts.indexOf(Math.max(...counts));
    counts[big] += bars - sum;
    sum = bars;
  }

  // leader split point (fraction from left) for the playhead
  let leadIdx = 0;
  for (let i = 1; i < staked.length; i++) if (staked[i] > staked[leadIdx]) leadIdx = i;
  let before = 0;
  for (let i = 0; i < leadIdx; i++) before += counts[i];
  const headPct = total === 0n ? 50 : ((before + counts[leadIdx]) / bars) * 100;

  const cells: { color: string }[] = [];
  counts.forEach((c, vi) => {
    for (let k = 0; k < c; k++) cells.push({ color: total === 0n ? "var(--line-2)" : COLORS[vi % COLORS.length] });
  });
  while (cells.length < bars) cells.push({ color: "var(--line-2)" });

  return (
    <div style={{ position: "relative" }}>
      <div className={`meter ${variant === "mini" ? "meter--mini" : ""} ${live && total > 0n ? "meter--live" : ""}`}>
        {cells.slice(0, bars).map((cell, i) => {
          const h = 34 + 60 * Math.abs(Math.sin(i * 0.9 + 0.5));
          return (
            <span
              key={i}
              className="bar"
              style={{ height: `${h}%`, background: cell.color, animationDelay: `${(i % 7) * 0.09}s` }}
            />
          );
        })}
      </div>
      {total > 0n && variant === "full" && (
        <span className="playhead" style={{ position: "absolute", top: -3, bottom: -3, left: `calc(${headPct}% - 1px)` }} />
      )}
    </div>
  );
}
