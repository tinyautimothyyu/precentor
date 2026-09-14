"""
Core data model for the worship ministry catalog (MVP).

Mirrors Section 4 of the requirements doc. Design decisions baked in here:
- Relational core with JSONB (segments, line_pairing) for flexible nested data.
- Licensing fields are mandatory on Song from day one, not retrofitted later.
- Tags are a controlled vocabulary (Tag model with a category) rather than a
  free-text array, so the taxonomy stays consistent as the library grows.
- Translation status is an explicit workflow so drafts are never treated as
  service-ready without human verification.
"""
from django.conf import settings
from django.contrib.postgres.fields import ArrayField
from django.db import models


class TimeStampedModel(models.Model):
    """Audit timestamps shared by catalog entities."""

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


# --- Shared choice vocabularies ------------------------------------------


class SheetType(models.TextChoices):
    CHORD_CHART = "chord_chart", "Chord chart"
    LEAD_SHEET = "lead_sheet", "Lead sheet"
    PIANO_SCORE = "piano_score", "Piano score"
    HYMNAL = "hymnal", "Hymnal"
    VOCAL_ONLY = "vocal_only", "Vocal only"


class BilingualDisplay(models.TextChoices):
    NONE = "none", "None"
    STACKED = "stacked", "Stacked"
    SIDE_BY_SIDE = "side_by_side", "Side by side"


# --- Organization --------------------------------------------------------


class Congregation(TimeStampedModel):
    """A congregation holds the stable defaults (language, format, display)."""

    name = models.CharField(max_length=200, unique=True)
    primary_language = models.CharField(max_length=50)
    secondary_languages = ArrayField(
        models.CharField(max_length=50),
        blank=True,
        default=list,
        help_text="Additional languages served by this congregation.",
    )
    bilingual_display_default = models.CharField(
        max_length=20,
        choices=BilingualDisplay.choices,
        default=BilingualDisplay.NONE,
    )
    default_sheet_format = models.CharField(
        max_length=20,
        choices=SheetType.choices,
        default=SheetType.CHORD_CHART,
    )
    song_restrictions = ArrayField(
        models.CharField(max_length=200),
        blank=True,
        default=list,
        help_text="Notes on songs this congregation avoids (e.g. theology, style).",
    )

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Team(TimeStampedModel):
    """A rotating team belonging to a congregation."""

    name = models.CharField(max_length=200)
    congregation = models.ForeignKey(
        Congregation, on_delete=models.CASCADE, related_name="teams"
    )
    rotation_schedule = models.TextField(
        blank=True, help_text="Optional free-text rotation notes."
    )

    class Meta:
        ordering = ["congregation__name", "name"]
        unique_together = [("congregation", "name")]

    def __str__(self):
        return f"{self.name} ({self.congregation.name})"


# --- Tags (controlled vocabulary) ----------------------------------------


class Tag(models.Model):
    class Category(models.TextChoices):
        THEME = "theme", "Theme"
        SCRIPTURE = "scripture_ref", "Scripture reference"
        SEASON = "season", "Season"
        LANGUAGE = "language", "Language"
        MOOD = "mood", "Mood"

    category = models.CharField(max_length=20, choices=Category.choices)
    name = models.CharField(max_length=100)

    class Meta:
        ordering = ["category", "name"]
        unique_together = [("category", "name")]

    def __str__(self):
        return f"{self.get_category_display()}: {self.name}"


# --- Song ----------------------------------------------------------------


class Song(TimeStampedModel):
    title = models.CharField(max_length=300)
    alternate_titles = ArrayField(
        models.CharField(max_length=300), blank=True, default=list
    )

    # Licensing — mandatory from MVP. Enter a CCLI number, or "Public Domain".
    ccli_number = models.CharField(
        max_length=50,
        help_text="CCLI song number, or 'Public Domain' if not licensed.",
    )
    copyright_holder = models.CharField(max_length=300)
    licensing_notes = models.TextField(blank=True)

    default_key = models.CharField(max_length=10, blank=True)
    tempo = models.PositiveIntegerField(
        null=True, blank=True, help_text="Beats per minute."
    )

    tags = models.ManyToManyField(Tag, blank=True, related_name="songs")

    owner_team = models.ForeignKey(
        "Team",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="owned_songs",
        help_text="Team that owns this content. Null = admin-owned.",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="songs_created",
    )

    class Meta:
        ordering = ["title"]

    def __str__(self):
        return self.title


# --- Lyrics & translation ------------------------------------------------


class SongLyrics(TimeStampedModel):
    class Source(models.TextChoices):
        OFFICIAL = "official", "Official"
        TEAM = "team_translated", "Team translated"
        AI = "ai_assisted", "AI assisted"

    class Status(models.TextChoices):
        ORIGINAL = "original", "Original"
        TRANSLATED_UNVERIFIED = "translated_unverified", "Translated (unverified)"
        TRANSLATED_VERIFIED = "translated_verified", "Translated (verified)"
        NEEDS_TRANSLATION = "needs_translation", "Needs translation"
        NEEDS_ALIGNMENT = "needs_alignment", "Needs alignment"

    song = models.ForeignKey(
        Song, on_delete=models.CASCADE, related_name="lyrics"
    )
    owner_team = models.ForeignKey(
        "Team",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="owned_lyrics",
        help_text="Team that owns this content. Null = admin-owned.",
    )
    language = models.CharField(max_length=50)
    segments = models.JSONField(
        default=list,
        blank=True,
        help_text=(
            'List of segments, e.g. '
            '[{"segment_type": "verse1", "lines": ["...", "..."]}]'
        ),
    )
    translation_source = models.CharField(
        max_length=20, choices=Source.choices, default=Source.OFFICIAL
    )
    status = models.CharField(
        max_length=25, choices=Status.choices, default=Status.ORIGINAL
    )

    class Meta:
        verbose_name_plural = "Song lyrics"
        unique_together = [("song", "language")]
        ordering = ["song__title", "language"]

    def __str__(self):
        return f"{self.song.title} [{self.language}]"


class LyricAlignment(TimeStampedModel):
    """
    Explicit line-level pairing between two languages of a song. Required
    because translations rarely have matching line counts, so alignment must
    be captured at entry time, not assumed at render time.
    """

    song = models.ForeignKey(
        Song, on_delete=models.CASCADE, related_name="alignments"
    )
    owner_team = models.ForeignKey(
        "Team",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="owned_alignments",
        help_text="Team that owns this content. Null = admin-owned.",
    )
    primary_language = models.CharField(max_length=50)
    secondary_language = models.CharField(max_length=50)
    line_pairing = models.JSONField(
        default=list,
        blank=True,
        help_text="Confirmed segment/line correspondence across languages.",
    )

    class Meta:
        unique_together = [("song", "primary_language", "secondary_language")]
        ordering = ["song__title"]

    def __str__(self):
        return (
            f"{self.song.title}: {self.primary_language} ↔ {self.secondary_language}"
        )


# --- Sheet files ---------------------------------------------------------


def sheet_upload_path(instance, filename):
    return f"sheets/song_{instance.song_id}/{filename}"


class SheetFile(TimeStampedModel):
    class Source(models.TextChoices):
        PURCHASED = "purchased", "Purchased"
        TRANSCRIBED = "transcribed", "Transcribed"
        ARRANGED = "arranged", "Arranged"

    song = models.ForeignKey(
        Song, on_delete=models.CASCADE, related_name="sheets"
    )
    owner_team = models.ForeignKey(
        "Team",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="owned_sheets",
        help_text="Team that owns this content. Null = admin-owned.",
    )
    type = models.CharField(max_length=20, choices=SheetType.choices)
    key = models.CharField(max_length=10, blank=True)
    file = models.FileField(upload_to=sheet_upload_path)
    source = models.CharField(
        max_length=20, choices=Source.choices, default=Source.PURCHASED
    )
    preferred_by_teams = models.ManyToManyField(
        Team, blank=True, related_name="preferred_sheets"
    )
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="sheets_uploaded",
    )

    class Meta:
        ordering = ["song__title", "type", "key"]

    def __str__(self):
        return f"{self.song.title} — {self.get_type_display()} ({self.key or 'n/a'})"
