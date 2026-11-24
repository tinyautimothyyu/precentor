"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { fetchCongregation, fetchServices } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Congregation, ServiceListItem } from "@/lib/types";

export default function CongregationPage() {
  const { id } = useParams<{ id: string }>();
  const { user, loading, isApproved } = useAuth();
  const [congregation, setCongregation] = useState<Congregation | null>(null);
  const [error, setError] = useState("");
  const [services, setServices] = useState<ServiceListItem[]>([]);
  const [serviceCount, setServiceCount] = useState(0);

  useEffect(() => {
    fetchCongregation(id)
      .then(setCongregation)
      .catch(() => setError("Congregation not found."));
  }, [id]);

  // Services aren't public: only approved accounts can list them.
  useEffect(() => {
    if (loading || !isApproved) return;
    fetchServices({ congregation: id })
      .then((d) => {
        setServices(d.results);
        setServiceCount(d.count);
      })
      .catch(() => setServices([]));
  }, [id, loading, isApproved]);

  if (error) {
    return (
      <main className="container">
        <Link href="/congregations" className="back">
          ← Congregations
        </Link>
        <p className="muted">{error}</p>
      </main>
    );
  }

  if (!congregation) {
    return (
      <main className="container">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  const teamName = (teamId: number) =>
    congregation.teams.find((t) => t.id === teamId)?.name;

  return (
    <main className="container">
      <Link href="/congregations" className="back">
        ← Congregations
      </Link>
      <div className="detail-head">
        <h2>{congregation.name}</h2>
      </div>
      <p className="muted">
        {[congregation.primary_language, ...congregation.secondary_languages].join(" · ")}
      </p>

      <h3>Teams</h3>
      {congregation.teams.length === 0 ? (
        <p className="muted">No teams yet.</p>
      ) : (
        <div className="service-list">
          {congregation.teams.map((t) => (
            <div key={t.id} className="card">
              <div className="service-title">
                {t.name}
                {user?.team === t.id && <span className="muted"> · your team</span>}
              </div>
              {t.rotation_schedule && <div className="meta">{t.rotation_schedule}</div>}
            </div>
          ))}
        </div>
      )}

      <h3>Services</h3>
      {loading ? null : !user ? (
        <p className="muted">
          <Link href="/login">Log in</Link> to see this congregation&apos;s services.
        </p>
      ) : !isApproved ? (
        <p className="muted">Services are visible once your account is approved.</p>
      ) : services.length === 0 ? (
        <p className="muted">No services yet.</p>
      ) : (
        <>
          <div className="service-list">
            {services.map((s) => (
              <Link key={s.id} href={`/services/${s.id}`} className="card service-row">
                <div>
                  <div className="service-title">{s.title || "Service"}</div>
                  <div className="meta">
                    {s.date} · {teamName(s.team) ?? s.team_name}
                  </div>
                </div>
                <span className="pill">{s.item_count} songs</span>
              </Link>
            ))}
          </div>
          {serviceCount > services.length && (
            <p className="muted">
              Showing the {services.length} most recent of {serviceCount} services.
            </p>
          )}
        </>
      )}
    </main>
  );
}
