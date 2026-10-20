"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { fetchSong, downloadSheet } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { SheetFile, SongDetail } from "@/lib/types";
import SheetUsage from "@/app/components/SheetUsage";
import ArrangementView from "@/app/components/ArrangementView";
import { stepsToShorthand } from "@/lib/lyrics";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function SongDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { user, isApproved, isLeader, ownsTeam } = useAuth();
  const [song, setSong] = useState<SongDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = () =>
    fetchSong(id)
      .then(setSong)
      .catch(() => setError("Song not found."));

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function onDownload(sheet: SheetFile) {
    setNotice(null);
    try {
      await downloadSheet(sheet.id, `${song?.title} - ${sheet.type_display}`);
      reload(); // refresh the download count
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Download failed.");
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
      {song.english_title && <p className="subtitle detail-subtitle">{song.english_title}</p>}
      {song.alternate_titles.length > 0 && (
        <p className="muted">Also: {song.alternate_titles.join(", ")}</p>
      )}
      <p className="owner-line">
        {song.owner_team_name ? (
          <>
            Owned by <strong>{song.owner_team_name}</strong>
            {song.owner_congregation_name && (
              <span className="muted"> ({song.owner_congregation_name})</span>
            )}
          </>
        ) : (
          <span className="muted">Shared library (admin)</span>
        )}
      </p>
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
      {song.reference_url && (
        <p style={{ marginTop: 12 }}>
          <a href={song.reference_url} target="_blank" rel="noreferrer">
            Listen ↗
          </a>
        </p>
      )}

      {notice && (
        <div className="msg error" style={{ marginTop: 16 }}>
          {notice}
        </div>
      )}

      <section className="section">
        <h4>Sheet music</h4>
        {song.sheets.length === 0 ? (
          <p className="muted">No sheet files uploaded yet.</p>
        ) : (
          <div className="table-scroll">
          <table className="sheets">
            <thead>
              <tr>
                <th>Format</th>
                <th>Key</th>
                <th>File</th>
                <th>Uploaded by</th>
                <th>Date</th>
                <th>Use</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {song.sheets.map((sh) => (
                <tr key={sh.id}>
                  <td>
                    {sh.type_display}
                    <div className="sheet-sub">{sh.source}</div>
                  </td>
                  <td>{sh.key || "—"}</td>
                  <td className="sheet-file" title={sh.filename ?? undefined}>
                    {sh.filename || "—"}
                    {sh.upload_reason && (
                      <div className="sheet-sub sheet-reason" title={sh.upload_reason}>
                        Why this version: {sh.upload_reason}
                      </div>
                    )}
                  </td>
                  <td>
                    {sh.uploaded_by_name ?? (
                      sh.owner_team_name ? null : <span className="muted">—</span>
                    )}
                    {sh.owner_team_name && (
                      <div className={sh.uploaded_by_name ? "sheet-sub" : undefined}>
                        {sh.owner_team_name}
                      </div>
                    )}
                  </td>
                  <td className="nowrap">{formatDate(sh.uploaded_at)}</td>
                  <td>
                    <SheetUsage
                      sheet={sh}
                      myTeam={user?.team ?? null}
                      canPrefer={isLeader}
                      onChanged={reload}
                    />
                  </td>
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
          </div>
        )}
      </section>

      <LyricsSection
        song={song}
        myTeam={user?.team ?? null}
        isLeader={isLeader}
        ownsTeam={ownsTeam}
      />

      {song.alignments.length > 0 && (
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

function LyricsSection({
  song,
  myTeam,
  isLeader,
  ownsTeam,
}: {
  song: SongDetail;
  myTeam: number | null;
  isLeader: boolean;
  ownsTeam: (teamId: number | null) => boolean;
}) {
  // Start on the viewer's team default flow, if they have one.
  const [flowId, setFlowId] = useState<number | null>(
    () => song.flows.find((f) => f.owner_team === myTeam && f.is_default)?.id ?? null
  );
  const flow = song.flows.find((f) => f.id === flowId) ?? null;

  return (
    <section className="section">
      <div className="section-head">
        <h4>Lyrics</h4>
        {isLeader && song.lyrics.length > 0 && (
          <Link href={`/songs/${song.id}/flows/new`} className="linkbtn">
            + New flow
          </Link>
        )}
      </div>
      {song.lyrics.length > 0 && (
        <p className="muted lyric-langs">
          {song.lyrics.map((l) => `${l.language} (${l.status_display})`).join(" · ")}
        </p>
      )}
      {song.flows.length > 0 && (
        <div className="flow-picker">
          <label>
            Flow
            <select
              value={flowId ?? ""}
              onChange={(e) => setFlowId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Sections in written order</option>
              {song.flows.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.owner_team_name} — {f.name}
                  {f.is_default ? " ★" : ""}
                </option>
              ))}
            </select>
          </label>
          {flow && <code className="flow-code">{stepsToShorthand(flow.steps)}</code>}
          {flow && ownsTeam(flow.owner_team) && (
            <Link href={`/songs/${song.id}/flows/${flow.id}`} className="linkbtn">
              Edit flow
            </Link>
          )}
        </div>
      )}
      <ArrangementView songId={song.id} flowId={flowId} />
    </section>
  );
}
