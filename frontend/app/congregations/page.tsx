"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchCongregations } from "@/lib/api";
import type { Congregation } from "@/lib/types";

export default function CongregationsPage() {
  const [congregations, setCongregations] = useState<Congregation[] | null>(null);

  useEffect(() => {
    fetchCongregations()
      .then((d) => setCongregations(d.results))
      .catch(() => setCongregations([]));
  }, []);

  return (
    <main className="container">
      <div className="detail-head">
        <h2>Congregations</h2>
      </div>

      {congregations === null ? (
        <p className="muted">Loading…</p>
      ) : congregations.length === 0 ? (
        <p className="muted">No congregations yet.</p>
      ) : (
        <div className="service-list">
          {congregations.map((c) => (
            <Link key={c.id} href={`/congregations/${c.id}`} className="card service-row">
              <div>
                <div className="service-title">{c.name}</div>
                <div className="meta">
                  {[c.primary_language, ...c.secondary_languages].join(" · ")}
                </div>
              </div>
              <span className="pill">
                {c.teams.length} {c.teams.length === 1 ? "team" : "teams"}
              </span>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
