"""Root URL configuration."""
from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/", include("accounts.urls")),
    path("api/", include("catalog.urls")),
    path("", include("core.urls")),
]

# NOTE: sheet files are intentionally NOT served from a public /media/ URL.
# Downloads go through the auth-gated /api/sheets/<id>/download/ endpoint so
# they cannot be retrieved by guessing paths.
