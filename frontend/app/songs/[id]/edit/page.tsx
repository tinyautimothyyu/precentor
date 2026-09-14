"use client";

import { use, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  createLyrics,
  deleteSheet,
  fetchSong,
  updateSong,
  uploadSheet,
  type ApiError,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { SongDetail } from "@/lib/types";
import YouTubePicker from "@/app/components/YouTubePicker";

const SHEET_TYPES: [string, string][] = [
  ["chord_chart", "Chord chart"],
  ["lead_sheet", "Lead sheet"],
  ["piano_score", "Piano score"],
  ["hymnal", "Hymnal"],
  ["vocal_only", "Vocal only"],
];
const SOURCES: [string, string][] = [
  ["purchased", "Purchased"],
  ["transcribed", "Transcribed"],
  ["arranged", "Arranged"],
];

interface MetaState {
  title: string;
  ccli_number: string;
  copyright_holder: string;
  default_key: string;
  tempo: string;
  reference_url: string;
}

interface SheetState {
  type: string;
  key: string;
  source: string;
  file: File | null;
}

export default function EditSongPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { user, isLeader, ownsTeam, loading } = useAuth();
  const [song, setSong] = useState<SongDetail | null>(null);
  const [meta, setMeta] = useState<MetaState | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [sheet, setSheet] = useState<SheetState>({
    type: "chord_chart",
    key: "",
    source: "transcribed",
    file: null,
  });
  const [lyric, setLyric] = useState({ language: "", text: "" });

  const reload = () => fetchSong(id).then(setSong);

  useEffect(() => {
    fetchSong(id)
      .then((s) => {
        setSong(s);
        setMeta({
          title: s.title,
          ccli_number: s.ccli_number,
          copyright_holder: s.copyright_holder,
          default_key: s.default_key || "",
          tempo: s.tempo ? String(s.tempo) : "",
          reference_url: s.reference_url || "",
        });
      })
      .catch(() => setErr("Song not found."));
  }, [id]);

  if (loading || !song || !meta) {
    return (
      <main className="container">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  const ownsSong = ownsTeam(song.owner_team);
  if (!isLeader) {
    return (
      <main className="container narrow">
        <div className="card">
          <h2>Leaders only</h2>
          <p className="muted">
            You need an approved leader account to add or edit content.{" "}
            {!user && <Link href="/login">Log in</Link>}
          </p>
          <Link href={`/songs/${id}`}>← Back to song</Link>
        </div>
      </main>
    );
  }

  function reportError(e: unknown) {
    const e2 = e as ApiError;
    setErr(e2.data ? JSON.stringify(e2.data) : e2.message);
  }

  async function saveMeta(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    if (!meta) return;
    try {
      await updateSong(id, {
        ...meta,
        tempo: meta.tempo ? Number(meta.tempo) : null,
      });
      setMsg("Song details saved.");
      reload();
    } catch (e2) {
      reportError(e2);
    }
  }

  async function addSheet(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    if (!sheet.file) {
      setErr("Choose a file.");
      return;
    }
    try {
      const fd = new FormData();
      fd.append("song", id);
      fd.append("type", sheet.type);
      fd.append("key", sheet.key);
      fd.append("source", sheet.source);
      fd.append("file", sheet.file);
      await uploadSheet(fd);
      setSheet({ type: "chord_chart", key: "", source: "transcribed", file: null });
      (e.target as HTMLFormElement).reset();
      setMsg("Sheet uploaded.");
      reload();
    } catch (e2) {
      reportError(e2);
    }
  }

  async function removeSheet(sid: number) {
    setErr(null);
    setMsg(null);
    try {
      await deleteSheet(sid);
      setMsg("Sheet removed.");
      reload();
    } catch (e2) {
      reportError(e2);
    }
  }

  async function addLyric(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    try {
      const segments = [
        {
          segment_type: "verse1",
          lines: lyric.text.split("\n").filter((l) => l.trim() !== ""),
        },
      ];
      await createLyrics({ song: Number(id), language: lyric.language, segments });
      setLyric({ language: "", text: "" });
      setMsg("Lyrics added.");
      reload();
    } catch (e2) {
      reportError(e2);
    }
  }

  return (
    <main className="container narrow">
      <Link href={`/songs/${id}`} className="back">← Back to song</Link>
      <h2 style={{ marginBottom: 8 }}>Edit: {song.title}</h2>
      {msg && <div className="msg success">{msg}</div>}
      {err && <div className="msg error">{err}</div>}

      {ownsSong ? (
        <div className="card">
          <h4>Song details</h4>
          <form onSubmit={saveMeta}>
            <label>Title
              <input value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} required />
            </label>
            <label>CCLI number
              <input value={meta.ccli_number} onChange={(e) => setMeta({ ...meta, ccli_number: e.target.value })} required />
            </label>
            <label>Copyright holder
              <input value={meta.copyright_holder} onChange={(e) => setMeta({ ...meta, copyright_holder: e.target.value })} required />
            </label>
            <div className="row">
              <label>Default key
                <input value={meta.default_key} onChange={(e) => setMeta({ ...meta, default_key: e.target.value })} />
              </label>
              <label>Tempo
                <input type="number" value={meta.tempo} onChange={(e) => setMeta({ ...meta, tempo: e.target.value })} />
              </label>
            </div>
            <label>Reference URL <span className="muted">(YouTube/Spotify/any link)</span>
              <input
                value={meta.reference_url}
                onChange={(e) => setMeta({ ...meta, reference_url: e.target.value })}
                placeholder="https://…"
              />
            </label>
            <YouTubePicker onPick={(url) => setMeta({ ...meta, reference_url: url })} />
            <button type="submit">Save details</button>
          </form>
        </div>
      ) : (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            This song is owned by another team, so its core details are read-only
            to you. You can still contribute a sheet or a translation below —
            they&apos;ll be owned by your team.
          </p>
        </div>
      )}

      <div className="card">
        <h4>Sheet music</h4>
        {song.sheets.length > 0 && (
          <table className="sheets" style={{ marginBottom: 14 }}>
            <tbody>
              {song.sheets.map((sh) => (
                <tr key={sh.id}>
                  <td>{sh.type_display}</td>
                  <td>{sh.key || "—"}</td>
                  <td>
                    {ownsTeam(sh.owner_team) ? (
                      <button className="linkbtn" onClick={() => removeSheet(sh.id)}>remove</button>
                    ) : (
                      <span className="muted">other team</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form onSubmit={addSheet}>
          <div className="row">
            <label>Format
              <select value={sheet.type} onChange={(e) => setSheet({ ...sheet, type: e.target.value })}>
                {SHEET_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label>Key
              <input value={sheet.key} onChange={(e) => setSheet({ ...sheet, key: e.target.value })} placeholder="e.g. G" />
            </label>
            <label>Source
              <select value={sheet.source} onChange={(e) => setSheet({ ...sheet, source: e.target.value })}>
                {SOURCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          </div>
          <label>File
            <input
              type="file"
              onChange={(e) => setSheet({ ...sheet, file: e.target.files?.[0] ?? null })}
              required
            />
          </label>
          <button type="submit">Upload sheet</button>
        </form>
      </div>

      <div className="card">
        <h4>Add lyrics / translation</h4>
        <p className="muted" style={{ marginTop: 0 }}>
          A new translation is owned by your team, even on another team&apos;s song.
        </p>
        <form onSubmit={addLyric}>
          <label>Language
            <input value={lyric.language} onChange={(e) => setLyric({ ...lyric, language: e.target.value })} placeholder="e.g. English, Chinese" required />
          </label>
          <label>Lyrics (one line per line)
            <textarea rows={6} value={lyric.text} onChange={(e) => setLyric({ ...lyric, text: e.target.value })} required />
          </label>
          <button type="submit">Add lyrics</button>
        </form>
      </div>
    </main>
  );
}
