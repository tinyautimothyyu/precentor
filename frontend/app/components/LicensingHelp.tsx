"use client";

import { useEffect, useState, type ReactNode } from "react";
import { hasCjk } from "@/lib/text";

type Field = "ccli" | "copyright" | "notes";

const HELP: Record<Field, { what: string; where: ReactNode }> = {
  ccli: {
    what:
      "The song's ID in CCLI's licensing catalog. Churches report song usage under their CCLI licence with this number.",
    where: (
      <>
        Search the song on SongSelect (songselect.ccli.com) and look for{" "}
        <strong>&ldquo;CCLI Song #&rdquo;</strong>. It&apos;s also printed in the footer of
        most purchased sheets and lyric slides. For old hymns that are out of
        copyright, enter <strong>Public Domain</strong>.
      </>
    ),
  },
  copyright: {
    what: "The publisher or rights owner of the song — not the artist who performs it.",
    where: (
      <>
        The <strong>©</strong> line on the sheet music or on SongSelect, e.g.
        &ldquo;© 2011 Hillsong Music Publishing&rdquo;. If several publishers are
        listed, enter them all, separated by commas.
      </>
    ),
  },
  notes: {
    what:
      "Anything unusual about how we may use this song, e.g. an approved translation, a permission letter on file, or not covered by CCLI.",
    where: <>Ask your church office or worship coordinator if unsure.</>,
  },
};

/** One-line explanation plus a "Where do I find this?" toggle for a licensing field. */
export default function LicensingHelp({ field }: { field: Field }) {
  const { what, where } = HELP[field];
  return (
    <div className="field-help">
      <p className="field-help-what">{what}</p>
      <details>
        <summary>Where do I find this?</summary>
        <p>{where}</p>
      </details>
    </div>
  );
}

const SONGSELECT = "https://songselect.ccli.com";

const searchUrl = (q: string) => `${SONGSELECT}/search/results?search=${encodeURIComponent(q)}`;

/**
 * SongSelect shortcut (new tab): opens the song directly when the CCLI number
 * is known; otherwise searches by title — the English title for a Chinese
 * song, since SongSelect can't search Chinese. Without one, asks for an
 * artist or publisher to search by instead.
 */
export function SongSelectLink({
  title,
  englishTitle = "",
  ccli = "",
  artist = "",
}: {
  title: string;
  englishTitle?: string;
  ccli?: string;
  artist?: string;
}) {
  const [alt, setAlt] = useState(artist);
  useEffect(() => setAlt((a) => a || artist), [artist]);
  const q = hasCjk(title) && englishTitle.trim() ? englishTitle.trim() : title.trim();
  const number = ccli.trim();

  if (/^\d+$/.test(number)) {
    return (
      <a href={`${SONGSELECT}/songs/${number}`} target="_blank" rel="noreferrer" className="songselect-link">
        Open CCLI #{number} on SongSelect ↗
      </a>
    );
  }
  if (!q) {
    return (
      <a href={SONGSELECT} target="_blank" rel="noreferrer" className="songselect-link">
        Open SongSelect ↗
      </a>
    );
  }
  if (!hasCjk(q)) {
    return (
      <a href={searchUrl(q)} target="_blank" rel="noreferrer" className="songselect-link">
        Search SongSelect for &ldquo;{q}&rdquo; ↗
      </a>
    );
  }
  const altQ = alt.trim();
  return (
    <div className="songselect-alt">
      <p className="muted">
        SongSelect can&apos;t search Chinese titles — it lists songs by their English
        title. Add the English title above if the song has one, or search by
        artist or publisher:
      </p>
      <div className="songselect-alt-row">
        <input
          value={alt}
          onChange={(e) => setAlt(e.target.value)}
          placeholder="e.g. Stream of Praise"
          aria-label="SongSelect search"
        />
        {altQ ? (
          <a href={searchUrl(altQ)} target="_blank" rel="noreferrer" className="songselect-link">
            Search SongSelect ↗
          </a>
        ) : (
          <span className="songselect-link muted">Search SongSelect ↗</span>
        )}
      </div>
    </div>
  );
}
