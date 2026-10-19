"use client";

import { use, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  addServiceSong,
  deleteService,
  downloadSheet,
  fetchService,
  fetchSongs,
  removeServiceSong,
  reorderService,
  spotifyEmbedUrl,
  updateService,
  updateServiceSong,
  updateSong,
  watchVideosUrl,
  youtubeVideoId,
  type ApiError,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  SHEET_TYPES,
  type ServiceDetail,
  type ServiceSongItem,
  type SongListItem,
} from "@/lib/types";
import YouTubePicker from "@/app/components/YouTubePicker";

function errorText(e: unknown): string {
  const ae = e as ApiError;
  return ae.data ? JSON.stringify(ae.data) : ae.message;
}

function sheetTypeLabel(type: string): string {
  return SHEET_TYPES.find(([v]) => v === type)?.[1] ?? type;
}

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
  // set-list item whose track/key/format editor is open
  const [editingId, setEditingId] = useState<number | null>(null);

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
  const currentIndex = Math.min(current, Math.max(items.length - 1, 0));
  const currentItem: ServiceSongItem | undefined = items[currentIndex];
  const ytIds = items
    .map((it) => youtubeVideoId(it.reference_url))
    .filter((v): v is string => !!v);

  function reportError(e: unknown) {
    setErr(errorText(e));
  }

  async function addSong(songId: number) {
    setErr(null);
    try {
      const item = await addServiceSong({ service: Number(id), song: songId });
      setQ("");
      setResults([]);
      await reload();
      // No track yet: open the editor right away so one can be found/pasted.
      if (!item.reference_url) setEditingId(item.id);
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
                    {currentItem.format_override &&
                      ` · ${sheetTypeLabel(currentItem.format_override)}`}
                  </span>
                </div>
                {currentItem.reference_url ? (
                  <TrackEmbed key={currentItem.id} url={currentItem.reference_url} />
                ) : (
                  <p className="muted">No reference track for this song.</p>
                )}
                <SheetLinks item={currentItem} />
                <div className="player-controls">
                  <button
                    className="linkbtn"
                    onClick={() => setCurrent(Math.max(0, currentIndex - 1))}
                    disabled={currentIndex === 0}
                  >
                    ← Prev
                  </button>
                  <span className="muted">
                    {currentIndex + 1} / {items.length}
                  </span>
                  <button
                    className="linkbtn"
                    onClick={() => setCurrent(Math.min(items.length - 1, currentIndex + 1))}
                    disabled={currentIndex === items.length - 1}
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
                <li key={it.id} className={i === currentIndex ? "on" : ""}>
                  <button className="setlist-title" onClick={() => setCurrent(i)}>
                    {it.song_detail.title}
                    <span className="setlist-meta">
                      {it.key_override && ` · key ${it.key_override}`}
                      {it.format_override && ` · ${sheetTypeLabel(it.format_override)}`}
                      {!it.reference_url
                        ? " · no track"
                        : it.reference_url_override && " · custom track"}
                    </span>
                  </button>
                  {canManage && (
                    <span className="setlist-actions">
                      <button
                        className="linkbtn"
                        onClick={() => setEditingId(editingId === it.id ? null : it.id)}
                      >
                        {it.reference_url ? "edit" : "add track"}
                      </button>
                      <button className="linkbtn" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
                      <button className="linkbtn" onClick={() => move(i, 1)} disabled={i === items.length - 1}>↓</button>
                      <button className="linkbtn" onClick={() => removeItem(it.id)}>remove</button>
                    </span>
                  )}
                  {canManage && editingId === it.id && (
                    <ItemEditor
                      item={it}
                      canSetSongDefault={ownsTeam(it.song_detail.owner_team)}
                      onCancel={() => setEditingId(null)}
                      onSaved={async () => {
                        setEditingId(null);
                        setCurrent(i);
                        await reload();
                      }}
                    />
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
      setErr(errorText(e2));
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

function SheetLinks({ item }: { item: ServiceSongItem }) {
  const [msg, setMsg] = useState<string | null>(null);
  const preferred = item.format_override;
  const sheets = item.song_detail.sheets
    .filter((s) => s.has_file)
    // The service's chosen format first.
    .sort((a, b) => Number(b.type === preferred) - Number(a.type === preferred));
  const missingPreferred = !!preferred && !sheets.some((s) => s.type === preferred);

  if (sheets.length === 0 && !missingPreferred) return null;

  async function download(sheetId: number, label: string) {
    setMsg(null);
    try {
      await downloadSheet(sheetId, `${item.song_detail.title} - ${label}.pdf`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Download failed.");
    }
  }

  return (
    <div className="sheet-links">
      <span className="muted">Sheets:</span>
      {sheets.map((s) => (
        <button
          key={s.id}
          className={s.type === preferred ? "linkbtn preferred" : "linkbtn"}
          onClick={() => download(s.id, s.type_display)}
        >
          {s.type_display}
          {s.key && ` (${s.key})`}
          {s.type === preferred && " ★"}
        </button>
      ))}
      {missingPreferred && (
        <span className="muted">No {sheetTypeLabel(preferred)} uploaded for this song.</span>
      )}
      {msg && <span className="error-text">{msg}</span>}
    </div>
  );
}

function ItemEditor({
  item,
  canSetSongDefault,
  onSaved,
  onCancel,
}: {
  item: ServiceSongItem;
  /** The user's team owns the song, so they may change its default track. */
  canSetSongDefault: boolean;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const song = item.song_detail;
  const [url, setUrl] = useState(item.reference_url_override);
  const [key, setKey] = useState(item.key_override);
  const [format, setFormat] = useState(item.format_override);
  const [asSongDefault, setAsSongDefault] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const trimmed = url.trim();
  const ytId = youtubeVideoId(trimmed);
  const playable = !!ytId || !!spotifyEmbedUrl(trimmed);
  const uploaded = new Set(song.sheets.filter((s) => s.has_file).map((s) => s.type));

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const makeDefault = asSongDefault && !!trimmed;
      if (makeDefault) await updateSong(song.id, { reference_url: trimmed });
      await updateServiceSong(item.id, {
        key_override: key.trim(),
        format_override: format,
        // Once it's the song's default, this service no longer needs an override.
        reference_url_override: makeDefault ? "" : trimmed,
      });
      onSaved();
    } catch (e2) {
      setErr(errorText(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="item-editor" onSubmit={save}>
      {err && <div className="msg error">{err}</div>}
      <label>
        Reference track <span className="muted">(this service only)</span>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={
            song.reference_url
              ? `Song default: ${song.reference_url}`
              : "Paste a YouTube or Spotify link"
          }
        />
      </label>
      {trimmed && (
        <p className="hint">
          {ytId
            ? "✓ YouTube video, plays in the app and in Play all."
            : playable
              ? "✓ Spotify, plays in the app."
              : "This link can't play inside the app; it will show as an \"Open reference\" link."}
        </p>
      )}
      {!trimmed && song.reference_url && (
        <p className="hint">Empty = use the song&apos;s default track.</p>
      )}
      <YouTubePicker initialQuery={song.title} onPick={setUrl} />
      {canSetSongDefault && trimmed && trimmed !== song.reference_url && (
        <label className="check">
          <input
            type="checkbox"
            checked={asSongDefault}
            onChange={(e) => setAsSongDefault(e.target.checked)}
          />
          Also make this the song&apos;s default track (used by every service)
        </label>
      )}
      <div className="row">
        <label>
          Key
          <input
            value={key}
            maxLength={10}
            onChange={(e) => setKey(e.target.value)}
            placeholder={song.default_key ? `Default: ${song.default_key}` : "—"}
          />
        </label>
        <label>
          Sheet format
          <select value={format} onChange={(e) => setFormat(e.target.value)}>
            <option value="">No preference</option>
            {SHEET_TYPES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
                {uploaded.has(v) ? "" : " (not uploaded)"}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="editor-actions">
        <button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
        {item.reference_url_override && (
          <button type="button" className="linkbtn" onClick={() => setUrl("")}>
            Clear custom track
          </button>
        )}
        <button type="button" className="linkbtn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
