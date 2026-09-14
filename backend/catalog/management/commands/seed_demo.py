"""
Seed a small, realistic slice of data to exercise the model end to end:
a congregation with a team, tags across categories, and two songs — one
English-only and one bilingual (English + Chinese) with a lyric alignment.

Idempotent: safe to run more than once. For local/demo use only.
"""
from django.core.management.base import BaseCommand

from catalog.models import (
    BilingualDisplay,
    Congregation,
    LyricAlignment,
    SheetType,
    Song,
    SongLyrics,
    Tag,
    Team,
)


class Command(BaseCommand):
    help = "Seed demo congregation, tags, and songs."

    def handle(self, *args, **options):
        cong, _ = Congregation.objects.get_or_create(
            name="Grace Community Church",
            defaults={
                "primary_language": "English",
                "secondary_languages": ["Chinese"],
                "bilingual_display_default": BilingualDisplay.STACKED,
                "default_sheet_format": SheetType.CHORD_CHART,
            },
        )
        Team.objects.get_or_create(name="Sunday AM Team", congregation=cong)

        def tag(category, name):
            obj, _ = Tag.objects.get_or_create(category=category, name=name)
            return obj

        grace = tag(Tag.Category.THEME, "Grace")
        worship = tag(Tag.Category.THEME, "Worship")
        psalm23 = tag(Tag.Category.SCRIPTURE, "Psalm 23")
        advent = tag(Tag.Category.SEASON, "Advent")
        joyful = tag(Tag.Category.MOOD, "Joyful")
        reflective = tag(Tag.Category.MOOD, "Reflective")

        # --- Song 1: English only -------------------------------------
        amazing, created = Song.objects.get_or_create(
            title="Amazing Grace",
            defaults={
                "ccli_number": "Public Domain",
                "copyright_holder": "John Newton (1779)",
                "default_key": "G",
                "tempo": 72,
            },
        )
        if created:
            amazing.tags.set([grace, worship, reflective])
            SongLyrics.objects.create(
                song=amazing,
                language="English",
                status=SongLyrics.Status.ORIGINAL,
                translation_source=SongLyrics.Source.OFFICIAL,
                segments=[
                    {
                        "segment_type": "verse1",
                        "lines": [
                            "Amazing grace, how sweet the sound",
                            "That saved a wretch like me",
                            "I once was lost, but now am found",
                            "Was blind, but now I see",
                        ],
                    }
                ],
            )

        # --- Song 2: bilingual (English + Chinese) --------------------
        shepherd, created = Song.objects.get_or_create(
            title="The Lord Is My Shepherd",
            defaults={
                "ccli_number": "Public Domain",
                "copyright_holder": "Trad. (Psalm 23)",
                "default_key": "D",
                "tempo": 68,
            },
        )
        if created:
            shepherd.tags.set([worship, psalm23, reflective, joyful])
            SongLyrics.objects.create(
                song=shepherd,
                language="English",
                status=SongLyrics.Status.ORIGINAL,
                translation_source=SongLyrics.Source.OFFICIAL,
                segments=[
                    {
                        "segment_type": "verse1",
                        "lines": [
                            "The Lord is my shepherd, I shall not want",
                            "He makes me lie down in green pastures",
                        ],
                    }
                ],
            )
            SongLyrics.objects.create(
                song=shepherd,
                language="Chinese",
                status=SongLyrics.Status.TRANSLATED_VERIFIED,
                translation_source=SongLyrics.Source.TEAM,
                segments=[
                    {
                        "segment_type": "verse1",
                        "lines": [
                            "耶和華是我的牧者，我必不至缺乏",
                            "他使我躺臥在青草地上",
                        ],
                    }
                ],
            )
            LyricAlignment.objects.create(
                song=shepherd,
                primary_language="English",
                secondary_language="Chinese",
                line_pairing=[
                    {"segment": "verse1", "en_line": 0, "zh_line": 0},
                    {"segment": "verse1", "en_line": 1, "zh_line": 1},
                ],
            )

        self.stdout.write(
            self.style.SUCCESS(
                f"Seed complete. Songs={Song.objects.count()} "
                f"Tags={Tag.objects.count()} Congregations={Congregation.objects.count()}"
            )
        )
