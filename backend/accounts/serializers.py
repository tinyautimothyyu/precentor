from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.db import transaction
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from catalog.models import Congregation, Team

from .models import Membership

User = get_user_model()


class MeSerializer(serializers.ModelSerializer):
    role = serializers.CharField(source="membership.role", read_only=True)
    is_approved = serializers.BooleanField(
        source="membership.is_approved", read_only=True
    )
    team = serializers.PrimaryKeyRelatedField(
        source="membership.team", read_only=True
    )
    team_name = serializers.CharField(
        source="membership.team.name", read_only=True, default=None
    )
    congregation = serializers.PrimaryKeyRelatedField(
        source="membership.congregation", read_only=True
    )
    is_staff = serializers.BooleanField(read_only=True)

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "email",
            "is_staff",
            "role",
            "is_approved",
            "team",
            "team_name",
            "congregation",
        ]


class RegisterSerializer(serializers.Serializer):
    username = serializers.CharField()
    email = serializers.EmailField(required=False, allow_blank=True)
    password = serializers.CharField(write_only=True, validators=[validate_password])
    role = serializers.ChoiceField(
        choices=Membership.Role.choices, default=Membership.Role.VOLUNTEER
    )
    congregation = serializers.PrimaryKeyRelatedField(
        queryset=Congregation.objects.all(), required=False, allow_null=True
    )
    team = serializers.PrimaryKeyRelatedField(
        queryset=Team.objects.all(), required=False, allow_null=True
    )

    def validate_username(self, value):
        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError("That username is taken.")
        return value

    @transaction.atomic
    def create(self, validated_data):
        # The post_save signal creates a default (pending) Membership; we then
        # apply the requested role/team but keep is_approved=False until an
        # admin approves.
        user = User.objects.create_user(
            username=validated_data["username"],
            email=validated_data.get("email", ""),
            password=validated_data["password"],
        )
        membership = user.membership
        membership.role = validated_data["role"]
        membership.congregation = validated_data.get("congregation")
        membership.team = validated_data.get("team")
        membership.is_approved = False
        membership.save()
        return user


class PrecentorTokenObtainPairSerializer(TokenObtainPairSerializer):
    """Embed role/team/approval claims for UI gating (server checks remain authoritative)."""

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        membership = getattr(user, "membership", None)
        token["role"] = membership.role if membership else None
        token["team_id"] = membership.team_id if membership else None
        token["is_approved"] = membership.is_approved if membership else False
        token["is_staff"] = user.is_staff
        return token
