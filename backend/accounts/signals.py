from django.conf import settings
from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import Membership


@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def ensure_membership(sender, instance, created, **kwargs):
    """
    Every user gets a Membership. Staff/superusers are auto-approved as
    leaders (they are the admin super-role); everyone else starts pending.
    """
    if not created:
        return
    Membership.objects.get_or_create(
        user=instance,
        defaults={
            "role": Membership.Role.LEADER
            if instance.is_staff
            else Membership.Role.VOLUNTEER,
            "is_approved": instance.is_staff,
        },
    )
