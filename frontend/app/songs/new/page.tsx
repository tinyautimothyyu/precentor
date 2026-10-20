"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createSong, fetchSongs, lookupSong, type ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { SongLookup, SongLookupField } from "@/lib/types";
import YouTubePicker from "@/app/components/YouTubePicker";
import LicensingHelp, { SongSelectLink } from "@/app/components/LicensingHelp";
import TagInput from "@/app/components/TagInput";

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

const PROVIDER_LABEL: Record<string, string> = { youtube: "YouTube", spotify: "Spotify" };

interface Duplicate {
  id: number;
  title: string;
  reason: string;
}

function errorText(e: unknown): string {
  // request() puts the server's "detail" (or the JSON body) in the message.
  return (e as ApiError).message;
}

export default function NewSongPage() {
  const { isLeader, loading } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState<"link" | "form">("link");
  const [link, setLink] = useState("");
  const [looking, setLooking] = useState(false);
  const [lookupErr, setLookupErr] = useState<string | null>(null);
  const [lookup, setLookup] = useState<SongLookup | null>(null);
  // Fields filled from the link and not edited since (show a "please check" badge).
  const [autofilled, setAutofilled] = useState<Partial<Record<keyof FormState, string>>>({});
  const [form, setForm] = useState<FormState>(EMPTY);
  const [titleMatches, setTitleMatches] = useState<Duplicate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Live duplicate check on the title, for both link and manual entry.
  useEffect(() => {
    const title = form.title.trim();
    if (step !== "form" || title.length < 3) {
      setTitleMatches([]);
      return;
    }
    const h = setTimeout(() => {
      fetchSongs({ search: title })
        .then((d) =>
          setTitleMatches(
            d.results.slice(0, 5).map((s) => ({ id: s.id, title: s.title, reason: "similar title" }))
          )
        )
        .catch(() => setTitleMatches([]));
    }, 400);
    return () => clearTimeout(h);
  }, [form.title, step]);

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
    setAutofilled((a) => {
      if (!(k in a)) return a;
      const next = { ...a };
      delete next[k];
      return next;
    });
  }

  async function runLookup(url: string) {
    setLink(url);
    setLookupErr(null);
    setLooking(true);
    try {
      const result = await lookupSong(url);
      const filled: Partial<FormState> = {};
      const sources: Partial<Record<keyof FormState, string>> = {};
      for (const [name, f] of Object.entries(result.fields) as [
        keyof FormState,
        SongLookupField,
      ][]) {
        (filled as Record<string, string>)[name] = f.value;
        if (name !== "reference_url") sources[name] = PROVIDER_LABEL[f.source] ?? f.source;
      }
      setForm({ ...EMPTY, reference_url: url.trim(), ...filled });
      setAutofilled(sources);
      setLookup(result);
      setStep("form");
    } catch (e) {
      setLookupErr(errorText(e));
    } finally {
      setLooking(false);
    }
  }

  function enterManually() {
    setLookup(null);
    setAutofilled({});
    setForm({ ...EMPTY, reference_url: link.trim() });
    setStep("form");
  }

  function backToLink() {
    setStep("link");
    setError(null);
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
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  function Badge({ field }: { field: keyof FormState }) {
    const source = autofilled[field];
    return source ? <span className="autofill-badge">from {source} — please check</span> : null;
  }

  // Lookup duplicates (same video first), then live title matches.
  const duplicates: Duplicate[] = [];
  for (const d of [...(lookup?.duplicates ?? []), ...titleMatches]) {
    if (!duplicates.some((x) => x.id === d.id)) duplicates.push(d);
  }

  if (step === "link") {
    return (
      <main className="container narrow">
        <Link href="/" className="back">← Back to library</Link>
        <div className="card">
          <h2>Add a song</h2>
          <p className="muted">
            Start with a YouTube or Spotify link and we&apos;ll fill in what we can.
            You can check and edit everything before saving.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (link.trim()) void runLookup(link);
            }}
          >
            {lookupErr && <div className="msg error">{lookupErr}</div>}
            <label>
              YouTube or Spotify link
              <input
                type="url"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=… or https://open.spotify.com/track/…"
                autoFocus
              />
            </label>
            <YouTubePicker onPick={(url) => void runLookup(url)} />
            <div className="link-step-actions">
              <button type="submit" disabled={looking || !link.trim()}>
                {looking ? "Looking up…" : "Fill in details"}
              </button>
              <button type="button" className="linkbtn" onClick={enterManually}>
                Skip — enter details manually
              </button>
            </div>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="container narrow">
      <Link href="/" className="back">← Back to library</Link>
      <div className="card">
        <div className="detail-head">
          <h2>Add a song</h2>
          <button type="button" className="linkbtn" onClick={backToLink}>
            {lookup ? "Use a different link" : "Start from a link instead"}
          </button>
        </div>

        {lookup && (
          <div className="lookup-summary">
            <p>
              Filled in from {PROVIDER_LABEL[lookup.provider]}
              {lookup.artist && (
                <>
                  {" "}· Artist: <strong>{lookup.artist}</strong>
                </>
              )}
              {lookup.songwriters.length > 0 && (
                <>
                  {" "}· Songwriters: <strong>{lookup.songwriters.join(", ")}</strong>
                </>
              )}
            </p>
            {lookup.warnings.map((w) => (
              <p key={w} className="muted">{w}</p>
            ))}
          </div>
        )}

        {duplicates.length > 0 && (
          <div className="msg warn">
            <strong>Possible duplicates — check these before creating a new song:</strong>
            <ul>
              {duplicates.map((d) => (
                <li key={d.id}>
                  <a href={`/songs/${d.id}`} target="_blank" rel="noreferrer">
                    {d.title} ↗
                  </a>{" "}
                  <span className="muted">({d.reason})</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <form onSubmit={onSubmit}>
          {error && <div className="msg error">{error}</div>}
          <label>
            Title * <Badge field="title" />
            <input value={form.title} onChange={(e) => set("title", e.target.value)} required />
          </label>
          <label>
            CCLI number * <span className="muted">(or &quot;Public Domain&quot;)</span>{" "}
            <Badge field="ccli_number" />
            <input value={form.ccli_number} onChange={(e) => set("ccli_number", e.target.value)} required />
          </label>
          <LicensingHelp field="ccli" />
          <SongSelectLink title={form.title} />
          <label>
            Copyright holder * <Badge field="copyright_holder" />
            <input value={form.copyright_holder} onChange={(e) => set("copyright_holder", e.target.value)} required />
          </label>
          <LicensingHelp field="copyright" />
          <label>
            Licensing notes
            <textarea rows={2} value={form.licensing_notes} onChange={(e) => set("licensing_notes", e.target.value)} />
          </label>
          <LicensingHelp field="notes" />
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
          <TagInput value={form.tags} onChange={(ids) => set("tags", ids)} />
          <button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Create song"}
          </button>
        </form>
      </div>
    </main>
  );
}
