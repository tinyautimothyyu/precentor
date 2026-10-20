"use client";

import { useState } from "react";
import { preferSheet } from "@/lib/api";
import type { SheetFile } from "@/lib/types";

/**
 * Reuse signals for a sheet ("★ preferred by N teams", "↓ N downloads") plus,
 * for leaders, a toggle to make it their team's preferred sheet — the easy
 * alternative to uploading yet another version.
 */
export default function SheetUsage({
  sheet,
  myTeam,
  canPrefer,
  onChanged,
}: {
  sheet: SheetFile;
  /** The viewer's team id, if any. */
  myTeam: number | null;
  canPrefer: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const preferredCount = sheet.preferred_by_teams.length;
  const ours = myTeam !== null && sheet.preferred_by_teams.includes(myTeam);

  async function toggle() {
    setBusy(true);
    setErr(null);
    try {
      await preferSheet(sheet.id, !ours);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't update.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet-usage">
      {preferredCount > 0 && (
        <span className="usage-pill" title="Teams that use this as their sheet">
          ★ {preferredCount} {preferredCount === 1 ? "team" : "teams"}
        </span>
      )}
      <span className="sheet-sub">↓ {sheet.download_count}</span>
      {canPrefer && myTeam !== null && (
        <button
          type="button"
          className={ours ? "linkbtn prefer on" : "linkbtn prefer"}
          onClick={toggle}
          disabled={busy}
          title={
            ours
              ? "Your team uses this sheet. Click to unmark."
              : "Use this as your team's sheet for this format"
          }
        >
          {ours ? "★ Our sheet" : "☆ Use as ours"}
        </button>
      )}
      {err && <span className="error-text">{err}</span>}
    </div>
  );
}
