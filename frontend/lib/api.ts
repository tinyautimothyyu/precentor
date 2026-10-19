import type {
  AppConfig,
  Congregation,
  Lyric,
  Paginated,
  ServiceDetail,
  ServiceListItem,
  ServiceSongItem,
  SheetFile,
  SongDetail,
  SongListItem,
  Tag,
  TokenPair,
  User,
  YouTubeResult,
} from "@/lib/types";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

// --- token storage (localStorage; guarded for SSR) -----------------------

const ACCESS = "precentor_access";
const REFRESH = "precentor_refresh";

export function getAccess(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACCESS);
}
export function getRefresh(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(REFRESH);
}
export function setTokens(tokens: Partial<TokenPair>): void {
  if (typeof window === "undefined") return;
  if (tokens.access) localStorage.setItem(ACCESS, tokens.access);
  if (tokens.refresh) localStorage.setItem(REFRESH, tokens.refresh);
}
export function clearTokens(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(ACCESS);
  localStorage.removeItem(REFRESH);
}

// --- core request with one refresh-and-retry on 401 ----------------------

export interface ApiError extends Error {
  status?: number;
  data?: unknown;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  isForm?: boolean;
}

async function refreshAccess(): Promise<boolean> {
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
  const data = (await res.json()) as Partial<TokenPair>;
  setTokens(data);
  return true;
}

async function request<T>(
  path: string,
  { method = "GET", body, isForm = false }: RequestOptions = {}
): Promise<T> {
  const build = (): RequestInit => {
    const headers: Record<string, string> = {};
    const access = getAccess();
    if (access) headers["Authorization"] = `Bearer ${access}`;
    let payload: BodyInit | undefined;
    if (body !== undefined && isForm) {
      payload = body as BodyInit;
    } else if (body !== undefined) {
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
    let detail: { detail?: string } | undefined;
    try {
      detail = await res.json();
    } catch {
      detail = { detail: res.statusText };
    }
    const err: ApiError = new Error(
      detail?.detail || JSON.stringify(detail)
    );
    err.status = res.status;
    err.data = detail;
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// --- auth ----------------------------------------------------------------

export async function login(
  username: string,
  password: string
): Promise<TokenPair> {
  const res = await fetch(`${API_BASE}/api/auth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error("Invalid username or password.");
  const data = (await res.json()) as TokenPair;
  setTokens(data);
  return data;
}

export interface RegisterPayload {
  username: string;
  email?: string;
  password: string;
  role: string;
  congregation?: number;
  team?: number;
}

export function register(payload: RegisterPayload): Promise<User> {
  return request<User>("/api/auth/register/", { method: "POST", body: payload });
}

export function fetchMe(): Promise<User> {
  return request<User>("/api/auth/me/");
}

// --- catalog reads (public) ----------------------------------------------

export function fetchSongs(
  params: Record<string, string | number | undefined | null> = {}
): Promise<Paginated<SongListItem>> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return request<Paginated<SongListItem>>(`/api/songs/${suffix}`);
}
export function fetchSong(id: string | number): Promise<SongDetail> {
  return request<SongDetail>(`/api/songs/${id}/`);
}
export function fetchTags(category?: string): Promise<Paginated<Tag>> {
  const suffix = category ? `?category=${category}` : "";
  return request<Paginated<Tag>>(`/api/tags/${suffix}`);
}
/** Adds a custom tag, or returns the existing tag with that name (any case). */
export function createTag(name: string): Promise<Tag> {
  return request<Tag>("/api/tags/", { method: "POST", body: { name } });
}
export function fetchCongregations(): Promise<Paginated<Congregation>> {
  return request<Paginated<Congregation>>(`/api/congregations/`);
}
export function fetchConfig(): Promise<AppConfig> {
  return request<AppConfig>(`/api/config/`);
}

// --- catalog writes (leaders) --------------------------------------------

export function createSong(payload: Record<string, unknown>): Promise<SongDetail> {
  return request<SongDetail>("/api/songs/", { method: "POST", body: payload });
}
export function updateSong(
  id: string | number,
  payload: Record<string, unknown>
): Promise<SongDetail> {
  return request<SongDetail>(`/api/songs/${id}/`, {
    method: "PATCH",
    body: payload,
  });
}
export function deleteSong(id: string | number): Promise<void> {
  return request<void>(`/api/songs/${id}/`, { method: "DELETE" });
}
export function createLyrics(payload: Record<string, unknown>): Promise<Lyric> {
  return request<Lyric>("/api/lyrics/", { method: "POST", body: payload });
}
export function uploadSheet(formData: FormData): Promise<SheetFile> {
  return request<SheetFile>("/api/sheets/", {
    method: "POST",
    body: formData,
    isForm: true,
  });
}
export function deleteSheet(id: string | number): Promise<void> {
  return request<void>(`/api/sheets/${id}/`, { method: "DELETE" });
}

// --- services ------------------------------------------------------------

export function fetchServices(
  params: Record<string, string | number | undefined | null> = {}
): Promise<Paginated<ServiceListItem>> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return request<Paginated<ServiceListItem>>(`/api/services/${suffix}`);
}
export function fetchService(id: string | number): Promise<ServiceDetail> {
  return request<ServiceDetail>(`/api/services/${id}/`);
}
export function createService(
  payload: Record<string, unknown>
): Promise<ServiceDetail> {
  return request<ServiceDetail>("/api/services/", {
    method: "POST",
    body: payload,
  });
}
export function updateService(
  id: string | number,
  payload: Record<string, unknown>
): Promise<ServiceDetail> {
  return request<ServiceDetail>(`/api/services/${id}/`, {
    method: "PATCH",
    body: payload,
  });
}
export function deleteService(id: string | number): Promise<void> {
  return request<void>(`/api/services/${id}/`, { method: "DELETE" });
}
export function addServiceSong(
  payload: Record<string, unknown>
): Promise<ServiceSongItem> {
  return request<ServiceSongItem>("/api/service-songs/", {
    method: "POST",
    body: payload,
  });
}
export function updateServiceSong(
  id: string | number,
  payload: Record<string, unknown>
): Promise<ServiceSongItem> {
  return request<ServiceSongItem>(`/api/service-songs/${id}/`, {
    method: "PATCH",
    body: payload,
  });
}
export function removeServiceSong(id: string | number): Promise<void> {
  return request<void>(`/api/service-songs/${id}/`, { method: "DELETE" });
}
export function reorderService(
  id: string | number,
  itemIds: number[]
): Promise<ServiceDetail> {
  return request<ServiceDetail>(`/api/services/${id}/reorder/`, {
    method: "POST",
    body: { item_ids: itemIds },
  });
}

// --- integrations --------------------------------------------------------

export function searchYouTube(q: string): Promise<YouTubeResult[]> {
  return request<YouTubeResult[]>(
    `/api/youtube/search/?q=${encodeURIComponent(q)}`
  );
}

// --- gated download (any approved account) -------------------------------

/** Filename from a Content-Disposition header (RFC 6266 filename* or filename). */
function dispositionFilename(header: string | null): string | null {
  if (!header) return null;
  const star = header.match(/filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      /* fall through to plain filename */
    }
  }
  const plain = header.match(/filename\s*=\s*"?([^";]+)"?/);
  return plain ? plain[1].trim() : null;
}

const MIME_EXT: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/heic": ".heic",
};

/**
 * Downloads a sheet through the auth-gated endpoint. `baseName` is a friendly
 * name (e.g. "Song - Lead sheet"); the extension always comes from the actual
 * file, so a PNG is never saved as ".pdf" (and so on).
 */
export async function downloadSheet(
  id: string | number,
  baseName = "sheet"
): Promise<void> {
  const access = getAccess();
  const res = await fetch(`${API_BASE}/api/sheets/${id}/download/`, {
    headers: access ? { Authorization: `Bearer ${access}` } : {},
  });
  if (res.status === 401) throw new Error("Please log in to download sheets.");
  if (!res.ok) throw new Error("Download failed.");
  const blob = await res.blob();

  const serverName = dispositionFilename(res.headers.get("Content-Disposition"));
  const ext =
    serverName?.match(/\.[A-Za-z0-9]{1,5}$/)?.[0] ??
    MIME_EXT[blob.type.split(";")[0]] ??
    "";
  const filename = baseName.replace(/\.[A-Za-z0-9]{1,5}$/, "") + ext;

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking synchronously can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// --- helpers -------------------------------------------------------------

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Extracts the video id from any common YouTube link: watch?v=, youtu.be/,
 * shorts/, live/, embed/, v/ — on www., m., music. or youtube-nocookie.com.
 */
export function youtubeVideoId(url: string): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www|m|music)\./, "");
  let id: string | null = null;
  if (host === "youtu.be") {
    id = u.pathname.split("/")[1] || null;
  } else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const [, kind, rest] = u.pathname.split("/");
    if (kind === "watch") id = u.searchParams.get("v");
    else if (["shorts", "live", "embed", "v"].includes(kind)) id = rest || null;
  }
  return id && YT_ID.test(id) ? id : null;
}

/** Embed URL for open.spotify.com track/album/playlist/episode links. */
export function spotifyEmbedUrl(url: string): string | null {
  try {
    const u = new URL(url.trim());
    if (u.hostname !== "open.spotify.com") return null;
    // Drop locale prefixes like /intl-de/.
    const path = u.pathname.replace(/^\/intl-[a-z-]+/i, "");
    const m = path.match(/^\/(track|album|playlist|episode|show|artist)\/[A-Za-z0-9]+/);
    return m ? `https://open.spotify.com/embed${m[0]}` : null;
  } catch {
    return null;
  }
}

export function watchVideosUrl(ids: string[]): string {
  return `https://www.youtube.com/watch_videos?video_ids=${ids.join(",")}`;
}
