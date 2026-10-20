"""Convert legacy segments ({"segment_type": "verse1"}) to sections with ids."""
import re

from django.db import migrations

# Self-contained copy of the mapping (migrations must not depend on app code
# that may change later).
LEGACY = re.compile(
    r"^(verse|chorus|pre-?chorus|bridge|tag|end-?tag|ending|intro|outro)[\s_-]*(\d*)$",
    re.IGNORECASE,
)
CODE = {
    "verse": "V", "chorus": "C", "prechorus": "PC", "pre-chorus": "PC", "bridge": "B",
    "tag": "ET", "endtag": "ET", "end-tag": "ET", "ending": "ET", "intro": "I", "outro": "O",
}
TYPE = {"V": "verse", "PC": "prechorus", "C": "chorus", "B": "bridge", "ET": "tag", "I": "intro", "O": "outro"}
LABEL = {"V": "Verse", "PC": "Pre-chorus", "C": "Chorus", "B": "Bridge", "ET": "End tag", "I": "Intro", "O": "Outro"}


def to_id(segment_type, taken):
    m = LEGACY.match((segment_type or "").strip())
    if m:
        code, num = CODE[m.group(1).lower()], m.group(2)
        sid = f"V{num or 1}" if code == "V" else (code if num in ("", "1") else f"{code}{num}")
        if sid not in taken:
            return sid
    n = 1
    while f"V{n}" in taken:
        n += 1
    return f"V{n}"


def label_for(sid):
    m = re.match(r"^(V|PC|C|B|ET|I|O)(\d*)$", sid)
    code, num = m.groups()
    return f"{LABEL[code]} {num}" if num else LABEL[code]


def forwards(apps, schema_editor):
    SongLyrics = apps.get_model("catalog", "SongLyrics")
    LyricAlignment = apps.get_model("catalog", "LyricAlignment")
    id_maps = {}  # (song_id, old segment_type) -> new id
    for lyr in SongLyrics.objects.all():
        taken, new = set(), []
        for seg in lyr.segments or []:
            if "id" in seg:  # already converted
                taken.add(seg["id"])
                new.append(seg)
                continue
            sid = to_id(seg.get("segment_type"), taken)
            taken.add(sid)
            id_maps[(lyr.song_id, seg.get("segment_type"))] = sid
            code = re.match(r"^(V|PC|C|B|ET|I|O)", sid).group(1)
            new.append({"id": sid, "type": TYPE[code], "label": label_for(sid), "lines": seg.get("lines", [])})
        lyr.segments = new
        lyr.save(update_fields=["segments"])
    for al in LyricAlignment.objects.all():
        changed = False
        for pair in al.line_pairing or []:
            old = pair.get("segment")
            if (al.song_id, old) in id_maps:
                pair["segment"] = id_maps[(al.song_id, old)]
                changed = True
        if changed:
            al.save(update_fields=["line_pairing"])


class Migration(migrations.Migration):
    dependencies = [("catalog", "0008_song_flows")]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
