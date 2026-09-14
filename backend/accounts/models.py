"""
Membership links a Django User to a congregation/team with a role, and gates
access via `is_approved`. Self-signup creates an unapproved Membership; an
admin approves it and assigns role + team in Django admin.

Django superusers/staff are the "admin" super-role and bypass these checks.
"""
from django.conf import settings
from django.db import models

from catalog.models import Congregation, Team


class Membership(models.Model):
    class Role(models.TextChoices):
        LEADER = "leader", "Leader"
        VOLUNTEER = "volunteer", "Volunteer"

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="membership",
    )
    congregation = models.ForeignKey(
        Congregation,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="members",
    )
    team = models.ForeignKey(
        Team,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="members",
    )
    role = models.CharField(
        max_length=20, choices=Role.choices, default=Role.VOLUNTEER
    )
    is_approved = models.BooleanField(
        default=False,
        help_text="Unapproved users can only browse public song metadata.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        state = "approved" if self.is_approved else "pending"
        return f"{self.user.username} — {self.get_role_display()} ({state})"

    @property
    def is_leader(self):
        return self.role == self.Role.LEADER and self.is_approved
