from django.contrib import admin

from .models import Membership


@admin.register(Membership)
class MembershipAdmin(admin.ModelAdmin):
    list_display = ("user", "role", "congregation", "team", "is_approved")
    list_filter = ("is_approved", "role", "congregation", "team")
    list_editable = ("role", "is_approved")
    search_fields = ("user__username", "user__email")
    autocomplete_fields = ("congregation", "team")
    actions = ["approve_selected"]

    @admin.action(description="Approve selected members")
    def approve_selected(self, request, queryset):
        updated = queryset.update(is_approved=True)
        self.message_user(request, f"Approved {updated} member(s).")
