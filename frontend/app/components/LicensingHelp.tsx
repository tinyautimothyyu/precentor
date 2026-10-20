import type { ReactNode } from "react";

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

/** Opens SongSelect pre-searched with the title (new tab). */
export function SongSelectLink({ title }: { title: string }) {
  const q = title.trim();
  const href = q
    ? `https://songselect.ccli.com/search/results?search=${encodeURIComponent(q)}`
    : "https://songselect.ccli.com/";
  return (
    <a href={href} target="_blank" rel="noreferrer" className="songselect-link">
      {q ? `Search SongSelect for “${q}” ↗` : "Open SongSelect ↗"}
    </a>
  );
}
