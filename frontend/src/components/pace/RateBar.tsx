import { useState } from "react";

import { useRateTurn } from "../../api/chat";

/**
 * Magic or annoying — the question v0 exists to answer, asked per turn.
 *
 * Two separate judgements, deliberately. The **feel** is the gut reaction; the **score**
 * is cleanup cost on the spike's scale (0 used as-is, 1 light edits, 2 heavy edits,
 * 3 redid it myself). A reply can feel magic and still need heavy editing, and that gap
 * is the interesting finding.
 */
const FEELS = [
  { key: "magic", label: "magic", cls: "bg-emerald-100 text-emerald-700" },
  { key: "meh", label: "meh", cls: "bg-slate-100 text-slate-600" },
  { key: "annoying", label: "annoying", cls: "bg-red-100 text-red-600" },
] as const;

const SCORES = [
  { n: 0, hint: "used as-is" },
  { n: 1, hint: "light edits" },
  { n: 2, hint: "heavy edits" },
  { n: 3, hint: "redid it myself" },
] as const;

export default function RateBar({
  sessionId,
  turn,
}: {
  sessionId: string;
  turn: number;
}) {
  const rate = useRateTurn();
  const [feel, setFeel] = useState<string | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);

  function send(nextFeel: string | null, nextScore: number | null, nextNote = note) {
    if (!nextFeel || nextScore === null) return; // both halves before it counts
    rate.mutate({
      session_id: sessionId,
      turn,
      score: nextScore,
      feel: nextFeel,
      note: nextNote,
    });
  }

  const saved = rate.isSuccess && !rate.isPending;

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
      {FEELS.map((f) => (
        <button
          key={f.key}
          onClick={() => {
            setFeel(f.key);
            send(f.key, score);
          }}
          className={`rounded px-1.5 py-0.5 ${
            feel === f.key ? f.cls : "text-slate-400 hover:bg-slate-100"
          }`}
        >
          {f.label}
        </button>
      ))}

      <span className="mx-0.5 text-slate-400">·</span>
      <span className="text-slate-400">cleanup</span>
      {SCORES.map((s) => (
        <button
          key={s.n}
          title={s.hint}
          onClick={() => {
            setScore(s.n);
            send(feel, s.n);
          }}
          className={`w-5 rounded py-0.5 tabular-nums ${
            score === s.n
              ? "bg-slate-900 text-surface"
              : "text-slate-400 hover:bg-slate-100"
          }`}
        >
          {s.n}
        </button>
      ))}

      <button
        onClick={() => setNoteOpen((o) => !o)}
        className="rounded px-1.5 py-0.5 text-slate-400 hover:bg-slate-100"
      >
        {note ? "note ✓" : "+ note"}
      </button>

      {saved ? <span className="text-emerald-700">saved</span> : null}
      {rate.isError ? (
        <span className="text-red-600">not saved: {(rate.error as Error).message}</span>
      ) : null}
      {feel && score === null ? <span className="text-slate-400">pick a cleanup score</span> : null}
      {!feel && score !== null ? <span className="text-slate-400">pick how it felt</span> : null}

      {noteOpen ? (
        <input
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => send(feel, score)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              send(feel, score);
              setNoteOpen(false);
            }
          }}
          placeholder="what stood out?"
          className="w-full rounded border border-slate-300 bg-surface px-2 py-1 text-[12px] text-slate-900"
        />
      ) : null}
    </div>
  );
}
