"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth";

export default function Header() {
  const { user, loading, logout, isLeader } = useAuth();

  return (
    <header className="site">
      <div className="inner">
        <Link href="/" className="brand">
          <h1>Precentor</h1>
        </Link>
        <span className="tagline">Worship ministry song library</span>
        <nav className="header-nav">
          {loading ? null : user ? (
            <>
              {isLeader && (
                <Link href="/songs/new" className="header-link">
                  ＋ New song
                </Link>
              )}
              <span className="whoami">
                {user.username}
                {user.team_name ? ` · ${user.team_name}` : ""}
                {!user.is_approved && !user.is_staff ? " · pending" : ""}
              </span>
              <button className="linkbtn" onClick={logout}>
                Log out
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="header-link">
                Log in
              </Link>
              <Link href="/signup" className="linkbtn">
                Sign up
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
