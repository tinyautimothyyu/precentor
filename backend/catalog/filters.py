import django_filters as filters

from .models import Song


class SongFilter(filters.FilterSet):
    """
    Filtered search for the browse view:
    ?tags=<id>&tags=<id>&language=&key=&sheet_type=&congregation=
    """

    tag = filters.NumberFilter(field_name="tags__id")
    tag_name = filters.CharFilter(field_name="tags__name", lookup_expr="iexact")
    language = filters.CharFilter(
        field_name="lyrics__language", lookup_expr="iexact"
    )
    key = filters.CharFilter(method="filter_key")
    sheet_type = filters.CharFilter(field_name="sheets__type", lookup_expr="iexact")
    congregation = filters.NumberFilter(method="filter_congregation")

    class Meta:
        model = Song
        fields = ["tag", "tag_name", "language", "key", "sheet_type"]

    def filter_key(self, queryset, name, value):
        # Match the song's default key or any sheet available in that key.
        from django.db.models import Q

        return queryset.filter(
            Q(default_key__iexact=value) | Q(sheets__key__iexact=value)
        )

    def filter_congregation(self, queryset, name, value):
        # Songs with lyrics in a language the congregation serves.
        from .models import Congregation

        try:
            cong = Congregation.objects.get(pk=value)
        except Congregation.DoesNotExist:
            return queryset.none()
        langs = [cong.primary_language] + list(cong.secondary_languages)
        return queryset.filter(lyrics__language__in=langs)
