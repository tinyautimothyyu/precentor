import json
import urllib.parse
import urllib.request

from django.conf import settings
from django.http import FileResponse, Http404
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from .filters import SongFilter
from .models import (
    Congregation,
    LyricAlignment,
    Service,
    ServiceSong,
    SheetFile,
    Song,
    SongLyrics,
    Tag,
)
from .permissions import (
    IsApproved,
    IsLeaderOwnerOrReadOnly,
    IsServiceTeamLeaderOrReadOnly,
)
from .serializers import (
    CongregationSerializer,
    LyricAlignmentSerializer,
    ServiceDetailSerializer,
    ServiceListSerializer,
    ServiceSongSerializer,
    ServiceWriteSerializer,
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


# --- Services -------------------------------------------------------------


class ServiceViewSet(viewsets.ModelViewSet):
    """
    Worship services (the "album"). Any approved account can view; only the
    owning team's leaders can create/edit.
    """

    permission_classes = [IsServiceTeamLeaderOrReadOnly]
    filterset_fields = ["team", "congregation"]
    ordering_fields = ["date"]
    ordering = ["-date"]

    def get_queryset(self):
        return (
            Service.objects.select_related("team", "congregation")
            .prefetch_related("items__song")
            .all()
        )

    def get_serializer_class(self):
        if self.action == "retrieve":
            return ServiceDetailSerializer
        if self.action in ("create", "update", "partial_update"):
            return ServiceWriteSerializer
        return ServiceListSerializer

    def perform_create(self, serializer):
        team = _team_of(self.request.user)
        if team is None:
            raise PermissionDenied("You must belong to a team to create a service.")
        serializer.save(
            team=team,
            congregation=team.congregation,
            created_by=self.request.user,
        )

    @action(detail=True, methods=["post"])
    def reorder(self, request, pk=None):
        """Body: {"item_ids": [id, id, ...]} — sets each item's order by index."""
        service = self.get_object()  # runs object perm check (team leader)
        item_ids = request.data.get("item_ids", [])
        existing = list(service.items.values_list("id", flat=True))
        if sorted(item_ids) != sorted(existing):
            raise ValidationError("item_ids must list exactly this service's items.")
        by_id = {s.id: s for s in service.items.all()}
        for index, item_id in enumerate(item_ids):
            item = by_id[item_id]
            item.order = index
            item.save(update_fields=["order"])
        serializer = ServiceDetailSerializer(service, context={"request": request})
        return Response(serializer.data)


class ServiceSongViewSet(viewsets.ModelViewSet):
    """Add/remove/adjust songs within a service (owning team's leaders only)."""

    queryset = ServiceSong.objects.select_related("service", "song").all()
    serializer_class = ServiceSongSerializer
    permission_classes = [IsServiceTeamLeaderOrReadOnly]
    filterset_fields = ["service"]

    def _check_can_manage(self, service):
        user = self.request.user
        if user.is_staff:
            return
        m = getattr(user, "membership", None)
        if not (m and m.is_leader and m.team_id == service.team_id):
            raise PermissionDenied("Only the service's team leader can change it.")

    def perform_create(self, serializer):
        service = serializer.validated_data["service"]
        self._check_can_manage(service)
        last = service.items.order_by("-order").first()
        next_order = (last.order + 1) if last else 0
        serializer.save(order=next_order)


# --- Integrations & config -----------------------------------------------


class YouTubeSearchView(APIView):
    """Proxy YouTube Data API search so the API key stays server-side."""

    permission_classes = [IsApproved]

    def get(self, request):
        if not settings.YOUTUBE_API_KEY:
            return Response(
                {"detail": "YouTube search not configured."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        q = request.query_params.get("q", "").strip()
        if not q:
            return Response([])
        params = urllib.parse.urlencode(
            {
                "part": "snippet",
                "type": "video",
                "maxResults": 8,
                "q": q,
                "key": settings.YOUTUBE_API_KEY,
            }
        )
        url = f"https://www.googleapis.com/youtube/v3/search?{params}"
        try:
            with urllib.request.urlopen(url, timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except Exception:
            return Response(
                {"detail": "YouTube search failed."},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        results = [
            {
                "video_id": item["id"]["videoId"],
                "title": item["snippet"]["title"],
                "channel": item["snippet"]["channelTitle"],
                "thumbnail": item["snippet"]["thumbnails"]["default"]["url"],
            }
            for item in data.get("items", [])
            if item.get("id", {}).get("videoId")
        ]
        return Response(results)


@api_view(["GET"])
@permission_classes([permissions.AllowAny])
def config_view(request):
    """Public feature flags for the frontend."""
    return Response({"youtube_search": bool(settings.YOUTUBE_API_KEY)})
