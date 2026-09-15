"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { fetchCongregations, type ApiError } from "@/lib/api";
import type { Congregation } from "@/lib/types";

interface FormState {
  username: string;
  email: string;
  password: string;
  role: string;
  congregation: string;
  team: string;
}

export default function SignupPage() {
  const { register } = useAuth();
  const [form, setForm] = useState<FormState>({
    username: "",
    email: "",
    password: "",
    role: "volunteer",
    congregation: "",
    team: "",
  });
  const [congregations, setCongregations] = useState<Congregation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchCongregations()
      .then((d) => setCongregations(d.results))
      .catch(() => {});
  }, []);

  const teams =
    congregations.find((c) => String(c.id) === String(form.congregation))?.teams ||
    [];

  function set(k: keyof FormState, v: string) {
    setForm((f) => ({ ...f, [k]: v, ...(k === "congregation" ? { team: "" } : {}) }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await register({
        username: form.username,
        email: form.email,
        password: form.password,
        role: form.role,
        ...(form.congregation ? { congregation: Number(form.congregation) } : {}),
        ...(form.team ? { team: Number(form.team) } : {}),
      });
      setDone(true);
    } catch (err) {
      const e2 = err as ApiError;
      setError(e2.data ? JSON.stringify(e2.data) : e2.message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <main className="container narrow">
        <div className="card">
          <h2>Account requested</h2>
          <div className="msg success">
            Thanks! Your account is <strong>pending approval</strong>. An
            administrator will assign your role and team access. You can{" "}
            <Link href="/login">log in</Link> now to browse, but uploads and
            downloads unlock once you&apos;re approved.
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="container narrow">
      <div className="card">
        <h2>Sign up</h2>
        <form onSubmit={onSubmit}>
          {error && <div className="msg error">{error}</div>}
          <label>
            Username
            <input value={form.username} onChange={(e) => set("username", e.target.value)} required />
          </label>
          <label>
            Email (optional)
            <input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
          </label>
          <label>
            Password
            <input
              type="password"
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
              required
            />
          </label>
          <label>
            Role
            <select value={form.role} onChange={(e) => set("role", e.target.value)}>
              <option value="volunteer">Volunteer (browse + download)</option>
              <option value="leader">Leader (upload + edit)</option>
            </select>
          </label>
          <label>
            Congregation
            <select value={form.congregation} onChange={(e) => set("congregation", e.target.value)}>
              <option value="">—</option>
              {congregations.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {teams.length > 0 && (
            <label>
              Team
              <select value={form.team} onChange={(e) => set("team", e.target.value)}>
                <option value="">—</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="submit" disabled={busy}>
            {busy ? "Submitting…" : "Request account"}
          </button>
        </form>
        <p className="muted">
          Already have an account? <Link href="/login">Log in</Link>
        </p>
      </div>
    </main>
  );
}
