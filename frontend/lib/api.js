export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

// --- token storage (localStorage; guarded for SSR) -----------------------

const ACCESS = "precentor_access";
const REFRESH = "precentor_refresh";

export function getAccess() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACCESS);
}
export function getRefresh() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(REFRESH);
}
export function setTokens({ access, refresh }) {
  if (typeof window === "undefined") return;
  if (access) localStorage.setItem(ACCESS, access);
  if (refresh) localStorage.setItem(REFRESH, refresh);
}
export function clearTokens() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(ACCESS);
  localStorage.removeItem(REFRESH);
}

// --- core request with one refresh-and-retry on 401 ----------------------

async function refreshAccess() {
  const refresh = getRefresh();
  if (!refresh) return false;
  const res = await fetch(`${API_BASE}/api/auth/token/refresh/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh }),
  });
  if (!res.ok) {
    clearTokens();
    return false;
  }
  const data = await res.json();
  setTokens({ access: data.access, refresh: data.refresh });
  return true;
}

async function request(path, { method = "GET", body, isForm = false } = {}) {
  const build = () => {
    const headers = {};
    const access = getAccess();
    if (access) headers["Authorization"] = `Bearer ${access}`;
    let payload = body;
    if (body && !isForm) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    return { method, headers, body: payload };
  };

  let res = await fetch(`${API_BASE}${path}`, { ...build(), cache: "no-store" });
  if (res.status === 401 && getRefresh()) {
    if (await refreshAccess()) {
      res = await fetch(`${API_BASE}${path}`, { ...build(), cache: "no-store" });
    }
  }
  if (!res.ok) {
    let detail;
    try {
      detail = await res.json();
    } catch {
      detail = { detail: res.statusText };
    }
    const err = new Error(detail.detail || JSON.stringify(detail));
    err.status = res.status;
    err.data = detail;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

// --- auth ----------------------------------------------------------------

export async function login(username, password) {
  const res = await fetch(`${API_BASE}/api/auth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error("Invalid username or password.");
  const data = await res.json();
  setTokens(data);
  return data;
}

export function register(payload) {
  return request("/api/auth/register/", { method: "POST", body: payload });
}

export function fetchMe() {
  return request("/api/auth/me/");
}

// --- catalog reads (public) ----------------------------------------------

export function fetchSongs(params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, v);
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return request(`/api/songs/${suffix}`);
}
export function fetchSong(id) {
  return request(`/api/songs/${id}/`);
}
export function fetchTags(category) {
  const suffix = category ? `?category=${category}` : "";
  return request(`/api/tags/${suffix}`);
}
export function fetchCongregations() {
  return request(`/api/congregations/`);
}

// --- catalog writes (leaders) --------------------------------------------

export function createSong(payload) {
  return request("/api/songs/", { method: "POST", body: payload });
}
export function updateSong(id, payload) {
  return request(`/api/songs/${id}/`, { method: "PATCH", body: payload });
}
export function deleteSong(id) {
  return request(`/api/songs/${id}/`, { method: "DELETE" });
}
export function createLyrics(payload) {
  return request("/api/lyrics/", { method: "POST", body: payload });
}
export function uploadSheet(formData) {
  return request("/api/sheets/", { method: "POST", body: formData, isForm: true });
}
export function deleteSheet(id) {
  return request(`/api/sheets/${id}/`, { method: "DELETE" });
}

// --- gated download (any approved account) -------------------------------

export async function downloadSheet(id, filename = "sheet") {
  const access = getAccess();
  const res = await fetch(`${API_BASE}/api/sheets/${id}/download/`, {
    headers: access ? { Authorization: `Bearer ${access}` } : {},
  });
  if (res.status === 401) throw new Error("Please log in to download sheets.");
  if (!res.ok) throw new Error("Download failed.");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
