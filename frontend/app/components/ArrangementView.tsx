"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { arrangeSong } from "@/lib/api";
import type { Arrangement, FlowStep } from "@/lib/types";

/**
 * Expanded lyrics for a song, in flow order: sections, music-break markers,
 * and sections borrowed from other songs (with their licensing). Pass `steps`
 * for a live preview of an unsaved flow.
 */
export default function ArrangementView({
  songId,
  flowId = null,
  team = null,
  steps,
  language: initialLanguage = null,
  compact = false,
}: {
  songId: number;
  flowId?: number | null;
  team?: number | null;
  steps?: FlowStep[];
  language?: string | null;
  compact?: boolean;
}) {
  const [language, setLanguage] = useState<string | null>(initialLanguage);
  const [data, setData] = useState<Arrangement | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const stepsKey = steps ? JSON.stringify(steps) : null;

  useEffect(() => {
    let cancelled = false;
    const h = setTimeout(
      () => {
        arrangeSong(songId, {
          ...(stepsKey ? { steps: JSON.parse(stepsKey) } : { flow: flowId, team }),
          language,
        })
          .then((d) => {
            if (!cancelled) {
              setData(d);
              setErr(null);
            }
          })
          .catch((e) => !cancelled && setErr(e instanceof Error ? e.message : "Couldn't load lyrics."));
      },
      stepsKey ? 300 : 0 // debounce live previews
    );
    return () => {
      cancelled = true;
      clearTimeout(h);
    };
  }, [songId, flowId, team, stepsKey, language]);

  if (err) return <p className="msg error">{err}</p>;
  if (!data) return <p className="muted">Loading lyrics…</p>;
  if (!data.language) return <p className="muted">No lyrics entered yet.</p>;

  return (
    <div className={compact ? "arrangement compact" : "arrangement"}>
      {data.languages.length > 1 && (
        <div className="lang-tabs" role="tablist">
          {data.languages.map((l) => (
            <button
              key={l}
              type="button"
              role="tab"
              aria-selected={l === data.language}
              className={l === data.language ? "chip on" : "chip"}
              onClick={() => setLanguage(l)}
            >
              {l}
            </button>
          ))}
        </div>
      )}
      {data.items.length === 0 && <p className="muted">This flow is empty.</p>}
      {data.items.map((item, i) =>
        item.kind === "marker" ? (
          <div key={i} className="arr-marker">— {item.label} —</div>
        ) : item.kind === "missing" ? (
          <div key={i} className="arr-missing">
            {item.id} isn&apos;t written {item.song ? `in “${item.song.title}”` : "for this song"}
            {data.language ? ` (${data.language})` : ""} yet.
          </div>
        ) : (
          <div key={i} className="segment">
            <div className="seg-type">
              {item.label}
              {item.song && (
                <span className="arr-borrowed">
                  {" "}· from{" "}
                  <Link href={`/songs/${item.song.id}`}>{item.song.title}</Link>
                </span>
              )}
            </div>
            <div className="lines">{item.lines.join("\n")}</div>
          </div>
        )
      )}
      {data.borrowed.length > 0 && (
        <p className="arr-licensing">
          Includes:{" "}
          {data.borrowed
            .map((b) => `“${b.title}” (CCLI ${b.ccli_number || "—"}, ${b.copyright_holder})`)
            .join("; ")}
        </p>
      )}
    </div>
  );
}
