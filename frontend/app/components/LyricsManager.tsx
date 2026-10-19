"use client";

import { useMemo, useState, type FormEvent } from "react";
import { createFlow, createLyrics, updateLyrics, type ApiError } from "@/lib/api";
import {
  SECTION_CODES,
  canonicalId,
  makeSection,
  nextFreeId,
  splitPastedLyrics,
  stepsToShorthand,
} from "@/lib/lyrics";
import type { Lyric, Section, SongDetail } from "@/lib/types";

function errorText(e: unknown): string {
  const ae = e as ApiError;
  const data = ae.data as Record<string, unknown> | undefined;
  const first = data && Object.values(data)[0];
  return Array.isArray(first) ? String(first[0]) : ae.message;
}

const PASTE_HINT = `Verse 1
Amazing grace, how sweet the sound
That saved a wretch like me

Chorus
My chains are gone, I've been set free

Verse 2
…`;

/** Lyrics per language: add by pasting (auto-split into sections), edit sections. */
export default function LyricsManager({
  song,
  ownsTeam,
  onChanged,
}: {
  song: SongDetail;
  ownsTeam: (teamId: number | null) => boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);

  return (
    <div className="card">
      <h4>Lyrics</h4>
      <p className="muted" style={{ marginTop: 0 }}>
        Write each section once (verses, chorus, end tag…). Teams then arrange them
        into flows like <code>V1 C V2 C MB C ET</code> on the song page.
      </p>
      {song.lyrics.length > 0 && (
        <ul className="lyric-list">
          {song.lyrics.map((l) => (
            <li key={l.id}>
              <div className="lyric-row">
                <span>
                  <strong>{l.language}</strong>{" "}
                  <span className="muted">
                    · {l.segments.map((s) => s.id).join(" ") || "no sections"} · {l.status_display}
                  </span>
                </span>
                {ownsTeam(l.owner_team) ? (
                  <button
                    type="button"
                    className="linkbtn"
                    onClick={() => setEditing(editing === l.id ? null : l.id)}
                  >
                    {editing === l.id ? "Close" : "Edit sections"}
                  </button>
                ) : (
                  <span className="muted">other team</span>
                )}
              </div>
              {editing === l.id && (
                <SectionsEditor
                  lyric={l}
                  onSaved={() => {
                    setEditing(null);
                    onChanged();
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      <AddLanguage song={song} onAdded={onChanged} />
    </div>
  );
}

function AddLanguage({ song, onAdded }: { song: SongDetail; onAdded: () => void }) {
  const [language, setLanguage] = useState("");
  const [text, setText] = useState("");
  const [saveFlow, setSaveFlow] = useState(true);
  const [flowName, setFlowName] = useState("Standard");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const split = useMemo(() => splitPastedLyrics(text), [text]);
  const order = stepsToShorthand(split.steps);
  // Only worth saving as a flow if the pasted order repeats or reorders sections.
  const hasFlow = order !== split.sections.map((s) => s.id).join(" ");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!split.sections.length) {
      setErr("Paste some lyrics first.");
      return;
    }
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await createLyrics({ song: song.id, language: language.trim(), segments: split.sections });
      let note = `${language.trim()} lyrics added (${split.sections.length} sections).`;
      if (hasFlow && saveFlow) {
        try {
          await createFlow({ song: song.id, name: flowName, steps: split.steps, is_default: true });
          note += ` Saved “${flowName}” as your team's flow.`;
        } catch (e2) {
          note += ` The flow wasn't saved: ${errorText(e2)}`;
        }
      }
      setMsg(note);
      setLanguage("");
      setText("");
      onAdded();
    } catch (e2) {
      setErr(errorText(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="add-language">
      <h5>Add lyrics in a language</h5>
      {msg && <div className="msg success">{msg}</div>}
      {err && <div className="msg error">{err}</div>}
      <label>
        Language
        <input
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          placeholder="e.g. English, Chinese"
          required
        />
      </label>
      <label>
        Paste the lyrics{" "}
        <span className="muted">
          — with headings like &ldquo;Verse 1&rdquo;, &ldquo;Chorus&rdquo;, &ldquo;[Bridge]&rdquo;, &ldquo;副歌&rdquo;, or blank lines between sections
        </span>
        <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={PASTE_HINT} required />
      </label>
      {split.sections.length > 0 && (
        <div className="split-preview">
          <div>
            <strong>Sections found:</strong>{" "}
            {split.sections.map((s) => (
              <span key={s.id} className="chip" title={s.lines.join("\n")}>
                {s.label} · {s.lines.length} {s.lines.length === 1 ? "line" : "lines"}
              </span>
            ))}
          </div>
          {hasFlow && (
            <>
              <div>
                <strong>Pasted order:</strong> <code className="flow-code">{order}</code>
              </div>
              <label className="check">
                <input type="checkbox" checked={saveFlow} onChange={(e) => setSaveFlow(e.target.checked)} />
                Save this order as our team&apos;s default flow, named
                <input
                  className="inline-input"
                  value={flowName}
                  onChange={(e) => setFlowName(e.target.value)}
                  disabled={!saveFlow}
                  maxLength={100}
                />
              </label>
            </>
          )}
        </div>
      )}
      <button type="submit" disabled={busy}>
        {busy ? "Saving…" : "Add lyrics"}
      </button>
    </form>
  );
}

function SectionsEditor({ lyric, onSaved }: { lyric: Lyric; onSaved: () => void }) {
  const [sections, setSections] = useState<Section[]>(lyric.segments);
  const [addCode, setAddCode] = useState("V");
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const ids = sections.map((s) => s.id);
  const duplicate = ids.find((id, i) => ids.indexOf(id) !== i);

  function update(i: number, patch: Partial<Section>) {
    setSections((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  }

  function rename(i: number, raw: string) {
    const id = canonicalId(raw);
    if (id) update(i, { ...makeSection(id), lines: sections[i].lines });
  }

  function move(i: number, d: number) {
    const j = i + d;
    if (j < 0 || j >= sections.length) return;
    setSections((prev) => {
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const cleaned = sections.map((s) => ({ ...s, lines: s.lines.map((l) => l.trim()).filter(Boolean) }));
      await updateLyrics(lyric.id, { segments: cleaned });
      onSaved();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sections-editor">
      {err && <div className="msg error">{err}</div>}
      {duplicate && <div className="msg warn">{duplicate} is used twice — each section needs its own id.</div>}
      {sections.map((s, i) => (
        <div key={i} className="section-edit">
          <div className="section-edit-head">
            <select value={s.id.replace(/\d+$/, "")} onChange={(e) => rename(i, e.target.value + (s.id.match(/\d+$/)?.[0] ?? ""))}>
              {Object.entries(SECTION_CODES).map(([code, [, label]]) => (
                <option key={code} value={code}>{label}</option>
              ))}
            </select>
            <input
              className="num-input"
              type="number"
              min={1}
              max={99}
              value={Number(s.id.match(/\d+$/)?.[0] ?? 1)}
              onChange={(e) => rename(i, s.id.replace(/\d+$/, "") + e.target.value)}
              aria-label="Number"
            />
            <code>{s.id}</code>
            <span className="section-edit-actions">
              <button type="button" className="linkbtn" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
              <button type="button" className="linkbtn" onClick={() => move(i, 1)} disabled={i === sections.length - 1}>↓</button>
              <button
                type="button"
                className="linkbtn danger"
                onClick={() => setSections((prev) => prev.filter((_, j) => j !== i))}
              >
                remove
              </button>
            </span>
          </div>
          <textarea
            rows={Math.max(2, s.lines.length)}
            value={s.lines.join("\n")}
            onChange={(e) => update(i, { lines: e.target.value.split("\n") })}
          />
        </div>
      ))}
      <div className="section-add">
        <select value={addCode} onChange={(e) => setAddCode(e.target.value)}>
          {Object.entries(SECTION_CODES).map(([code, [, label]]) => (
            <option key={code} value={code}>{label}</option>
          ))}
        </select>
        <button
          type="button"
          className="linkbtn"
          onClick={() => setSections((prev) => [...prev, makeSection(nextFreeId(addCode, new Set(ids)))])}
        >
          + Add section
        </button>
      </div>
      <details className="paste-replace">
        <summary>Replace all sections by pasting</summary>
        <textarea rows={6} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={PASTE_HINT} />
        <button
          type="button"
          className="linkbtn"
          disabled={!paste.trim()}
          onClick={() => {
            setSections(splitPastedLyrics(paste).sections);
            setPaste("");
          }}
        >
          Split into sections
        </button>
      </details>
      <button type="button" className="save-sections" onClick={save} disabled={busy || !!duplicate}>
        {busy ? "Saving…" : "Save sections"}
      </button>
    </div>
  );
}
