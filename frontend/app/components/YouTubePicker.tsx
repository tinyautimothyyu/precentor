"use client";

import { useEffect, useState } from "react";
import { fetchConfig, searchYouTube } from "@/lib/api";
import type { YouTubeResult } from "@/lib/types";

/**
 * Optional in-app YouTube search. Renders nothing unless the backend reports
 * `youtube_search: true` (i.e. a YOUTUBE_API_KEY is configured). Clicking a
 * result calls `onPick` with the full watch URL. Manual paste always works
 * independently of this component.
 */
export default function YouTubePicker({
  onPick,
}: {
  onPick: (url: string) => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<YouTubeResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchConfig()
      .then((c) => setEnabled(c.youtube_search))
      .catch(() => setEnabled(false));
  }, []);

  if (!enabled) return null;

  async function onSearch() {
    if (!q.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setResults(await searchYouTube(q));
    } catch {
      setError("Search failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="yt-picker">
      <div className="yt-search-row">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onSearch();
            }
          }}
          placeholder="Search YouTube for a reference track…"
        />
        <button type="button" className="linkbtn" onClick={onSearch} disabled={busy}>
          {busy ? "Searching…" : "Search"}
        </button>
      </div>
      {error && <div className="msg error">{error}</div>}
      {results.length > 0 && (
        <ul className="yt-results">
          {results.map((r) => (
            <li key={r.video_id}>
              <button
                type="button"
                onClick={() => {
                  onPick(`https://www.youtube.com/watch?v=${r.video_id}`);
                  setResults([]);
                  setQ("");
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.thumbnail} alt="" width={80} height={45} />
                <span className="yt-meta">
                  <span className="yt-title">{r.title}</span>
                  <span className="yt-channel">{r.channel}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
