"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchSongs, fetchTags } from "@/lib/api";

export default function LibraryPage() {
  const [songs, setSongs] = useState([]);
  const [tags, setTags] = useState([]);
  const [search, setSearch] = useState("");
  const [language, setLanguage] = useState("");
  const [tag, setTag] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Load the tag vocabulary once for the filter dropdown.
  useEffect(() => {
    fetchTags().then((d) => setTags(d.results || [])).catch(() => {});
  }, []);

  // Re-query whenever a filter changes (debounced for the search box).
  useEffect(() => {
    const handle = setTimeout(() => {
      setLoading(true);
      setError(null);
      fetchSongs({ search, language, tag })
        .then((d) => setSongs(d.results || []))
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(handle);
  }, [search, language, tag]);

  const languages = Array.from(
    new Set(tags.filter((t) => t.category === "language").map((t) => t.name))
  );

  return (
    <main className="container">
      <div className="controls">
        <input
          type="search"
          placeholder="Search by title or CCLI…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">All tags</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.category_display}: {t.name}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Language (e.g. English)"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          list="langs"
        />
        <datalist id="langs">
          {languages.map((l) => (
            <option key={l} value={l} />
          ))}
        </datalist>
      </div>

      {error && <p className="muted">Could not load songs: {error}</p>}
      {loading ? (
        <p className="muted">Loading…</p>
      ) : songs.length === 0 ? (
        <p className="muted">No songs match those filters.</p>
      ) : (
        <div className="song-grid">
          {songs.map((s) => (
            <Link key={s.id} href={`/songs/${s.id}`} className="card">
              <h3>{s.title}</h3>
              <div className="meta">
                {s.default_key && <>Key {s.default_key} · </>}
                {s.languages.join(", ") || "No lyrics yet"}
                {s.ccli_number && <> · CCLI {s.ccli_number}</>}
              </div>
              <div className="tags">
                {s.tags.slice(0, 4).map((t) => (
                  <span key={t.id} className="tag">
                    {t.name}
                  </span>
                ))}
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
