from datetime import date

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from accounts.models import Membership

from .models import Congregation, Service, ServiceSong, Song, Team

User = get_user_model()


class ServiceSongApiTests(APITestCase):
    def setUp(self):
        cong = Congregation.objects.create(name="Main", primary_language="en")
        self.team_a = Team.objects.create(name="Team A", congregation=cong)
        self.team_b = Team.objects.create(name="Team B", congregation=cong)
        self.leader_a = self._user("leaderA", self.team_a, Membership.Role.LEADER)
        self.leader_b = self._user("leaderB", self.team_b, Membership.Role.LEADER)
        self.vol = self._user("vol", self.team_a, Membership.Role.VOLUNTEER)

        self.song = Song.objects.create(
            title="Song",
            copyright_holder="Holder",
            reference_url="https://www.youtube.com/watch?v=aaaaaaaaaaa",
            owner_team=self.team_a,
        )
        self.service_a = Service.objects.create(
            team=self.team_a, congregation=cong, date=date(2026, 10, 25)
        )
        self.service_b = Service.objects.create(
            team=self.team_b, congregation=cong, date=date(2026, 10, 25)
        )
        self.item_b = ServiceSong.objects.create(service=self.service_b, song=self.song)

    def _user(self, username, team, role):
        user = User.objects.create_user(username=username, password="pw")
        # A Membership is auto-created for every new user.
        Membership.objects.filter(user=user).update(
            team=team, role=role, is_approved=True
        )
        return User.objects.get(pk=user.pk)  # drop the cached stale membership

    def _url(self, item):
        return f"/api/service-songs/{item.id}/"

    def test_reference_url_falls_back_to_song(self):
        self.client.force_authenticate(self.leader_b)
        data = self.client.get(self._url(self.item_b)).json()
        self.assertEqual(data["reference_url_override"], "")
        self.assertEqual(data["reference_url"], self.song.reference_url)

    def test_override_replaces_song_track_for_this_service_only(self):
        self.client.force_authenticate(self.leader_b)
        live = "https://youtu.be/bbbbbbbbbbb"
        res = self.client.patch(
            self._url(self.item_b), {"reference_url_override": live}, format="json"
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["reference_url"], live)
        self.song.refresh_from_db()
        self.assertEqual(
            self.song.reference_url, "https://www.youtube.com/watch?v=aaaaaaaaaaa"
        )

    def test_override_must_be_a_url(self):
        self.client.force_authenticate(self.leader_b)
        res = self.client.patch(
            self._url(self.item_b), {"reference_url_override": "not a url"}, format="json"
        )
        self.assertEqual(res.status_code, 400)

    def test_key_and_format_overrides(self):
        self.client.force_authenticate(self.leader_b)
        res = self.client.patch(
            self._url(self.item_b),
            {"key_override": "A", "format_override": "lead_sheet"},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["key_override"], "A")
        self.assertEqual(res.json()["format_override"], "lead_sheet")

    def test_cannot_move_item_into_another_teams_service(self):
        self.client.force_authenticate(self.leader_b)
        self.client.patch(
            self._url(self.item_b), {"service": self.service_a.id}, format="json"
        )
        self.item_b.refresh_from_db()
        self.assertEqual(self.item_b.service_id, self.service_b.id)
        self.assertEqual(self.service_a.items.count(), 0)

    def test_other_team_leader_cannot_edit(self):
        self.client.force_authenticate(self.leader_a)
        res = self.client.patch(
            self._url(self.item_b), {"key_override": "A"}, format="json"
        )
        self.assertEqual(res.status_code, 403)

    def test_volunteer_cannot_edit(self):
        item_a = ServiceSong.objects.create(service=self.service_a, song=self.song)
        self.client.force_authenticate(self.vol)
        res = self.client.patch(self._url(item_a), {"key_override": "A"}, format="json")
        self.assertEqual(res.status_code, 403)

    def test_service_detail_includes_sheets_and_effective_url(self):
        self.client.force_authenticate(self.vol)
        data = self.client.get(f"/api/services/{self.service_b.id}/").json()
        item = data["items"][0]
        self.assertIn("sheets", item["song_detail"])
        self.assertEqual(item["song_detail"]["owner_team"], self.team_a.id)
        self.assertEqual(item["reference_url"], self.song.reference_url)
