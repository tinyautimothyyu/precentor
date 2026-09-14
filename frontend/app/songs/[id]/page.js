"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { fetchSong, downloadSheet } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function SongDetail({ params }) {
  const { id } = use(params);
  const { user, isApproved, isLeader, ownsTeam } = useAuth();
  const [song, setSong] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    fetchSong(id)
      .then(setSong)
      .catch(() => setError("Song not found."));
  }, [id]);

  async function onDownload(sheet) {
    setNotice(null);
    try {
      await downloadSheet(sheet.id, `${song.title} - ${sheet.type}.pdf`);
    } catch (err) {
      setNotice(err.message);
    }
  }

  if (error) {
    return (
      <main className="container">
        <Link href="/" className="back">← Back to library</Link>
        <p className="muted">{error}</p>
      </main>
    );
  }
  if (!song) {
    return (
      <main className="container">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  const ownsSong = ownsTeam(song.owner_team);

  return (
    <main className="container detail">
      <Link href="/" className="back">← Back to library</Link>

      <div className="detail-head">
        <h2>{song.title}</h2>
        {isLeader && (
          <Link href={`/songs/${song.id}/edit`} className="header-link">
            {ownsSong ? "Edit" : "Add sheet / translation"}
          </Link>
        )}
      </div>
      {song.alternate_titles?.length > 0 && (
        <p className="muted">Also: {song.alternate_titles.join(", ")}</p>
      )}
      <p className="muted">
        {song.default_key && <>Key {song.default_key} · </>}
        {song.tempo && <>{song.tempo} bpm · </>}
        {song.copyright_holder} · CCLI {song.ccli_number}
      </p>
      <div className="tags">
        {song.tags.map((t) => (
          <span key={t.id} className="tag">
            {t.category_display}: {t.name}
          </span>
        ))}
      </div>

      {notice && <div className="msg error" style={{ marginTop: 16 }}>{notice}</div>}

      <section className="section">
        <h4>Sheet music</h4>
        {song.sheets.length === 0 ? (
          <p className="muted">No sheet files uploaded yet.</p>
        ) : (
          <table className="sheets">
            <thead>
              <tr><th>Format</th><th>Key</th><th>Source</th><th></th></tr>
            </thead>
            <tbody>
              {song.sheets.map((sh) => (
                <tr key={sh.id}>
                  <td>{sh.type_display}</td>
                  <td>{sh.key || "—"}</td>
                  <td>{sh.source}</td>
                  <td>
                    {!sh.has_file ? (
                      "—"
                    ) : isApproved ? (
                      <button className="linkbtn" onClick={() => onDownload(sh)}>
                        download
                      </button>
                    ) : (
                      <Link href="/login">log in to download</Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="section">
        <h4>Lyrics</h4>
        {song.lyrics.length === 0 ? (
          <p className="muted">No lyrics entered yet.</p>
        ) : (
          song.lyrics.map((ly) => (
            <div key={ly.id} style={{ marginBottom: 20 }}>
              <div className="lyric-lang">
                {ly.language}
                <span className="status">{ly.status_display}</span>
              </div>
              {(ly.segments || []).map((seg, i) => (
                <div key={i} className="segment">
                  <div className="seg-type">{seg.segment_type}</div>
                  <div className="lines">{(seg.lines || []).join("\n")}</div>
                </div>
              ))}
            </div>
          ))
        )}
      </section>

      {song.alignments?.length > 0 && (
        <section className="section">
          <h4>Bilingual alignment</h4>
          {song.alignments.map((a) => (
            <p key={a.id} className="muted">
              {a.primary_language} ↔ {a.secondary_language} ·{" "}
              {a.line_pairing.length} line pairs confirmed
            </p>
          ))}
        </section>
      )}
    </main>
  );
}
