import { useState } from "react";

import { useRateTurn } from "../../api/chat";

/**
 * Magic or annoying — the question v0 exists to answer, asked after every reply.
 *
 * **One press is the whole rating.** It used to need two halves, a feel and a cleanup
 * score, and nothing was recorded until both were in. That lost evidence: the gut
 * reaction is available the instant you read the reply, while cleanup cost is only known
 * once you have tried to use it. So the feel saves on the press, and the cleanup score
 * (0 used as-is, 1 light edits, 2 heavy edits, 3 redid it myself) is an optional second
 * step that updates the same row.
 *
 * Deliberately sized and bordered like real buttons rather than the grey text links they
 * were. A rating that is a chore does not get made.
 */
const FEELS = [
  {
    key: "magic",
    label: "Magic",
    on: "border-emerald-700 bg-emerald-100 text-emerald-700",
    off: "border-slate-300 text-slate-600 hover:border-emerald-700 hover:text-emerald-700",
  },
  {
    key: "meh",
    label: "Meh",
    on: "border-slate-900 bg-slate-900 text-surface",
    off: "border-slate-300 text-slate-600 hover:border-slate-900 hover:text-slate-900",
  },
  {
    key: "annoying",
    label: "Annoying",
    on: "border-red-600 bg-red-100 text-red-600",
    off: "border-slate-300 text-slate-600 hover:border-red-600 hover:text-red-600",
  },
] as const;

const SCORES = [
  { n: 0, hint: "used it as-is" },
  { n: 1, hint: "light edits" },
  { n: 2, hint: "heavy edits" },
  { n: 3, hint: "redid it myself" },
] as const;

export default function RateBar({ sessionId, turn }: { sessionId: string; turn: number }) {
  const rate = useRateTurn();
  const [feel, setFeel] = useState<string | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);

  /** Save. The feel is required; everything else refines the same row. */
  function save(nextFeel: string | null, nextScore: number | null, nextNote = note) {
    if (!nextFeel) return;
    rate.mutate({
      session_id: sessionId,
      turn,
      feel: nextFeel,
      score: nextScore,
      note: nextNote,
    });
  }

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] uppercase tracking-wide text-slate-500">
          {feel ? "How it felt" : "How was that?"}
        </span>
        {FEELS.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={feel === f.key}
            onClick={() => {
              setFeel(f.key);
              save(f.key, score);
            }}
            className={`rounded-lg border px-3 py-1 text-[13px] font-medium transition-colors ${
              feel === f.key ? f.on : f.off
            }`}
          >
            {f.label}
          </button>
        ))}
        {rate.isPending ? <span className="text-[11px] text-slate-400">saving…</span> : null}
        {rate.isSuccess && !rate.isPending ? (
          <span className="text-[11px] text-emerald-700">logged</span>
        ) : null}
        {rate.isError ? (
          <span className="text-[11px] text-red-600">
            not saved: {(rate.error as Error).message}
          </span>
        ) : null}
      </div>

      {/* Only once there is a verdict to attach it to. */}
      {feel ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="text-slate-500">cleanup, if you know yet</span>
          {SCORES.map((s) => (
            <button
              key={s.n}
              type="button"
              title={s.hint}
              aria-pressed={score === s.n}
              onClick={() => {
                setScore(s.n);
                save(feel, s.n);
              }}
              className={`w-6 rounded border py-0.5 tabular-nums ${
                score === s.n
                  ? "border-slate-900 bg-slate-900 text-surface"
                  : "border-slate-300 text-slate-500 hover:border-slate-900 hover:text-slate-900"
              }`}
            >
              {s.n}
            </button>
          ))}
          <span className="text-slate-400">
            {score === null ? "0 used as-is … 3 redid it myself" : SCORES[score].hint}
          </span>
          <button
            type="button"
            onClick={() => setNoteOpen((o) => !o)}
            className="rounded border border-slate-300 px-1.5 py-0.5 text-slate-500 hover:border-slate-900 hover:text-slate-900"
          >
            {note ? "note ✓" : "+ note"}
          </button>
        </div>
      ) : null}

      {noteOpen ? (
        <input
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => save(feel, score)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              save(feel, score);
              setNoteOpen(false);
            }
          }}
          placeholder="what stood out?"
          className="mt-1.5 w-full rounded-lg border border-slate-300 bg-surface px-2 py-1 text-[12px] text-slate-900 placeholder:text-slate-400"
        />
      ) : null}
    </div>
  );
}
