"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createSong, fetchTags } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const EMPTY = {
  title: "",
  ccli_number: "",
  copyright_holder: "",
  licensing_notes: "",
  default_key: "",
  tempo: "",
  tags: [],
};

export default function NewSongPage() {
  const { isLeader, loading } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState(EMPTY);
  const [tags, setTags] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchTags().then((d) => setTags(d.results || [])).catch(() => {});
  }, []);

  if (!loading && !isLeader) {
    return (
      <main className="container narrow">
        <div className="card">
          <h2>Leaders only</h2>
          <p className="muted">
            You need an approved leader account to add songs.{" "}
            <Link href="/login">Log in</Link>
          </p>
        </div>
      </main>
    );
  }

  function set(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function toggleTag(id) {
    setForm((f) => ({
      ...f,
      tags: f.tags.includes(id) ? f.tags.filter((t) => t !== id) : [...f.tags, id],
    }));
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const payload = {
        title: form.title,
        ccli_number: form.ccli_number,
        copyright_holder: form.copyright_holder,
        licensing_notes: form.licensing_notes,
        default_key: form.default_key,
        tags: form.tags,
      };
      if (form.tempo) payload.tempo = Number(form.tempo);
      const song = await createSong(payload);
      router.push(`/songs/${song.id}/edit`);
    } catch (err) {
      setError(err.data ? JSON.stringify(err.data) : err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="container narrow">
      <Link href="/" className="back">← Back to library</Link>
      <div className="card">
        <h2>Add a song</h2>
        <form onSubmit={onSubmit}>
          {error && <div className="msg error">{error}</div>}
          <label>
            Title *
            <input value={form.title} onChange={(e) => set("title", e.target.value)} required />
          </label>
          <label>
            CCLI number * <span className="muted">(or "Public Domain")</span>
            <input value={form.ccli_number} onChange={(e) => set("ccli_number", e.target.value)} required />
          </label>
          <label>
            Copyright holder *
            <input value={form.copyright_holder} onChange={(e) => set("copyright_holder", e.target.value)} required />
          </label>
          <label>
            Licensing notes
            <input value={form.licensing_notes} onChange={(e) => set("licensing_notes", e.target.value)} />
          </label>
          <div className="row">
            <label>
              Default key
              <input value={form.default_key} onChange={(e) => set("default_key", e.target.value)} placeholder="e.g. G" />
            </label>
            <label>
              Tempo (bpm)
              <input type="number" value={form.tempo} onChange={(e) => set("tempo", e.target.value)} />
            </label>
          </div>
          <label>Tags</label>
          <div className="tag-picker">
            {tags.map((t) => (
              <button
                type="button"
                key={t.id}
                className={`chip ${form.tags.includes(t.id) ? "on" : ""}`}
                onClick={() => toggleTag(t.id)}
              >
                {t.category_display}: {t.name}
              </button>
            ))}
          </div>
          <button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Create song"}
          </button>
        </form>
      </div>
    </main>
  );
}
