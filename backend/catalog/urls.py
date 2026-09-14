from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    CongregationViewSet,
    LyricAlignmentViewSet,
    ServiceSongViewSet,
    ServiceViewSet,
    SheetFileViewSet,
    SongLyricsViewSet,
    SongViewSet,
    TagViewSet,
    YouTubeSearchView,
    config_view,
)

router = DefaultRouter()
router.register("songs", SongViewSet, basename="song")
router.register("sheets", SheetFileViewSet, basename="sheet")
router.register("lyrics", SongLyricsViewSet, basename="lyrics")
router.register("alignments", LyricAlignmentViewSet, basename="alignment")
router.register("tags", TagViewSet, basename="tag")
router.register("congregations", CongregationViewSet, basename="congregation")
router.register("services", ServiceViewSet, basename="service")
router.register("service-songs", ServiceSongViewSet, basename="servicesong")

urlpatterns = [
    path("config/", config_view, name="config"),
    path("youtube/search/", YouTubeSearchView.as_view(), name="youtube_search"),
    *router.urls,
]
