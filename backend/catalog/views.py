from django.http import FileResponse, Http404
from rest_framework import permissions, viewsets
from rest_framework.decorators import action

from .filters import SongFilter
from .models import Congregation, LyricAlignment, SheetFile, Song, SongLyrics, Tag
from .permissions import IsApproved, IsLeaderOwnerOrReadOnly
from .serializers import (
    CongregationSerializer,
    LyricAlignmentSerializer,
    SheetFileSerializer,
    SheetFileWriteSerializer,
    SongDetailSerializer,
    SongLyricsSerializer,
    SongListSerializer,
    SongWriteSerializer,
    TagSerializer,
)


def _team_of(user):
    m = getattr(user, "membership", None)
    return m.team if m else None


class OwnedModelViewSet(viewsets.ModelViewSet):
    """
    Shared behaviour: reads are public; writes require an approved leader who
    owns the object (staff bypass). New content is stamped with the creator's
    team so object-level ownership checks work on later edits.
    """

    permission_classes = [IsLeaderOwnerOrReadOnly]

    def perform_create(self, serializer):
        serializer.save(owner_team=_team_of(self.request.user))


class SongViewSet(OwnedModelViewSet):
    filterset_class = SongFilter
    search_fields = ["title", "alternate_titles", "ccli_number"]
    ordering_fields = ["title", "tempo", "updated_at"]
    ordering = ["title"]

    def get_queryset(self):
        return (
            Song.objects.all()
            .prefetch_related("tags", "lyrics", "sheets", "alignments")
            .distinct()
        )

    def get_serializer_class(self):
        if self.action == "retrieve":
            return SongDetailSerializer
        if self.action in ("create", "update", "partial_update"):
            return SongWriteSerializer
        return SongListSerializer

    def perform_create(self, serializer):
        serializer.save(
            owner_team=_team_of(self.request.user),
            created_by=self.request.user,
        )


class SheetFileViewSet(OwnedModelViewSet):
    queryset = SheetFile.objects.select_related("song").all()

    def get_serializer_class(self):
        if self.action in ("create", "update", "partial_update"):
            return SheetFileWriteSerializer
        return SheetFileSerializer

    def perform_create(self, serializer):
        serializer.save(
            owner_team=_team_of(self.request.user),
            uploaded_by=self.request.user,
        )

    @action(
        detail=True,
        methods=["get"],
        permission_classes=[IsApproved],
    )
    def download(self, request, pk=None):
        """Auth-gated file download for any approved account, all songs."""
        sheet = self.get_object()
        if not sheet.file:
            raise Http404("No file for this sheet.")
        # Works for local FS and S3 alike via the storage API.
        return FileResponse(
            sheet.file.open("rb"),
            as_attachment=True,
            filename=sheet.file.name.split("/")[-1],
        )


class SongLyricsViewSet(OwnedModelViewSet):
    queryset = SongLyrics.objects.select_related("song").all()
    serializer_class = SongLyricsSerializer
    filterset_fields = ["song", "language", "status"]


class LyricAlignmentViewSet(OwnedModelViewSet):
    queryset = LyricAlignment.objects.select_related("song").all()
    serializer_class = LyricAlignmentSerializer
    filterset_fields = ["song"]


class TagViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Tag.objects.all()
    serializer_class = TagSerializer
    permission_classes = [permissions.AllowAny]
    filterset_fields = ["category"]
    search_fields = ["name"]


class CongregationViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Congregation.objects.prefetch_related("teams").all()
    serializer_class = CongregationSerializer
    permission_classes = [permissions.AllowAny]
