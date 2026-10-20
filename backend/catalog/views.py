import json
import urllib.parse
import urllib.request

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Case, Prefetch, Q, When
from django.http import FileResponse, Http404
from rest_framework import mixins, permissions, status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from . import lookup as song_lookup
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
    TagCreateSerializer,
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
            Song.objects.select_related("owner_team__congregation")
            .prefetch_related(
                "tags",
                "lyrics",
                "alignments",
                Prefetch(
                    "sheets",
                    queryset=SheetFile.objects.select_related(
                        "owner_team", "uploaded_by"
                    ),
                ),
            )
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
    queryset = SheetFile.objects.select_related(
        "song", "owner_team", "uploaded_by"
    ).all()

    def get_serializer_class(self):
        if self.action in ("create", "update", "partial_update"):
            return SheetFileWriteSerializer
        return SheetFileSerializer

    def perform_create(self, serializer):
        upload = serializer.validated_data["file"]
        serializer.save(
            owner_team=_team_of(self.request.user),
            uploaded_by=self.request.user,
            original_filename=upload.name.rsplit("/", 1)[-1][:255],
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
            filename=sheet.original_filename or sheet.file.name.split("/")[-1],
        )


class SongLyricsViewSet(OwnedModelViewSet):
    queryset = SongLyrics.objects.select_related("song").all()
    serializer_class = SongLyricsSerializer
    filterset_fields = ["song", "language", "status"]


class LyricAlignmentViewSet(OwnedModelViewSet):
    queryset = LyricAlignment.objects.select_related("song").all()
    serializer_class = LyricAlignmentSerializer
    filterset_fields = ["song"]


class AllTagsPagination(PageNumberPagination):
    # Pickers and filters need the whole vocabulary in one response.
    page_size = 1000


class TagViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    viewsets.GenericViewSet,
):
    """
    Reads are public. Approved leaders can add custom tags; a name that
    already exists in any category (case-insensitive) returns that tag (200)
    instead of creating a near-duplicate.
    """

    queryset = Tag.objects.all()
    permission_classes = [IsLeaderOwnerOrReadOnly]
    pagination_class = AllTagsPagination
    filterset_fields = ["category"]
    search_fields = ["name"]

    def get_serializer_class(self):
        return TagCreateSerializer if self.action == "create" else TagSerializer

    def create(self, request, *args, **kwargs):
        serializer = TagCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        name = serializer.validated_data["name"]

        def existing():
            # Prefer a curated tag over a custom one with the same name.
            return (
                Tag.objects.filter(name__iexact=name)
                .order_by(
                    Case(When(category=Tag.Category.CUSTOM, then=1), default=0),
                    "id",
                )
                .first()
            )

        tag = existing()
        created = False
        if tag is None:
            try:
                with transaction.atomic():
                    tag = Tag.objects.create(
                        name=name,
                        category=Tag.Category.CUSTOM,
                        created_by_team=_team_of(request.user),
                    )
                created = True
            except IntegrityError:  # created concurrently
                tag = existing()
        return Response(
            TagSerializer(tag).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


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
            .prefetch_related("items__song__sheets")
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

    queryset = (
        ServiceSong.objects.select_related("service", "song")
        .prefetch_related("song__sheets")
        .all()
    )
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


def possible_duplicates(title, video_id="", exclude_id=None, limit=5):
    """Existing songs that may be the same song: same video, or similar title."""
    found = {}
    if video_id:
        for song in Song.objects.filter(reference_url__contains=video_id)[:limit]:
            found[song.id] = {"id": song.id, "title": song.title, "reason": "same video"}
    if title:
        similar = Song.objects.filter(
            Q(title__iexact=title)
            | Q(title__icontains=title)
            | Q(alternate_titles__icontains=[title])
        )
        for song in similar[:limit]:
            found.setdefault(
                song.id, {"id": song.id, "title": song.title, "reason": "similar title"}
            )
    found.pop(exclude_id, None)
    return list(found.values())[:limit]


class SongLookupView(APIView):
    """
    POST {"url": "<YouTube or Spotify link>"} -> suggested song fields.

    Each suggested field carries its source so the UI can flag it for review.
    Upstream failures degrade to warnings; only an unusable link is a 400.
    """

    permission_classes = [IsLeaderOwnerOrReadOnly]

    def post(self, request):
        try:
            result = song_lookup.lookup(request.data.get("url", ""))
        except song_lookup.LookupError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        source = result.provider
        fields = {
            name: {"value": value, "source": source}
            for name, value in (
                ("title", result.title),
                ("ccli_number", result.ccli_number),
                ("copyright_holder", result.copyright_holder),
                ("reference_url", result.reference_url),
            )
            if value
        }
        return Response(
            {
                "provider": result.provider,
                "fields": fields,
                "artist": result.artist,
                "songwriters": result.songwriters,
                "warnings": result.warnings,
                "duplicates": possible_duplicates(result.title, result.video_id),
            }
        )


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
