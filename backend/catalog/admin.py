"""
Django admin is the MVP data-entry UI. The goal is that a staff member can
enter a real song end to end — metadata, licensing, tags, lyrics in one or
more languages, and multiple sheet files — from a single song page.
"""
from django.contrib import admin
from django.utils.html import format_html

from .models import (
    Congregation,
    LyricAlignment,
    SheetFile,
    Song,
    SongLyrics,
    Tag,
    Team,
)


# --- Inlines on the Song page --------------------------------------------


class SongLyricsInline(admin.StackedInline):
    model = SongLyrics
    extra = 0
    fields = ("language", "status", "translation_source", "segments")


class SheetFileInline(admin.TabularInline):
    model = SheetFile
    extra = 0
    fields = ("type", "key", "file", "source", "preferred_by_teams")
    autocomplete_fields = ("preferred_by_teams",)


class LyricAlignmentInline(admin.TabularInline):
    model = LyricAlignment
    extra = 0
    fields = ("primary_language", "secondary_language", "line_pairing")


# --- Song ----------------------------------------------------------------


@admin.register(Song)
class SongAdmin(admin.ModelAdmin):
    list_display = (
        "title",
        "default_key",
        "ccli_number",
        "language_summary",
        "sheet_count",
        "tag_summary",
    )
    list_filter = ("tags__category", "tags", "lyrics__language", "lyrics__status")
    search_fields = ("title", "alternate_titles", "ccli_number", "copyright_holder")
    filter_horizontal = ("tags",)
    inlines = [SongLyricsInline, SheetFileInline, LyricAlignmentInline]
    readonly_fields = ("created_by", "created_at", "updated_at")

    fieldsets = (
        (None, {"fields": ("title", "alternate_titles", "default_key", "tempo")}),
        (
            "Licensing (required)",
            {
                "fields": ("ccli_number", "copyright_holder", "licensing_notes"),
                "description": "Every song must record its licensing status.",
            },
        ),
        ("Tags", {"fields": ("tags",)}),
        (
            "Audit",
            {
                "classes": ("collapse",),
                "fields": ("created_by", "created_at", "updated_at"),
            },
        ),
    )

    def get_queryset(self, request):
        qs = super().get_queryset(request)
        return qs.prefetch_related("tags", "lyrics", "sheets")

    @admin.display(description="Languages")
    def language_summary(self, obj):
        langs = sorted({ly.language for ly in obj.lyrics.all()})
        return ", ".join(langs) if langs else "—"

    @admin.display(description="Sheets")
    def sheet_count(self, obj):
        return obj.sheets.count()

    @admin.display(description="Tags")
    def tag_summary(self, obj):
        names = [t.name for t in obj.tags.all()[:5]]
        return ", ".join(names) if names else "—"

    def save_model(self, request, obj, form, change):
        if not change and not obj.created_by_id:
            obj.created_by = request.user
        super().save_model(request, obj, form, change)

    def save_formset(self, request, form, formset, change):
        instances = formset.save(commit=False)
        for instance in instances:
            if isinstance(instance, SheetFile) and not instance.uploaded_by_id:
                instance.uploaded_by = request.user
            instance.save()
        formset.save_m2m()
        for obj in formset.deleted_objects:
            obj.delete()


# --- Organization --------------------------------------------------------


class TeamInline(admin.TabularInline):
    model = Team
    extra = 0
    fields = ("name", "rotation_schedule")


@admin.register(Congregation)
class CongregationAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "primary_language",
        "bilingual_display_default",
        "default_sheet_format",
    )
    search_fields = ("name", "primary_language")
    inlines = [TeamInline]


@admin.register(Team)
class TeamAdmin(admin.ModelAdmin):
    list_display = ("name", "congregation")
    list_filter = ("congregation",)
    search_fields = ("name",)


# --- Tags ----------------------------------------------------------------


@admin.register(Tag)
class TagAdmin(admin.ModelAdmin):
    list_display = ("name", "category", "song_count")
    list_filter = ("category",)
    search_fields = ("name",)

    @admin.display(description="Songs")
    def song_count(self, obj):
        return obj.songs.count()


# --- Lyrics & sheets (also editable standalone) --------------------------


@admin.register(SongLyrics)
class SongLyricsAdmin(admin.ModelAdmin):
    list_display = ("song", "language", "status", "translation_source")
    list_filter = ("status", "translation_source", "language")
    search_fields = ("song__title", "language")
    autocomplete_fields = ("song",)


@admin.register(SheetFile)
class SheetFileAdmin(admin.ModelAdmin):
    list_display = ("song", "type", "key", "source", "file_link")
    list_filter = ("type", "source", "key")
    search_fields = ("song__title",)
    autocomplete_fields = ("song", "preferred_by_teams")

    @admin.display(description="File")
    def file_link(self, obj):
        if obj.file:
            return format_html('<a href="{}" target="_blank">open</a>', obj.file.url)
        return "—"
