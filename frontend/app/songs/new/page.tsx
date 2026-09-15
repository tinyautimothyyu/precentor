"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createSong, fetchTags, type ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Tag } from "@/lib/types";
import YouTubePicker from "@/app/components/YouTubePicker";

interface FormState {
  title: string;
  ccli_number: string;
  copyright_holder: string;
  licensing_notes: string;
  default_key: string;
  tempo: string;
  reference_url: string;
  tags: number[];
}

const EMPTY: FormState = {
  title: "",
  ccli_number: "",
  copyright_holder: "",
  licensing_notes: "",
  default_key: "",
  tempo: "",
  reference_url: "",
  tags: [],
};

export default function NewSongPage() {
  const { isLeader, loading } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [tags, setTags] = useState<Tag[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchTags()
      .then((d) => setTags(d.results))
      .catch(() => {});
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

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function toggleTag(id: number) {
    setForm((f) => ({
      ...f,
      tags: f.tags.includes(id) ? f.tags.filter((t) => t !== id) : [...f.tags, id],
    }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        title: form.title,
        ccli_number: form.ccli_number,
        copyright_holder: form.copyright_holder,
        licensing_notes: form.licensing_notes,
        default_key: form.default_key,
        reference_url: form.reference_url,
        tags: form.tags,
      };
      if (form.tempo) payload.tempo = Number(form.tempo);
      const song = await createSong(payload);
      router.push(`/songs/${song.id}/edit`);
    } catch (err) {
      const e2 = err as ApiError;
      setError(e2.data ? JSON.stringify(e2.data) : e2.message);
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
            CCLI number * <span className="muted">(or &quot;Public Domain&quot;)</span>
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
          <label>
            Reference URL <span className="muted">(YouTube/Spotify/any link)</span>
            <input
              value={form.reference_url}
              onChange={(e) => set("reference_url", e.target.value)}
              placeholder="https://…"
            />
          </label>
          <YouTubePicker onPick={(url) => set("reference_url", url)} />
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
