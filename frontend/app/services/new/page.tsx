"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createService, type ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function NewServicePage() {
  const { isLeader, loading, user } = useAuth();
  const router = useRouter();
  const [date, setDate] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loading && !isLeader) {
    return (
      <main className="container narrow">
        <div className="card">
          <h2>Leaders only</h2>
          <p className="muted">
            You need an approved leader account (with a team) to create a service.{" "}
            {!user && <Link href="/login">Log in</Link>}
          </p>
        </div>
      </main>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const svc = await createService({ date, title, notes });
      router.push(`/services/${svc.id}`);
    } catch (err) {
      const e2 = err as ApiError;
      setError(e2.data ? JSON.stringify(e2.data) : e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="container narrow">
      <Link href="/services" className="back">← Back to services</Link>
      <div className="card">
        <h2>New service</h2>
        <form onSubmit={onSubmit}>
          {error && <div className="msg error">{error}</div>}
          <label>
            Date *
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
          <label>
            Title <span className="muted">(occasion or theme)</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Advent Sunday" />
          </label>
          <label>
            Notes
            <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <button type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create service"}
          </button>
        </form>
      </div>
    </main>
  );
}
