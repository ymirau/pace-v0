/** Background state for a tile: neutral gray, or budget green/amber/red. */
export type MetricTone = "neutral" | "ok" | "warn" | "over";

// Token-backed tones (defined in index.css @theme + dark block) so tiles flip
// in dark mode instead of staying light. Light values are unchanged.
const TONE_BG: Record<MetricTone, string> = {
  neutral: "bg-tile-neutral", // the content surface: flat on the page, like cards
  ok: "bg-tile-ok", // matches the "OK" badge
  warn: "bg-tile-warn", // "Near limit" (yellow)
  over: "bg-tile-over", // "Over"
};

/** A small labelled metric tile used inside the entity cards. */
export default function MetricTile({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: MetricTone;
}) {
  return (
    <div className={`rounded-lg px-3.5 py-3 ${TONE_BG[tone]}`}>
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-medium text-slate-900">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-400">{sub}</div>}
    </div>
  );
}
