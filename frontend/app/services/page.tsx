"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fetchCongregations, fetchServices } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Congregation, ServiceListItem, Team } from "@/lib/types";

export default function ServicesPage() {
  const { user, loading, isApproved, isLeader } = useAuth();
  const router = useRouter();
  const [services, setServices] = useState<ServiceListItem[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamFilter, setTeamFilter] = useState<string>("");
  const [ready, setReady] = useState(false);

  // Redirect unauthenticated/unapproved users — services aren't public.
  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    setReady(true);
  }, [loading, user, router]);

  // Default the team filter to the user's own team (the "team page").
  useEffect(() => {
    if (user?.team) setTeamFilter(String(user.team));
  }, [user?.team]);

  useEffect(() => {
    fetchCongregations()
      .then((d) => setTeams(d.results.flatMap((c: Congregation) => c.teams)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!ready || !isApproved) return;
    fetchServices(teamFilter ? { team: teamFilter } : {})
      .then((d) => setServices(d.results))
      .catch(() => setServices([]));
  }, [ready, isApproved, teamFilter]);

  const teamName = useMemo(
    () => teams.find((t) => String(t.id) === teamFilter)?.name,
    [teams, teamFilter]
  );

  if (!ready) {
    return (
      <main className="container">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  if (!isApproved) {
    return (
      <main className="container narrow">
        <div className="card">
          <h2>Pending approval</h2>
          <p className="muted">
            Your account is awaiting approval. Once an admin approves you, you can
            view and listen to service playlists.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="container">
      <div className="detail-head">
        <h2>Services</h2>
        {isLeader && (
          <Link href="/services/new" className="header-link">
            ＋ New service
          </Link>
        )}
      </div>

      <div className="controls">
        <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
          <option value="">All teams</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        {teamName && <span className="muted">Showing {teamName}</span>}
      </div>

      {services.length === 0 ? (
        <p className="muted">No services yet.</p>
      ) : (
        <div className="service-list">
          {services.map((s) => (
            <Link key={s.id} href={`/services/${s.id}`} className="card service-row">
              <div>
                <div className="service-title">{s.title || "Service"}</div>
                <div className="meta">
                  {s.date} · {s.team_name}
                </div>
              </div>
              <span className="pill">{s.item_count} songs</span>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
