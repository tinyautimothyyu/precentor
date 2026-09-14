"""
Object-level permissions for the catalog.

Tiers:
- Anonymous: read public metadata only.
- Approved (any role): download sheet files (IsApproved).
- Approved leader: create content (owned by their team) and edit/delete only
  content their own team owns (IsLeaderOwnerOrReadOnly).
- Django staff/superuser: bypass all checks (the admin super-role).
"""
from rest_framework import permissions

SAFE_METHODS = permissions.SAFE_METHODS


def _membership(user):
    return getattr(user, "membership", None)


class IsApproved(permissions.BasePermission):
    """Authenticated and approved (or staff). Gates downloads."""

    message = "Your account is pending approval."

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        if user.is_staff:
            return True
        m = _membership(user)
        return bool(m and m.is_approved)


class IsLeaderOwnerOrReadOnly(permissions.BasePermission):
    """
    Reads are open (view decides whether the action is exposed). Writes require
    an approved leader; object-level writes require the leader's team to own
    the object. Staff bypass ownership.
    """

    message = "Only an approved team leader can edit their team's content."

    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return True
        user = request.user
        if not user or not user.is_authenticated:
            return False
        if user.is_staff:
            return True
        m = _membership(user)
        return bool(m and m.is_leader)

    def has_object_permission(self, request, view, obj):
        if request.method in SAFE_METHODS:
            return True
        user = request.user
        if user.is_staff:
            return True
        m = _membership(user)
        if not (m and m.is_leader and m.team_id):
            return False
        return obj.owner_team_id == m.team_id
