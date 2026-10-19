// Shared API types mirroring the DRF serializers.

export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

/** Mirrors catalog.models.SheetType. */
export const SHEET_TYPES: [string, string][] = [
  ["chord_chart", "Chord chart"],
  ["lead_sheet", "Lead sheet"],
  ["piano_score", "Piano score"],
  ["hymnal", "Hymnal"],
  ["vocal_only", "Vocal only"],
];

export interface Tag {
  id: number;
  name: string;
  category: string;
  category_display: string;
}

export interface Segment {
  segment_type: string;
  lines: string[];
}

export interface Lyric {
  id: number;
  song?: number;
  owner_team: number | null;
  language: string;
  segments: Segment[];
  translation_source: string;
  status: string;
  status_display: string;
}

export interface SheetFile {
  id: number;
  type: string;
  type_display: string;
  key: string;
  source: string;
  owner_team: number | null;
  download_url: string | null;
  has_file: boolean;
  preferred_by_teams: number[];
  /** Name of the file as uploaded. */
  filename: string | null;
  /** Uploader's team at upload time. */
  owner_team_name: string | null;
  /** Only provided to logged-in, approved members; null otherwise. */
  uploaded_by_name: string | null;
  uploaded_at: string;
  /** Why this version exists alongside one in the same format and key. */
  upload_reason: string;
  download_count: number;
}

export interface Alignment {
  id: number;
  primary_language: string;
  secondary_language: string;
  line_pairing: unknown[];
}

export interface SongListItem {
  id: number;
  title: string;
  alternate_titles: string[];
  default_key: string;
  tempo: number | null;
  ccli_number: string;
  tags: Tag[];
  owner_team: number | null;
  owner_team_name: string | null;
  owner_congregation_name: string | null;
  languages: string[];
  sheet_types: string[];
}

export interface SongDetail extends SongListItem {
  copyright_holder: string;
  licensing_notes: string;
  reference_url: string;
  lyrics: Lyric[];
  sheets: SheetFile[];
  alignments: Alignment[];
  created_at: string;
  updated_at: string;
}

export interface Team {
  id: number;
  name: string;
  congregation: number;
  rotation_schedule: string;
}

export interface Congregation {
  id: number;
  name: string;
  primary_language: string;
  secondary_languages: string[];
  bilingual_display_default: string;
  default_sheet_format: string;
  song_restrictions: string[];
  teams: Team[];
}

export interface User {
  id: number;
  username: string;
  email: string;
  is_staff: boolean;
  role: string;
  is_approved: boolean;
  team: number | null;
  team_name: string | null;
  congregation: number | null;
}

export interface ServiceSongItem {
  id: number;
  service: number;
  song: number;
  song_detail: {
    id: number;
    title: string;
    default_key: string;
    reference_url: string;
    owner_team: number | null;
    sheets: ServiceSheet[];
  };
  order: number;
  key_override: string;
  format_override: string;
  /** Track for this service only ("" = use the song's). */
  reference_url_override: string;
  /** Effective track: the override, else the song's reference_url. */
  reference_url: string;
}

export interface ServiceSheet {
  id: number;
  type: string;
  type_display: string;
  key: string;
  has_file: boolean;
}

export interface ServiceListItem {
  id: number;
  team: number;
  team_name: string;
  date: string;
  title: string;
  item_count: number;
}

export interface ServiceDetail extends ServiceListItem {
  congregation: number | null;
  notes: string;
  items: ServiceSongItem[];
  created_at: string;
  updated_at: string;
}

export interface YouTubeResult {
  video_id: string;
  title: string;
  channel: string;
  thumbnail: string;
}

export interface SongLookupField {
  value: string;
  /** "youtube" | "spotify" */
  source: string;
}

/** Result of POST /api/songs/lookup/ — suggestions to review, never authoritative. */
export interface SongLookup {
  provider: "youtube" | "spotify";
  fields: Partial<
    Record<"title" | "ccli_number" | "copyright_holder" | "reference_url", SongLookupField>
  >;
  artist: string;
  songwriters: string[];
  warnings: string[];
  duplicates: { id: number; title: string; reason: string }[];
}

export interface AppConfig {
  youtube_search: boolean;
}

export interface TokenPair {
  access: string;
  refresh: string;
}
