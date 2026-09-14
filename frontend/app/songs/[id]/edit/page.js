"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  createLyrics,
  deleteSheet,
  fetchSong,
  updateSong,
  uploadSheet,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";

const SHEET_TYPES = [
  ["chord_chart", "Chord chart"],
  ["lead_sheet", "Lead sheet"],
  ["piano_score", "Piano score"],
  ["hymnal", "Hymnal"],
  ["vocal_only", "Vocal only"],
];
const SOURCES = [
  ["purchased", "Purchased"],
  ["transcribed", "Transcribed"],
  ["arranged", "Arranged"],
];

export default function EditSongPage({ params }) {
  const { id } = use(params);
  const { user, isLeader, ownsTeam, loading } = useAuth();
  const router = useRouter();
  const [song, setSong] = useState(null);
  const [meta, setMeta] = useState(null);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  // sheet upload form
  const [sheet, setSheet] = useState({ type: "chord_chart", key: "", source: "transcribed", file: null });
  // lyric form
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
          licensing_notes: s.licensing_notes || "",
          default_key: s.default_key || "",
          tempo: s.tempo || "",
        });
      })
      .catch(() => setErr("Song not found."));
  }, [id]);

  if (loading || !song) {
    return <main className="container"><p className="muted">Loading…</p></main>;
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

  async function saveMeta(e) {
    e.preventDefault();
    setErr(null); setMsg(null);
    try {
      const payload = { ...meta };
      payload.tempo = meta.tempo ? Number(meta.tempo) : null;
      await updateSong(id, payload);
      setMsg("Song details saved.");
      reload();
    } catch (e2) {
      setErr(e2.data ? JSON.stringify(e2.data) : e2.message);
    }
  }

  async function addSheet(e) {
    e.preventDefault();
    setErr(null); setMsg(null);
    if (!sheet.file) { setErr("Choose a file."); return; }
    try {
      const fd = new FormData();
      fd.append("song", id);
      fd.append("type", sheet.type);
      fd.append("key", sheet.key);
      fd.append("source", sheet.source);
      fd.append("file", sheet.file);
      await uploadSheet(fd);
      setSheet({ type: "chord_chart", key: "", source: "transcribed", file: null });
      e.target.reset();
      setMsg("Sheet uploaded.");
      reload();
    } catch (e2) {
      setErr(e2.data ? JSON.stringify(e2.data) : e2.message);
    }
  }

  async function removeSheet(sid) {
    setErr(null); setMsg(null);
    try {
      await deleteSheet(sid);
      setMsg("Sheet removed.");
      reload();
    } catch (e2) {
      setErr(e2.message);
    }
  }

  async function addLyric(e) {
    e.preventDefault();
    setErr(null); setMsg(null);
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
      setErr(e2.data ? JSON.stringify(e2.data) : e2.message);
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
            <input type="file" onChange={(e) => setSheet({ ...sheet, file: e.target.files[0] })} required />
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
