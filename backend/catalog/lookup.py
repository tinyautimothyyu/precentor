"""
Song metadata lookup from a YouTube or Spotify link (link-first "Add song").

Everything here is best effort: titles are usually right, the copyright line
and songwriters only when a video description states them, and the CCLI
number rarely (there is no public CCLI API). Callers must treat results as
suggestions and fall back to manual entry on any failure.
"""
import json
import re
import urllib.parse
import urllib.request
from dataclasses import dataclass, field

from django.conf import settings

TIMEOUT = 6  # seconds per upstream request

_YT_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
_SPOTIFY_TRACK = re.compile(r"^/(?:intl-[a-z-]+/)?track/([A-Za-z0-9]{22})")


class LookupError(Exception):
    """The link isn't something we can look up (user-facing message)."""


@dataclass
class LookupResult:
    provider: str  # "youtube" | "spotify"
    reference_url: str
    title: str = ""
    english_title: str = ""
    artist: str = ""
    ccli_number: str = ""
    copyright_holder: str = ""
    songwriters: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    video_id: str = ""


# --- link parsing --------------------------------------------------------


def youtube_video_id(url):
    """Mirror of the frontend parser: watch?v=, youtu.be/, shorts/, live/, embed/, v/."""
    try:
        u = urllib.parse.urlparse(url.strip())
    except ValueError:
        return None
    host = re.sub(r"^(www|m|music)\.", "", (u.hostname or "").lower())
    vid = None
    if host == "youtu.be":
        vid = u.path.split("/")[1] if len(u.path) > 1 else None
    elif host in ("youtube.com", "youtube-nocookie.com"):
        parts = u.path.split("/")
        kind = parts[1] if len(parts) > 1 else ""
        if kind == "watch":
            vid = urllib.parse.parse_qs(u.query).get("v", [None])[0]
        elif kind in ("shorts", "live", "embed", "v") and len(parts) > 2:
            vid = parts[2]
    return vid if vid and _YT_ID.match(vid) else None


def spotify_track_id(url):
    try:
        u = urllib.parse.urlparse(url.strip())
    except ValueError:
        return None
    if (u.hostname or "").lower() != "open.spotify.com":
        return None
    m = _SPOTIFY_TRACK.match(u.path)
    return m.group(1) if m else None


# --- text extraction -----------------------------------------------------

# Bracketed or trailing noise commonly appended to worship video titles.
_NOISE_WORDS = (
    r"official\s+(?:music\s+|lyric\s+|live\s+)?(?:video|audio|visualizer)"
    r"|(?:official\s+)?lyrics?(?:\s+video)?|lyric\s+video|music\s+video"
    r"|live(?:\s+(?:at|from|in)\b[^)\]]*)?|acoustic|audio|visualizer"
    r"|4k|hd|remaster(?:ed)?|with\s+lyrics|karaoke|instrumental"
)
# A bracket made up only of noise phrases, e.g. "(4K Remaster)", "[Official Lyric Video]".
_BRACKETED_NOISE = re.compile(
    rf"\s*[\(\[]\s*(?:(?:{_NOISE_WORDS})[\s,/&+-]*)+[\)\]]", re.IGNORECASE
)
_TRAILING_SEGMENT = re.compile(r"\s+[|•]\s+.*$")


def _norm(s):
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def clean_title(raw, artist=""):
    """
    "Hillsong Worship - What A Beautiful Name (Official Lyric Video)"
      -> "What A Beautiful Name"
    """
    title = _BRACKETED_NOISE.sub("", raw)
    title = _TRAILING_SEGMENT.sub("", title)  # "Title | Live at X" / "Title • Artist"
    # "Artist - Title" or "Title - Artist": drop the side that is the artist.
    parts = [p.strip() for p in re.split(r"\s+[-–—]\s+", title) if p.strip()]
    if len(parts) == 2 and artist:
        a = _norm(artist)
        if a and (a in _norm(parts[0]) or _norm(parts[0]) in a):
            title = parts[1]
        elif a and (a in _norm(parts[1]) or _norm(parts[1]) in a):
            title = parts[0]
    title = _BRACKETED_NOISE.sub("", title)
    title = re.sub(r"\s{2,}", " ", title).strip(" -–—|")
    return title or raw.strip()


# Chinese/Japanese/Korean characters.
_CJK = "\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff"
_HAS_CJK = re.compile(f"[{_CJK}]")
# Title-marking brackets in Chinese video titles: 【能不能】, 《能不能》.
_ZH_TITLE_BRACKET = re.compile(r"[【《「]([^】》」]+)[】》」]")
_SEGMENT_SPLIT = re.compile(r"\s*[|•/／()\[\]（）【】《》「」]\s*|\s+[-–—]\s+")
_SCRIPT_RUN = re.compile(
    f"[{_CJK}][{_CJK}\\s\\d，、！？!?.·]*|[A-Za-z][A-Za-z0-9\\s',.!?&’]*"
)
_ZH_NOISE = re.compile(r"官方|動態歌詞|动态歌词|歌詞版|歌词版|歌詞|歌词|現場|现场|敬拜讚美|敬拜赞美|詩歌|诗歌|字幕|版$")
_EN_NOISE = re.compile(rf"^(?:{_NOISE_WORDS}|mv|official|lyrics?|cover|worship)$", re.IGNORECASE)


def has_cjk(text):
    return bool(_HAS_CJK.search(text or ""))


def split_bilingual(raw, artist=""):
    """
    Bilingual worship titles -> (Chinese title, English title).

    "能不能 Can I"                      -> ("能不能", "Can I")
    "【能不能 Can I】讚美之泉 官方MV"    -> ("能不能", "Can I")
    "讚美之泉 - 能不能 | Can I (Official Lyric Video)" with artist 讚美之泉
                                        -> ("能不能", "Can I")
    Returns ("", "") when the title isn't a Chinese one.
    """
    text = _BRACKETED_NOISE.sub("", raw or "")
    if not has_cjk(text):
        return "", ""
    marked = [m for m in _ZH_TITLE_BRACKET.findall(text) if has_cjk(m)]
    # A bracketed title comes first; the rest may still hold the English title.
    rest = _ZH_TITLE_BRACKET.sub(" | ", text, count=1) if marked else text
    segments = marked[:1] + _SEGMENT_SPLIT.split(rest)
    artist_parts = {p.strip().lower() for p in _SCRIPT_RUN.findall(artist or "")} | {
        (artist or "").strip().lower()
    }

    def is_artist(piece):
        p = piece.lower()
        return bool(p) and any(p == a or (len(p) > 2 and p in a) for a in artist_parts if a)

    zh = en = ""
    for seg in segments:
        for piece in _SCRIPT_RUN.findall(seg):
            piece = re.sub(r"\s{2,}", " ", piece).strip(" ,.!?·")
            if not piece or is_artist(piece):
                continue
            if has_cjk(piece):
                piece = _ZH_NOISE.sub("", piece).strip()
                if piece and not is_artist(piece) and not zh:
                    zh = piece
            elif len(re.sub(r"[^A-Za-z]", "", piece)) >= 2 and not _EN_NOISE.match(piece) and not en:
                en = piece
    return zh, en


def clean_channel(name):
    """'Elevation Worship - Topic' / 'HillsongWorshipVEVO' -> artist-ish name."""
    name = re.sub(r"\s*-\s*Topic$", "", name)
    name = re.sub(r"VEVO$", "", name)
    return name.strip()


_CCLI = re.compile(
    r"CCLI\s*(?:Song\s*)?(?:#|No\.?|Number|Song\s*#)?\s*[:#]?\s*(\d{4,8})",
    re.IGNORECASE,
)
_COPYRIGHT = re.compile(r"^\s*(?:©|\(c\)|copyright\b)\s*(.+)$", re.IGNORECASE)
_WRITERS = re.compile(
    r"^\s*(?:written\s+by|songwriters?|writers?|words\s+(?:and|&)\s+music(?:\s+by)?)"
    r"\s*[:\-]?\s*(.+)$",
    re.IGNORECASE,
)


def extract_ccli(text):
    m = _CCLI.search(text or "")
    return m.group(1) if m else ""


def extract_copyright(text):
    """First © line, e.g. '© 2016 Hillsong Music Publishing Australia'."""
    for line in (text or "").splitlines():
        m = _COPYRIGHT.match(line)
        if m:
            holder = m.group(1).strip()
            if holder and not holder.lower().startswith(("all rights", "notice")):
                return ("© " + holder)[:300]
    return ""


def extract_songwriters(text):
    for line in (text or "").splitlines():
        m = _WRITERS.match(line)
        if m:
            names = re.split(r"\s*(?:,|&|\band\b|/)\s*", m.group(1))
            return [n.strip(" .") for n in names if n.strip(" .")][:8]
    return []


# --- upstream fetching ---------------------------------------------------


def _get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Precentor/1.0"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _youtube(video_id):
    canonical = f"https://www.youtube.com/watch?v={video_id}"
    result = LookupResult(provider="youtube", reference_url=canonical, video_id=video_id)
    raw_title = channel = description = ""
    if settings.YOUTUBE_API_KEY:
        params = urllib.parse.urlencode(
            {"part": "snippet", "id": video_id, "key": settings.YOUTUBE_API_KEY}
        )
        try:
            items = _get_json(f"https://www.googleapis.com/youtube/v3/videos?{params}").get(
                "items", []
            )
            if items:
                snip = items[0]["snippet"]
                raw_title = snip.get("title", "")
                channel = snip.get("channelTitle", "")
                description = snip.get("description", "")
        except Exception:
            result.warnings.append("YouTube details couldn't be fetched; tried the basic lookup.")
    if not raw_title:
        try:
            data = _get_json(
                "https://www.youtube.com/oembed?format=json&url="
                + urllib.parse.quote(canonical, safe="")
            )
            raw_title, channel = data.get("title", ""), data.get("author_name", "")
        except Exception:
            raise LookupError("Couldn't read that YouTube video. Is it public?")
    result.artist = clean_channel(channel)
    result.title = clean_title(raw_title, result.artist)
    zh, en = split_bilingual(raw_title, result.artist)
    if zh:
        result.title, result.english_title = zh, en
    result.ccli_number = extract_ccli(description)
    result.copyright_holder = extract_copyright(description)
    result.songwriters = extract_songwriters(description)
    if not description:
        result.warnings.append(
            "Only the title and channel are available for this video "
            "(no description), so licensing details need to be entered by hand."
        )
    return result


def _spotify(track_id):
    canonical = f"https://open.spotify.com/track/{track_id}"
    result = LookupResult(provider="spotify", reference_url=canonical)
    try:
        data = _get_json(
            "https://open.spotify.com/oembed?url=" + urllib.parse.quote(canonical, safe="")
        )
    except Exception:
        raise LookupError("Couldn't read that Spotify track.")
    result.title = clean_title(data.get("title", ""))
    zh, en = split_bilingual(data.get("title", ""))
    if zh:
        result.title, result.english_title = zh, en
    result.warnings.append(
        "Spotify links only provide the song title for now; "
        "artist and licensing details need to be entered by hand."
    )
    return result


def lookup(url):
    url = (url or "").strip()
    if not url:
        raise LookupError("Paste a YouTube or Spotify link.")
    if video_id := youtube_video_id(url):
        return _youtube(video_id)
    if track_id := spotify_track_id(url):
        return _spotify(track_id)
    if "spotify.com" in url:
        raise LookupError("Paste a link to a single Spotify track (not an album or playlist).")
    raise LookupError("That doesn't look like a YouTube video or Spotify track link.")
