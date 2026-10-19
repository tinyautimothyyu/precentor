"use client";

import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { createTag, fetchTags, type ApiError } from "@/lib/api";
import type { Tag } from "@/lib/types";

const MAX_SUGGESTIONS = 8;
const COLLAPSED_BROWSE = 20;

type Option = { kind: "tag"; tag: Tag } | { kind: "create"; name: string };

function normalise(s: string): string {
  return s.split(/\s+/).filter(Boolean).join(" ");
}

/**
 * Tag picker with type-ahead. Existing tags are always offered first; if
 * nothing matches exactly, "Create tag" adds a custom tag (the server returns
 * the existing tag instead if the name already exists in any case).
 */
export default function TagInput({
  value,
  onChange,
}: {
  value: number[];
  onChange: (ids: number[]) => void;
}) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetchTags()
      .then((d) => setTags(d.results))
      .catch(() => setErr("Couldn't load tags."));
  }, []);

  const byId = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);
  const selected = value.map((id) => byId.get(id)).filter((t): t is Tag => !!t);
  const q = normalise(query).toLowerCase();

  const options: Option[] = useMemo(() => {
    if (!q) return [];
    const matches = tags
      .filter((t) => !value.includes(t.id) && t.name.toLowerCase().includes(q))
      .sort((a, b) => {
        const rank = (t: Tag) =>
          t.name.toLowerCase() === q ? 0 : t.name.toLowerCase().startsWith(q) ? 1 : 2;
        return rank(a) - rank(b) || a.name.localeCompare(b.name);
      })
      .slice(0, MAX_SUGGESTIONS)
      .map((tag): Option => ({ kind: "tag", tag }));
    const exists = tags.some((t) => t.name.toLowerCase() === q);
    return exists ? matches : [...matches, { kind: "create", name: normalise(query) }];
  }, [q, query, tags, value]);

  const alreadyAdded = !!q && selected.some((t) => t.name.toLowerCase() === q);
  const browse = tags.filter((t) => !value.includes(t.id));
  const browseShown = showAll ? browse : browse.slice(0, COLLAPSED_BROWSE);

  function add(tag: Tag) {
    if (!value.includes(tag.id)) onChange([...value, tag.id]);
    setQuery("");
    setActive(0);
  }

  function remove(id: number) {
    onChange(value.filter((v) => v !== id));
  }

  async function create(name: string) {
    setBusy(true);
    setErr(null);
    try {
      const tag = await createTag(name);
      setTags((prev) => (prev.some((t) => t.id === tag.id) ? prev : [...prev, tag]));
      add(tag);
    } catch (e) {
      const ae = e as ApiError;
      setErr(ae.data ? JSON.stringify(ae.data) : ae.message);
    } finally {
      setBusy(false);
    }
  }

  function choose(opt: Option) {
    if (opt.kind === "tag") add(opt.tag);
    else void create(opt.name);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && options.length) {
      e.preventDefault();
      setActive((a) => (a + 1) % options.length);
    } else if (e.key === "ArrowUp" && options.length) {
      e.preventDefault();
      setActive((a) => (a - 1 + options.length) % options.length);
    } else if (e.key === "Enter") {
      // Never submit the surrounding form from the tag box.
      e.preventDefault();
      const opt = options[Math.min(active, options.length - 1)];
      if (opt && !busy) choose(opt);
    } else if (e.key === "Escape") {
      setQuery("");
    } else if (e.key === "Backspace" && !query && value.length) {
      remove(value[value.length - 1]);
    }
  }

  return (
    <div className="tag-input">
      {selected.length > 0 && (
        <div className="tag-picker">
          {selected.map((t) => (
            <span key={t.id} className="chip on">
              {t.category_display}: {t.name}
              <button
                type="button"
                className="chip-remove"
                aria-label={`Remove ${t.name}`}
                onClick={() => remove(t.id)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        placeholder="Type to find or add a tag…"
        aria-label="Add a tag"
        maxLength={100}
      />
      {err && <div className="msg error">{err}</div>}
      {alreadyAdded && <p className="tag-hint">Already added.</p>}
      {options.length > 0 && (
        <ul className="tag-options" role="listbox">
          {options.map((opt, i) => (
            <li key={opt.kind === "tag" ? opt.tag.id : "create"}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                className={i === active ? "active" : ""}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(opt)}
                disabled={busy}
              >
                {opt.kind === "tag" ? (
                  <>
                    <span className="muted">{opt.tag.category_display}:</span> {opt.tag.name}
                  </>
                ) : (
                  <>+ Create tag &ldquo;{opt.name}&rdquo;</>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {!q && browse.length > 0 && (
        <>
          <p className="tag-hint">Or pick an existing tag:</p>
          <div className="tag-picker">
            {browseShown.map((t) => (
              <button type="button" key={t.id} className="chip" onClick={() => add(t)}>
                {t.category_display}: {t.name}
              </button>
            ))}
            {browse.length > COLLAPSED_BROWSE && (
              <button type="button" className="linkbtn" onClick={() => setShowAll((s) => !s)}>
                {showAll ? "Show fewer" : `Show all (${browse.length})`}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
