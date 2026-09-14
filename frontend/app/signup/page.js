"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { fetchCongregations } from "@/lib/api";

export default function SignupPage() {
  const { register } = useAuth();
  const [form, setForm] = useState({
    username: "",
    email: "",
    password: "",
    role: "volunteer",
    congregation: "",
    team: "",
  });
  const [congregations, setCongregations] = useState([]);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchCongregations().then((d) => setCongregations(d.results || [])).catch(() => {});
  }, []);

  const teams =
    congregations.find((c) => String(c.id) === String(form.congregation))?.teams || [];

  function set(k, v) {
    setForm((f) => ({ ...f, [k]: v, ...(k === "congregation" ? { team: "" } : {}) }));
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const payload = {
        username: form.username,
        email: form.email,
        password: form.password,
        role: form.role,
      };
      if (form.congregation) payload.congregation = Number(form.congregation);
      if (form.team) payload.team = Number(form.team);
      await register(payload);
      setDone(true);
    } catch (err) {
      setError(err.data ? JSON.stringify(err.data) : err.message);
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
