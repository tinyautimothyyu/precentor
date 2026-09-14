"use client";

import { use, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  addServiceSong,
  deleteService,
  fetchService,
  fetchSongs,
  removeServiceSong,
  reorderService,
  spotifyEmbedUrl,
  updateService,
  watchVideosUrl,
  youtubeVideoId,
  type ApiError,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { ServiceDetail, ServiceSongItem, SongListItem } from "@/lib/types";

function TrackEmbed({ url }: { url: string }) {
  const yt = youtubeVideoId(url);
  if (yt) {
    return (
      <div className="embed">
        <iframe
          src={`https://www.youtube.com/embed/${yt}`}
          title="YouTube reference"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }
  const sp = spotifyEmbedUrl(url);
  if (sp) {
    return (
      <div className="embed embed-spotify">
        <iframe src={sp} title="Spotify reference" allow="encrypted-media" />
      </div>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="header-link">
      Open reference ↗
    </a>
  );
}

export default function ServiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { user, loading, isApproved, isLeader, ownsTeam } = useAuth();
  const router = useRouter();
  const [service, setService] = useState<ServiceDetail | null>(null);
  const [current, setCurrent] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // song search (add)
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SongListItem[]>([]);

  const reload = () => fetchService(id).then(setService);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    setReady(true);
  }, [loading, user, router]);

  useEffect(() => {
    if (!ready || !isApproved) return;
    fetchService(id)
      .then(setService)
      .catch(() => setErr("Service not found."));
  }, [ready, isApproved, id]);

  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const h = setTimeout(() => {
      fetchSongs({ search: q })
        .then((d) => setResults(d.results))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(h);
  }, [q]);

  if (!ready || (!service && !err)) {
    return (
      <main className="container">
        <p className="muted">Loading…</p>
      </main>
    );
  }
  if (!isApproved) {
    return (
      <main className="container narrow">
        <div className="card">
          <h2>Pending approval</h2>
          <p className="muted">Your account is awaiting approval.</p>
        </div>
      </main>
    );
  }
  if (err || !service) {
    return (
      <main className="container">
        <Link href="/services" className="back">← Back to services</Link>
        <p className="muted">{err}</p>
      </main>
    );
  }

  const canManage = isLeader && ownsTeam(service.team);
  const items = service.items;
  const currentItem: ServiceSongItem | undefined = items[current];
  const ytIds = items
    .map((it) => youtubeVideoId(it.song_detail.reference_url))
    .filter((v): v is string => !!v);

  function reportError(e: unknown) {
    const e2 = e as ApiError;
    setErr(e2.data ? JSON.stringify(e2.data) : e2.message);
  }

  async function addSong(songId: number) {
    setErr(null);
    try {
      await addServiceSong({ service: Number(id), song: songId });
      setQ("");
      setResults([]);
      reload();
    } catch (e) {
      reportError(e);
    }
  }

  async function removeItem(itemId: number) {
    setErr(null);
    try {
      await removeServiceSong(itemId);
      reload();
    } catch (e) {
      reportError(e);
    }
  }

  async function move(index: number, delta: number) {
    if (!service) return;
    const next = index + delta;
    if (next < 0 || next >= items.length) return;
    const order = items.map((it) => it.id);
    [order[index], order[next]] = [order[next], order[index]];
    setErr(null);
    try {
      const updated = await reorderService(id, order);
      setService(updated);
    } catch (e) {
      reportError(e);
    }
  }

  async function onDelete() {
    setErr(null);
    try {
      await deleteService(id);
      router.push("/services");
    } catch (e) {
      reportError(e);
    }
  }

  return (
    <main className="container detail">
      <Link href="/services" className="back">← Back to services</Link>

      <div className="detail-head">
        <div>
          <h2>{service.title || "Service"}</h2>
          <p className="muted">
            {service.date} · {service.team_name} · {items.length} songs
          </p>
        </div>
        {ytIds.length > 0 && (
          <a
            href={watchVideosUrl(ytIds)}
            target="_blank"
            rel="noreferrer"
            className="header-link"
          >
            ▶ Play all on YouTube
          </a>
        )}
      </div>

      {err && <div className="msg error">{err}</div>}

      {items.length === 0 ? (
        <p className="muted">No songs in this service yet.</p>
      ) : (
        <>
          <section className="section">
            <h4>Now playing</h4>
            {currentItem ? (
              <>
                <div className="nowplaying">
                  <strong>{currentItem.song_detail.title}</strong>
                  <span className="muted">
                    {" "}
                    · key {currentItem.key_override || currentItem.song_detail.default_key || "—"}
                  </span>
                </div>
                {currentItem.song_detail.reference_url ? (
                  <TrackEmbed url={currentItem.song_detail.reference_url} />
                ) : (
                  <p className="muted">No reference track for this song.</p>
                )}
                <div className="player-controls">
                  <button
                    className="linkbtn"
                    onClick={() => setCurrent((c) => Math.max(0, c - 1))}
                    disabled={current === 0}
                  >
                    ← Prev
                  </button>
                  <span className="muted">
                    {current + 1} / {items.length}
                  </span>
                  <button
                    className="linkbtn"
                    onClick={() => setCurrent((c) => Math.min(items.length - 1, c + 1))}
                    disabled={current === items.length - 1}
                  >
                    Next →
                  </button>
                </div>
              </>
            ) : null}
          </section>

          <section className="section">
            <h4>Set list</h4>
            <ol className="setlist">
              {items.map((it, i) => (
                <li key={it.id} className={i === current ? "on" : ""}>
                  <button className="setlist-title" onClick={() => setCurrent(i)}>
                    {it.song_detail.title}
                    {!it.song_detail.reference_url && (
                      <span className="muted"> (no track)</span>
                    )}
                  </button>
                  {canManage && (
                    <span className="setlist-actions">
                      <button className="linkbtn" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
                      <button className="linkbtn" onClick={() => move(i, 1)} disabled={i === items.length - 1}>↓</button>
                      <button className="linkbtn" onClick={() => removeItem(it.id)}>remove</button>
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </section>
        </>
      )}

      {canManage && (
        <>
          <section className="section">
            <h4>Add a song</h4>
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search the library…"
            />
            {results.length > 0 && (
              <ul className="add-results">
                {results.map((s) => (
                  <li key={s.id}>
                    <span>{s.title}</span>
                    <button className="linkbtn" onClick={() => addSong(s.id)}>add</button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <ServiceMeta service={service} onSaved={reload} onDelete={onDelete} />
        </>
      )}
    </main>
  );
}

function ServiceMeta({
  service,
  onSaved,
  onDelete,
}: {
  service: ServiceDetail;
  onSaved: () => void;
  onDelete: () => void;
}) {
  const [date, setDate] = useState(service.date);
  const [title, setTitle] = useState(service.title);
  const [notes, setNotes] = useState(service.notes);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
    try {
      await updateService(service.id, { date, title, notes });
      setMsg("Saved.");
      onSaved();
    } catch (e2) {
      const ae = e2 as ApiError;
      setErr(ae.data ? JSON.stringify(ae.data) : ae.message);
    }
  }

  return (
    <div className="card">
      <h4>Service details</h4>
      {msg && <div className="msg success">{msg}</div>}
      {err && <div className="msg error">{err}</div>}
      <form onSubmit={save}>
        <div className="row">
          <label>Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
          <label>Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
        </div>
        <label>Notes
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <button type="submit">Save details</button>
      </form>
      <p style={{ marginTop: 14 }}>
        <button className="linkbtn danger" onClick={onDelete}>
          Delete this service
        </button>
      </p>
    </div>
  );
}
