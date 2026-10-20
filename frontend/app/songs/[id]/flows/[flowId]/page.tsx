"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createFlow,
  deleteFlow,
  fetchSong,
  fetchSongs,
  updateFlow,
  type ApiError,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { MARKERS, parseShorthand, stepsToShorthand } from "@/lib/lyrics";
import type { FlowStep, Section, SongDetail, SongListItem } from "@/lib/types";
import ArrangementView from "@/app/components/ArrangementView";

function errorText(e: unknown): string {
  const ae = e as ApiError;
  const data = ae.data as Record<string, unknown> | undefined;
  const first = data && Object.values(data)[0];
  return Array.isArray(first) ? String(first[0]) : typeof first === "string" ? first : ae.message;
}

/** Sections of a song across its languages (first language's labels win). */
function songSections(song: SongDetail): Section[] {
  const seen = new Map<string, Section>();
  for (const l of song.lyrics) for (const s of l.segments) if (!seen.has(s.id)) seen.set(s.id, s);
  return [...seen.values()];
}

export default function FlowEditorPage({
  params,
}: {
  params: Promise<{ id: string; flowId: string }>;
}) {
  const { id, flowId } = use(params);
  const isNew = flowId === "new";
  const router = useRouter();
  const { user, isLeader, ownsTeam, loading } = useAuth();
  const [song, setSong] = useState<SongDetail | null>(null);
  const [name, setName] = useState("Standard");
  const [isDefault, setIsDefault] = useState(true);
  const [text, setText] = useState("");
  const [titles, setTitles] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    fetchSong(id)
      .then((s) => {
        setSong(s);
        const flow = s.flows.find((f) => String(f.id) === flowId);
        if (flow) {
          setName(flow.name);
          setIsDefault(flow.is_default);
          setText(stepsToShorthand(flow.steps));
          // Titles for remix steps in an existing flow.
          const ids = [...new Set(flow.steps.flatMap((st) => ("song" in st && st.song != null ? [st.song] : [])))];
          ids.forEach((sid) =>
            fetchSong(sid)
              .then((o) => setTitles((t) => ({ ...t, [sid]: o.title })))
              .catch(() => {})
          );
        } else if (isNew) {
          // Suggest the written order as a starting point.
          setText(songSections(s).map((x) => x.id).join(" "));
        }
      })
      .catch(() => setErr("Song not found."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, flowId]);

  // A new flow becomes the default only if the team doesn't have one yet.
  // Runs once the user is known (auth loads separately from the song).
  useEffect(() => {
    if (isNew && song && user) {
      setIsDefault(!song.flows.some((f) => f.owner_team === user.team && f.is_default));
    }
  }, [isNew, song, user]);

  const sections = useMemo(() => (song ? songSections(song) : []), [song]);
  const known = useMemo(() => new Set(sections.map((s) => s.id)), [sections]);
  const parsed = useMemo(() => parseShorthand(text, known), [text, known]);

  if (loading || (!song && !err)) {
    return <main className="container"><p className="muted">Loading…</p></main>;
  }
  if (!song) {
    return <main className="container"><p className="muted">{err}</p></main>;
  }
  const flow = song.flows.find((f) => String(f.id) === flowId);
  const canEdit = isLeader && (isNew || (flow && ownsTeam(flow.owner_team)));
  if (!canEdit) {
    return (
      <main className="container narrow">
        <Link href={`/songs/${id}`} className="back">← Back to song</Link>
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            {!isNew && !flow
              ? "Flow not found."
              : "Only leaders can create flows, and only the owning team can edit one."}
          </p>
        </div>
      </main>
    );
  }

  const label = (sid: string) => sections.find((s) => s.id === sid)?.label ?? sid;
  const setSteps = (steps: FlowStep[]) => setText(stepsToShorthand(steps));
  const append = (token: string) => setText((t) => `${t.trim()} ${token}`.trim());

  function moveStep(i: number, d: number) {
    const j = i + d;
    if (j < 0 || j >= parsed.steps.length) return;
    const next = [...parsed.steps];
    [next[i], next[j]] = [next[j], next[i]];
    setSteps(next);
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const body = { name, is_default: isDefault, steps: parsed.steps };
      if (isNew) await createFlow({ ...body, song: Number(id) });
      else await updateFlow(Number(flowId), body);
      router.push(`/songs/${id}`);
    } catch (e) {
      setErr(errorText(e));
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await deleteFlow(Number(flowId));
      router.push(`/songs/${id}`);
    } catch (e) {
      setErr(errorText(e));
      setBusy(false);
    }
  }

  return (
    <main className="container flow-editor">
      <Link href={`/songs/${id}`} className="back">← Back to {song.title}</Link>
      <h2 style={{ marginBottom: 4 }}>{isNew ? "New flow" : `Edit flow: ${flow?.name}`}</h2>
      <p className="muted" style={{ marginTop: 0 }}>{song.title}</p>
      {err && <div className="msg error">{err}</div>}

      <div className="flow-grid">
        <div className="card">
          <div className="row">
            <label className="grow">
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
            </label>
            <label className="check">
              <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
              Our team&apos;s default
            </label>
          </div>

          <label>
            Flow <span className="muted">— type codes, e.g. <code>V C V C MB C ET</code></span>
            <input
              className="flow-input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <p className="hint">
            Bare <code>V</code> numbers itself (V1, then V2). Markers:{" "}
            {Object.entries(MARKERS).map(([c, l]) => `${c} = ${l}`).join(", ")}.
          </p>
          {parsed.invalid.length > 0 && (
            <div className="msg error">Not recognised: {parsed.invalid.join(", ")}</div>
          )}
          {parsed.missing.length > 0 && (
            <div className="msg warn">
              Not written for this song yet: {parsed.missing.join(", ")}.{" "}
              <Link href={`/songs/${id}/edit`}>Add sections</Link> (they&apos;ll show as gaps until then).
            </div>
          )}

          <div className="palette">
            <span className="palette-label">Add:</span>
            {sections.map((s) => (
              <button key={s.id} type="button" className="chip" onClick={() => append(s.id)} title={s.lines.join("\n")}>
                {s.label}
              </button>
            ))}
            {Object.entries(MARKERS).map(([code, l]) => (
              <button key={code} type="button" className="chip marker" onClick={() => append(code)}>
                {l}
              </button>
            ))}
          </div>

          <RemixPicker
            excludeId={song.id}
            onPick={(sid, title, section) => {
              setTitles((t) => ({ ...t, [sid]: title }));
              append(`@${sid}:${section}`);
            }}
          />

          <h5>Steps</h5>
          {parsed.steps.length === 0 ? (
            <p className="muted">No steps yet — type codes above or click sections.</p>
          ) : (
            <ol className="step-list">
              {parsed.steps.map((st, i) => (
                <li key={i}>
                  <span className={"marker" in st ? "step-marker" : ""}>
                    {"marker" in st
                      ? st.label
                      : st.song != null
                        ? `${st.section} from “${titles[st.song] ?? `song #${st.song}`}”`
                        : label(st.section)}
                  </span>
                  <span className="step-actions">
                    <button type="button" className="linkbtn" onClick={() => moveStep(i, -1)} disabled={i === 0}>↑</button>
                    <button type="button" className="linkbtn" onClick={() => moveStep(i, 1)} disabled={i === parsed.steps.length - 1}>↓</button>
                    <button type="button" className="linkbtn" onClick={() => setSteps(parsed.steps.filter((_, j) => j !== i))}>×</button>
                  </span>
                </li>
              ))}
            </ol>
          )}

          <div className="editor-actions">
            <button type="button" className="primary" onClick={save} disabled={busy || parsed.invalid.length > 0 || !name.trim()}>
              {busy ? "Saving…" : isNew ? "Create flow" : "Save flow"}
            </button>
            <Link href={`/songs/${id}`} className="linkbtn">Cancel</Link>
            {!isNew &&
              (confirmDelete ? (
                <span>
                  Delete this flow?{" "}
                  <button type="button" className="linkbtn danger" onClick={remove} disabled={busy}>Yes, delete</button>{" "}
                  <button type="button" className="linkbtn" onClick={() => setConfirmDelete(false)}>No</button>
                </span>
              ) : (
                <button type="button" className="linkbtn danger" onClick={() => setConfirmDelete(true)}>Delete flow</button>
              ))}
          </div>
        </div>

        <div className="card">
          <h4>Preview</h4>
          <ArrangementView songId={song.id} steps={parsed.steps} compact />
        </div>
      </div>
    </main>
  );
}

/** "+ Section from another song": search the library, then pick one of its sections. */
function RemixPicker({
  excludeId,
  onPick,
}: {
  excludeId: number;
  onPick: (songId: number, title: string, section: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SongListItem[]>([]);
  const [picked, setPicked] = useState<SongDetail | null>(null);

  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const h = setTimeout(() => {
      fetchSongs({ search: q })
        .then((d) => setResults(d.results.filter((s) => s.id !== excludeId).slice(0, 6)))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(h);
  }, [q, excludeId]);

  if (!open) {
    return (
      <button type="button" className="linkbtn remix-open" onClick={() => setOpen(true)}>
        + Section from another song (remix)
      </button>
    );
  }
  return (
    <div className="remix-picker">
      {picked ? (
        <>
          <div>
            Sections of <strong>{picked.title}</strong>{" "}
            <button type="button" className="linkbtn" onClick={() => setPicked(null)}>change song</button>
          </div>
          <div className="palette">
            {songSections(picked).length === 0 && <span className="muted">This song has no lyrics yet.</span>}
            {songSections(picked).map((s) => (
              <button key={s.id} type="button" className="chip remix" onClick={() => onPick(picked.id, picked.title, s.id)} title={s.lines.join("\n")}>
                {s.label}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search for the other song…" autoFocus />
          <ul className="add-results">
            {results.map((s) => (
              <li key={s.id}>
                <span>{s.title}</span>
                <button type="button" className="linkbtn" onClick={() => fetchSong(s.id).then(setPicked)}>choose</button>
              </li>
            ))}
          </ul>
        </>
      )}
      <button type="button" className="linkbtn" onClick={() => { setOpen(false); setPicked(null); setQ(""); }}>
        Done
      </button>
    </div>
  );
}
