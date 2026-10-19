"""
Structured lyrics: section ids, flow validation and flow expansion.

A song's lyrics are a list of *sections*, each written once:
    {"id": "C", "type": "chorus", "label": "Chorus", "lines": [...]}
A *flow* is an ordered list of steps that reference sections:
    {"section": "C"}                 a section of this song
    {"marker": "MB", "label": "..."} a music break / instrumental (no lyrics)
    {"song": 12, "section": "C"}     remix: a section borrowed from another song
Translations reuse the same section ids, so one flow drives every language.
"""
import re

# Code -> (type, label). Verses are always numbered (V1, V2...); other types
# are bare for the first one (C, PC, B...) and numbered from 2 (C2).
SECTION_CODES = {
    "V": ("verse", "Verse"),
    "PC": ("prechorus", "Pre-chorus"),
    "C": ("chorus", "Chorus"),
    "B": ("bridge", "Bridge"),
    "ET": ("tag", "End tag"),
    "I": ("intro", "Intro"),
    "O": ("outro", "Outro"),
}
TYPE_TO_CODE = {t: code for code, (t, _) in SECTION_CODES.items()}
MARKERS = {"MB": "Music break", "INST": "Instrumental", "BRK": "Break"}

SECTION_ID = re.compile(r"^(V|PC|C|B|ET|I|O)([1-9]\d?)?$")


def canonical_id(raw):
    """'v' -> 'V1', 'c1' -> 'C', 'C2' -> 'C2'; None if not a section id."""
    m = SECTION_ID.match((raw or "").strip().upper())
    if not m:
        return None
    code, num = m.group(1), m.group(2)
    if code == "V":
        return f"V{num or 1}"
    return code if not num or num == "1" else f"{code}{num}"


def section_label(section_id):
    code, num = SECTION_ID.match(section_id).groups()
    base = SECTION_CODES[code][1]
    if code == "V":
        return f"{base} {num}"
    return f"{base} {num}" if num else base


def section_type(section_id):
    return SECTION_CODES[SECTION_ID.match(section_id).group(1)][0]


# --- legacy migration ----------------------------------------------------

_LEGACY = re.compile(
    r"^(verse|chorus|pre-?chorus|bridge|tag|end-?tag|ending|intro|outro)[\s_-]*(\d*)$",
    re.IGNORECASE,
)
_LEGACY_TYPE = {
    "verse": "V", "chorus": "C", "prechorus": "PC", "pre-chorus": "PC",
    "bridge": "B", "tag": "ET", "endtag": "ET", "end-tag": "ET", "ending": "ET",
    "intro": "I", "outro": "O",
}


def legacy_to_id(segment_type, taken):
    """Map an old segment_type ('verse1', 'chorus') to a section id not in `taken`."""
    m = _LEGACY.match((segment_type or "").strip())
    if m:
        cid = canonical_id(_LEGACY_TYPE[m.group(1).lower()] + (m.group(2) or ""))
        if cid and cid not in taken:
            return cid
    n = 1
    while f"V{n}" in taken:  # unknown/duplicate: next free verse
        n += 1
    return f"V{n}"


# --- validation ----------------------------------------------------------


def validate_sections(segments):
    """Return normalised sections or raise ValueError with a user-facing message."""
    if not isinstance(segments, list):
        raise ValueError("Sections must be a list.")
    out, seen = [], set()
    for i, seg in enumerate(segments, 1):
        if not isinstance(seg, dict):
            raise ValueError(f"Section {i} is malformed.")
        sid = canonical_id(seg.get("id", ""))
        if not sid:
            raise ValueError(
                f"Section {i} has an invalid id {seg.get('id')!r} "
                "(use V1, V2, PC, C, C2, B, ET, I, O)."
            )
        if sid in seen:
            raise ValueError(f"Section {sid} appears twice; each section is written once.")
        seen.add(sid)
        lines = seg.get("lines", [])
        if not isinstance(lines, list) or not all(isinstance(l, str) for l in lines):
            raise ValueError(f"Section {sid}: lines must be a list of text lines.")
        out.append(
            {
                "id": sid,
                "type": section_type(sid),
                "label": (seg.get("label") or section_label(sid)).strip()[:60],
                "lines": [l.rstrip() for l in lines],
            }
        )
    return out


def validate_steps(steps, song_exists):
    """Normalise flow steps; `song_exists(id)` checks remix targets."""
    if not isinstance(steps, list):
        raise ValueError("Steps must be a list.")
    if len(steps) > 100:
        raise ValueError("A flow can have at most 100 steps.")
    out = []
    for i, step in enumerate(steps, 1):
        if not isinstance(step, dict):
            raise ValueError(f"Step {i} is malformed.")
        if "marker" in step:
            code = str(step["marker"]).strip().upper()
            if code not in MARKERS:
                raise ValueError(f"Step {i}: unknown marker {step['marker']!r} (use MB, INST, BRK).")
            label = (step.get("label") or MARKERS[code]).strip()[:60]
            out.append({"marker": code, "label": label})
            continue
        sid = canonical_id(step.get("section", ""))
        if not sid:
            raise ValueError(f"Step {i}: invalid section {step.get('section')!r}.")
        if step.get("song") is not None:
            try:
                song_id = int(step["song"])
            except (TypeError, ValueError):
                raise ValueError(f"Step {i}: invalid song.")
            if not song_exists(song_id):
                raise ValueError(f"Step {i}: song {song_id} doesn't exist.")
            out.append({"song": song_id, "section": sid})
        else:
            out.append({"section": sid})
    return out


# --- expansion -----------------------------------------------------------


def _pick_lyrics(song, language):
    lyrics = list(song.lyrics.all().order_by("id"))
    if not lyrics:
        return None, []
    chosen = next((l for l in lyrics if l.language.lower() == (language or "").lower()), lyrics[0])
    return chosen, [l.language for l in lyrics]


def expand(song, steps, language=None):
    """
    Expand steps into display items for `language` (falls back to the song's
    first lyrics). With steps=None, sections are listed in their written order.
    """
    from .models import Song  # local import: models imports nothing from here

    lyrics, languages = _pick_lyrics(song, language)
    sections = {s["id"]: s for s in (lyrics.segments if lyrics else [])}
    if steps is None:
        steps = [{"section": sid} for sid in sections]

    borrowed_cache, borrowed = {}, {}
    items = []
    for step in steps:
        if "marker" in step:
            items.append({"kind": "marker", "label": step["label"]})
            continue
        source = None
        pool = sections
        if step.get("song") is not None and step["song"] != song.id:
            sid = step["song"]
            if sid not in borrowed_cache:
                other = Song.objects.filter(pk=sid).prefetch_related("lyrics").first()
                other_lyrics = _pick_lyrics(other, lyrics.language if lyrics else language)[0] if other else None
                borrowed_cache[sid] = (
                    other,
                    {s["id"]: s for s in (other_lyrics.segments if other_lyrics else [])},
                )
            other, pool = borrowed_cache[sid]
            if other is None:
                items.append({"kind": "missing", "id": step["section"], "song": None})
                continue
            source = {
                "id": other.id,
                "title": other.title,
                "ccli_number": other.ccli_number,
                "copyright_holder": other.copyright_holder,
            }
            borrowed[other.id] = source
        sec = pool.get(step["section"])
        if sec is None:
            items.append({"kind": "missing", "id": step["section"], "song": source})
        else:
            items.append(
                {
                    "kind": "section",
                    "id": sec["id"],
                    "label": sec["label"],
                    "lines": sec["lines"],
                    "song": source,
                }
            )
    return {
        "language": lyrics.language if lyrics else None,
        "languages": languages,
        "items": items,
        "borrowed": list(borrowed.values()),
    }
