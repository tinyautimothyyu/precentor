from rest_framework.routers import DefaultRouter

from .views import (
    CongregationViewSet,
    LyricAlignmentViewSet,
    SheetFileViewSet,
    SongLyricsViewSet,
    SongViewSet,
    TagViewSet,
)

router = DefaultRouter()
router.register("songs", SongViewSet, basename="song")
router.register("sheets", SheetFileViewSet, basename="sheet")
router.register("lyrics", SongLyricsViewSet, basename="lyrics")
router.register("alignments", LyricAlignmentViewSet, basename="alignment")
router.register("tags", TagViewSet, basename="tag")
router.register("congregations", CongregationViewSet, basename="congregation")

urlpatterns = router.urls
