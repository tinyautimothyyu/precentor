from rest_framework import serializers

from .permissions import is_approved_member

from .models import (
    Congregation,
    LyricAlignment,
    Service,
    ServiceSong,
    SheetFile,
    Song,
    SongLyrics,
    Tag,
    Team,
)


class TagSerializer(serializers.ModelSerializer):
    category_display = serializers.CharField(
        source="get_category_display", read_only=True
    )

    class Meta:
        model = Tag
        fields = ["id", "name", "category", "category_display"]


def _team_name(team):
    return team.name if team else None


class SheetFileSerializer(serializers.ModelSerializer):
    type_display = serializers.CharField(source="get_type_display", read_only=True)
    download_url = serializers.SerializerMethodField()
    has_file = serializers.SerializerMethodField()
    preferred_by_teams = serializers.PrimaryKeyRelatedField(
        many=True, read_only=True
    )
    filename = serializers.SerializerMethodField()
    owner_team_name = serializers.SerializerMethodField()
    uploaded_by_name = serializers.SerializerMethodField()
    uploaded_at = serializers.DateTimeField(source="created_at", read_only=True)

    class Meta:
        model = SheetFile
        fields = [
            "id",
            "type",
            "type_display",
            "key",
            "source",
            "owner_team",
            "download_url",
            "has_file",
            "preferred_by_teams",
            "filename",
            "owner_team_name",
            "uploaded_by_name",
            "uploaded_at",
        ]

    def get_has_file(self, obj):
        return bool(obj.file)

    def get_filename(self, obj):
        if obj.original_filename:
            return obj.original_filename
        return obj.file.name.rsplit("/", 1)[-1] if obj.file else None

    def get_owner_team_name(self, obj):
        # The uploader's team at upload time (owner_team is stamped on create).
        return _team_name(obj.owner_team)

    def get_uploaded_by_name(self, obj):
        # Member names are only shown to logged-in, approved members.
        request = self.context.get("request")
        if not obj.uploaded_by or not is_approved_member(getattr(request, "user", None)):
            return None
        user = obj.uploaded_by
        return user.get_full_name() or user.username

    def get_download_url(self, obj):
        # Auth-gated endpoint — never the raw public media URL.
        if not obj.file:
            return None
        request = self.context.get("request")
        path = f"/api/sheets/{obj.id}/download/"
        return request.build_absolute_uri(path) if request else path


class SongLyricsSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(
        source="get_status_display", read_only=True
    )

    class Meta:
        model = SongLyrics
        fields = [
            "id",
            "song",
            "owner_team",
            "language",
            "segments",
            "translation_source",
            "status",
            "status_display",
        ]
        read_only_fields = ["owner_team"]
        extra_kwargs = {"song": {"required": True}}


class LyricAlignmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = LyricAlignment
        fields = [
            "id",
            "song",
            "owner_team",
            "primary_language",
            "secondary_language",
            "line_pairing",
        ]
        read_only_fields = ["owner_team"]


class SongListSerializer(serializers.ModelSerializer):
    """Lightweight representation for the browse/search grid."""

    tags = TagSerializer(many=True, read_only=True)
    languages = serializers.SerializerMethodField()
    sheet_types = serializers.SerializerMethodField()
    owner_team_name = serializers.SerializerMethodField()
    owner_congregation_name = serializers.SerializerMethodField()

    class Meta:
        model = Song
        fields = [
            "id",
            "title",
            "alternate_titles",
            "default_key",
            "tempo",
            "ccli_number",
            "tags",
            "owner_team",
            "owner_team_name",
            "owner_congregation_name",
            "languages",
            "sheet_types",
        ]

    def get_owner_team_name(self, obj):
        return _team_name(obj.owner_team)

    def get_owner_congregation_name(self, obj):
        return obj.owner_team.congregation.name if obj.owner_team else None

    def get_languages(self, obj):
        return sorted({ly.language for ly in obj.lyrics.all()})

    def get_sheet_types(self, obj):
        return sorted({s.type for s in obj.sheets.all()})


class SongDetailSerializer(SongListSerializer):
    """Full song view with all variants — the music-stand detail page."""

    copyright_holder = serializers.CharField(read_only=True)
    licensing_notes = serializers.CharField(read_only=True)
    lyrics = SongLyricsSerializer(many=True, read_only=True)
    sheets = SheetFileSerializer(many=True, read_only=True)
    alignments = LyricAlignmentSerializer(many=True, read_only=True)

    class Meta(SongListSerializer.Meta):
        fields = SongListSerializer.Meta.fields + [
            "copyright_holder",
            "licensing_notes",
            "reference_url",
            "lyrics",
            "sheets",
            "alignments",
            "created_at",
            "updated_at",
        ]


class SongWriteSerializer(serializers.ModelSerializer):
    """Create/update payload for songs (leaders, via the SPA)."""

    tags = serializers.PrimaryKeyRelatedField(
        many=True, queryset=Tag.objects.all(), required=False
    )

    class Meta:
        model = Song
        fields = [
            "id",
            "title",
            "alternate_titles",
            "ccli_number",
            "copyright_holder",
            "licensing_notes",
            "default_key",
            "tempo",
            "reference_url",
            "tags",
            "owner_team",
        ]
        read_only_fields = ["owner_team"]


class SheetFileWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = SheetFile
        fields = [
            "id",
            "song",
            "type",
            "key",
            "source",
            "file",
            "preferred_by_teams",
            "owner_team",
            "original_filename",
        ]
        read_only_fields = ["owner_team", "original_filename"]
        extra_kwargs = {"file": {"required": True}}


class TeamSerializer(serializers.ModelSerializer):
    class Meta:
        model = Team
        fields = ["id", "name", "congregation", "rotation_schedule"]


class CongregationSerializer(serializers.ModelSerializer):
    teams = TeamSerializer(many=True, read_only=True)

    class Meta:
        model = Congregation
        fields = [
            "id",
            "name",
            "primary_language",
            "secondary_languages",
            "bilingual_display_default",
            "default_sheet_format",
            "song_restrictions",
            "teams",
        ]


# --- Services -------------------------------------------------------------


class ServiceSheetSerializer(serializers.ModelSerializer):
    """Sheet summary for a service item; the file itself stays behind /download/."""

    type_display = serializers.CharField(source="get_type_display", read_only=True)
    has_file = serializers.SerializerMethodField()

    class Meta:
        model = SheetFile
        fields = ["id", "type", "type_display", "key", "has_file"]

    def get_has_file(self, obj):
        return bool(obj.file)


class ServiceSongSongSerializer(serializers.ModelSerializer):
    """Light song block embedded in a service item (for the playlist)."""

    sheets = ServiceSheetSerializer(many=True, read_only=True)

    class Meta:
        model = Song
        fields = ["id", "title", "default_key", "reference_url", "owner_team", "sheets"]


class ServiceSongSerializer(serializers.ModelSerializer):
    song_detail = ServiceSongSongSerializer(source="song", read_only=True)
    # Effective track: the per-service override, else the song's default.
    reference_url = serializers.CharField(read_only=True)

    class Meta:
        model = ServiceSong
        fields = [
            "id",
            "service",
            "song",
            "song_detail",
            "order",
            "key_override",
            "format_override",
            "reference_url_override",
            "reference_url",
        ]
        read_only_fields = ["order"]

    def get_fields(self):
        fields = super().get_fields()
        # An item can't be moved to another service (or swapped to another song)
        # after creation: permission checks only cover the item's current service.
        if self.instance is not None:
            fields["service"].read_only = True
            fields["song"].read_only = True
        return fields


class ServiceListSerializer(serializers.ModelSerializer):
    team_name = serializers.CharField(source="team.name", read_only=True)
    item_count = serializers.IntegerField(source="items.count", read_only=True)

    class Meta:
        model = Service
        fields = ["id", "team", "team_name", "date", "title", "item_count"]


class ServiceDetailSerializer(ServiceListSerializer):
    items = ServiceSongSerializer(many=True, read_only=True)

    class Meta(ServiceListSerializer.Meta):
        fields = ServiceListSerializer.Meta.fields + [
            "congregation",
            "notes",
            "items",
            "created_at",
            "updated_at",
        ]


class ServiceWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Service
        fields = ["id", "date", "title", "notes", "congregation", "team"]
        read_only_fields = ["team"]
