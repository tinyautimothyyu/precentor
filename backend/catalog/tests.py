import shutil
import tempfile
from datetime import date

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from rest_framework.test import APITestCase

from accounts.models import Membership

from .models import Congregation, Service, ServiceSong, SheetFile, Song, Tag, Team

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


TEMP_MEDIA = tempfile.mkdtemp()


@override_settings(MEDIA_ROOT=TEMP_MEDIA)
class SongProfileApiTests(APITestCase):
    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(TEMP_MEDIA, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        cong = Congregation.objects.create(name="Main", primary_language="en")
        self.team = Team.objects.create(name="Team A", congregation=cong)
        self.leader = self._user("leaderA", Membership.Role.LEADER, approved=True)
        self.leader.first_name, self.leader.last_name = "Lee", "Der"
        self.leader.save()
        self.pending = self._user("pending", Membership.Role.VOLUNTEER, approved=False)
        self.song = Song.objects.create(
            title="Song", copyright_holder="Holder", owner_team=self.team
        )

    def _user(self, username, role, approved):
        user = User.objects.create_user(username=username, password="pw")
        Membership.objects.filter(user=user).update(
            team=self.team, role=role, is_approved=approved
        )
        return User.objects.get(pk=user.pk)

    def _upload(self, name="My Chart.pdf"):
        # Same name each time, but distinct content and a reason, so the
        # duplicate-file and same-format checks don't reject repeat uploads.
        self.uploads = getattr(self, "uploads", 0) + 1
        self.client.force_authenticate(self.leader)
        res = self.client.post(
            "/api/sheets/",
            {
                "song": self.song.id,
                "type": "chord_chart",
                "source": "purchased",
                "upload_reason": "test",
                "file": SimpleUploadedFile(
                    name, b"%%PDF-1.4 test %d" % self.uploads, "application/pdf"
                ),
            },
            format="multipart",
        )
        self.assertEqual(res.status_code, 201, res.content)
        self.client.force_authenticate(None)
        return SheetFile.objects.get(pk=res.json()["id"])

    def _sheet_json(self):
        return self.client.get(f"/api/songs/{self.song.id}/").json()["sheets"][0]

    def test_song_shows_owner_team_and_congregation(self):
        data = self.client.get(f"/api/songs/{self.song.id}/").json()
        self.assertEqual(data["owner_team_name"], "Team A")
        self.assertEqual(data["owner_congregation_name"], "Main")

    def test_unowned_song_has_no_owner_name(self):
        song = Song.objects.create(title="Hymn", copyright_holder="PD")
        data = self.client.get(f"/api/songs/{song.id}/").json()
        self.assertIsNone(data["owner_team_name"])

    def test_original_filename_kept_when_storage_renames(self):
        first = self._upload()
        second = self._upload()  # same name: storage stores it under a new name
        self.assertNotEqual(first.file.name, second.file.name)
        self.assertEqual(second.original_filename, "My Chart.pdf")

    def test_sheet_details_for_members(self):
        self._upload()
        self.client.force_authenticate(self.leader)
        sheet = self._sheet_json()
        self.assertEqual(sheet["filename"], "My Chart.pdf")
        self.assertEqual(sheet["owner_team_name"], "Team A")
        self.assertEqual(sheet["uploaded_by_name"], "Lee Der")
        self.assertIsNotNone(sheet["uploaded_at"])

    def test_uploader_name_hidden_from_anonymous_and_pending(self):
        self._upload()
        self.assertIsNone(self._sheet_json()["uploaded_by_name"])
        self.client.force_authenticate(self.pending)
        sheet = self._sheet_json()
        self.assertIsNone(sheet["uploaded_by_name"])
        self.assertEqual(sheet["owner_team_name"], "Team A")

    def test_download_uses_original_filename(self):
        self._upload()
        second = self._upload()
        self.client.force_authenticate(self.leader)
        res = self.client.get(f"/api/sheets/{second.id}/download/")
        self.assertEqual(res.status_code, 200)
        self.assertIn('filename="My Chart.pdf"', res["Content-Disposition"])


class CustomTagApiTests(APITestCase):
    def setUp(self):
        cong = Congregation.objects.create(name="Main", primary_language="en")
        self.team = Team.objects.create(name="Team A", congregation=cong)
        self.leader = self._user("leaderA", Membership.Role.LEADER)
        self.vol = self._user("vol", Membership.Role.VOLUNTEER)
        self.advent = Tag.objects.create(category=Tag.Category.SEASON, name="Advent")

    def _user(self, username, role):
        user = User.objects.create_user(username=username, password="pw")
        Membership.objects.filter(user=user).update(
            team=self.team, role=role, is_approved=True
        )
        return User.objects.get(pk=user.pk)

    def _create(self, name, user=None):
        self.client.force_authenticate(user or self.leader)
        return self.client.post("/api/tags/", {"name": name}, format="json")

    def test_leader_creates_custom_tag(self):
        res = self._create("Communion")
        self.assertEqual(res.status_code, 201)
        tag = Tag.objects.get(pk=res.json()["id"])
        self.assertEqual(tag.category, Tag.Category.CUSTOM)
        self.assertEqual(tag.created_by_team, self.team)

    def test_whitespace_is_normalised(self):
        res = self._create("  Good   Friday ")
        self.assertEqual(res.json()["name"], "Good Friday")

    def test_existing_name_any_case_returns_existing_tag(self):
        res = self._create("advent")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["id"], self.advent.id)
        self.assertEqual(Tag.objects.count(), 1)

    def test_custom_duplicate_returns_existing_custom(self):
        first = self._create("Communion").json()["id"]
        res = self._create("COMMUNION")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["id"], first)

    def test_blank_name_rejected(self):
        self.assertEqual(self._create("   ").status_code, 400)

    def test_volunteer_and_anonymous_cannot_create(self):
        self.assertEqual(self._create("X", user=self.vol).status_code, 403)
        self.client.force_authenticate(None)
        res = self.client.post("/api/tags/", {"name": "X"}, format="json")
        self.assertIn(res.status_code, (401, 403))

    def test_tags_are_not_paginated_at_25(self):
        Tag.objects.bulk_create(
            Tag(category=Tag.Category.CUSTOM, name=f"t{i}") for i in range(40)
        )
        data = self.client.get("/api/tags/").json()
        self.assertEqual(len(data["results"]), 41)
        self.assertIsNone(data["next"])

    def test_admin_merge_keeps_curated_tag_and_moves_songs(self):
        song = Song.objects.create(title="S", copyright_holder="H")
        custom = Tag.objects.create(category=Tag.Category.CUSTOM, name="advent season")
        song.tags.add(custom)
        staff = User.objects.create_superuser("admin", "a@x.test", "pw")
        self.client.force_login(staff)
        res = self.client.post(
            "/admin/catalog/tag/",
            {"action": "merge_tags", "_selected_action": [self.advent.id, custom.id]},
        )
        self.assertEqual(res.status_code, 302)
        self.assertFalse(Tag.objects.filter(pk=custom.pk).exists())
        self.assertEqual(list(song.tags.all()), [self.advent])


@override_settings(MEDIA_ROOT=TEMP_MEDIA)
class SheetReuseApiTests(APITestCase):
    def setUp(self):
        cong = Congregation.objects.create(name="Main", primary_language="en")
        self.team_a = Team.objects.create(name="Team A", congregation=cong)
        self.team_b = Team.objects.create(name="Team B", congregation=cong)
        self.leader_a = self._user("leaderA", self.team_a, Membership.Role.LEADER)
        self.leader_b = self._user("leaderB", self.team_b, Membership.Role.LEADER)
        self.vol = self._user("vol", self.team_a, Membership.Role.VOLUNTEER)
        self.song = Song.objects.create(title="Song", copyright_holder="H", owner_team=self.team_a)
        self.other_song = Song.objects.create(title="Other", copyright_holder="H")

    def _user(self, username, team, role):
        user = User.objects.create_user(username=username, password="pw")
        Membership.objects.filter(user=user).update(team=team, role=role, is_approved=True)
        return User.objects.get(pk=user.pk)

    def _upload(self, user=None, song=None, content=b"%PDF-1.4 a", key="G", reason="", type="chord_chart"):
        self.client.force_authenticate(user or self.leader_a)
        data = {
            "song": (song or self.song).id,
            "type": type,
            "key": key,
            "source": "purchased",
            "file": SimpleUploadedFile("chart.pdf", content, "application/pdf"),
        }
        if reason:
            data["upload_reason"] = reason
        return self.client.post("/api/sheets/", data, format="multipart")

    def test_identical_file_for_same_song_rejected(self):
        self.assertEqual(self._upload().status_code, 201)
        res = self._upload(key="A", user=self.leader_b)
        self.assertEqual(res.status_code, 400)
        self.assertIn("file", res.json())

    def test_identical_file_for_another_song_allowed(self):
        self._upload()
        self.assertEqual(self._upload(song=self.other_song).status_code, 201)

    def test_same_format_and_key_needs_a_reason(self):
        self._upload()
        res = self._upload(user=self.leader_b, content=b"%PDF-1.4 b", key=" g ")
        self.assertEqual(res.status_code, 400)
        self.assertIn("already exists", res.json()["upload_reason"][0])
        res = self._upload(user=self.leader_b, content=b"%PDF-1.4 b", key="g", reason="Simplified chords")
        self.assertEqual(res.status_code, 201)
        created = SheetFile.objects.get(pk=res.json()["id"])
        self.assertEqual(created.upload_reason, "Simplified chords")
        self.assertEqual(created.key, "G")  # first letter normalised

    def test_different_key_or_format_needs_no_reason(self):
        self._upload()
        self.assertEqual(self._upload(content=b"b", key="A").status_code, 201)
        self.assertEqual(self._upload(content=b"c", type="lead_sheet").status_code, 201)

    def test_download_increments_count(self):
        sheet_id = self._upload().json()["id"]
        self.client.force_authenticate(self.vol)
        self.client.get(f"/api/sheets/{sheet_id}/download/")
        self.client.get(f"/api/sheets/{sheet_id}/download/")
        self.assertEqual(SheetFile.objects.get(pk=sheet_id).download_count, 2)

    def test_any_leader_can_prefer_and_preference_moves_within_format(self):
        first = self._upload().json()["id"]
        second = self._upload(content=b"b", key="A").json()["id"]
        self.client.force_authenticate(self.leader_b)  # doesn't own these sheets
        self.assertEqual(self.client.post(f"/api/sheets/{first}/prefer/", {"preferred": True}, format="json").status_code, 200)
        self.client.post(f"/api/sheets/{second}/prefer/", {"preferred": True}, format="json")
        self.assertEqual(list(self.team_b.preferred_sheets.values_list("id", flat=True)), [second])
        self.client.post(f"/api/sheets/{second}/prefer/", {"preferred": False}, format="json")
        self.assertFalse(self.team_b.preferred_sheets.exists())

    def test_volunteer_cannot_prefer(self):
        sheet_id = self._upload().json()["id"]
        self.client.force_authenticate(self.vol)
        res = self.client.post(f"/api/sheets/{sheet_id}/prefer/", {"preferred": True}, format="json")
        self.assertEqual(res.status_code, 403)

    def test_upload_cannot_set_other_teams_preference(self):
        self.client.force_authenticate(self.leader_a)
        res = self.client.post(
            "/api/sheets/",
            {
                "song": self.song.id,
                "type": "chord_chart",
                "source": "purchased",
                "preferred_by_teams": [self.team_b.id],
                "file": SimpleUploadedFile("x.pdf", b"x", "application/pdf"),
            },
            format="multipart",
        )
        self.assertEqual(res.status_code, 201)
        self.assertFalse(self.team_b.preferred_sheets.exists())

    def test_song_sheets_ordered_by_reuse(self):
        a = self._upload().json()["id"]
        b = self._upload(content=b"b", type="lead_sheet").json()["id"]
        SheetFile.objects.get(pk=b).preferred_by_teams.add(self.team_a, self.team_b)
        self.client.force_authenticate(None)
        ids = [s["id"] for s in self.client.get(f"/api/songs/{self.song.id}/").json()["sheets"]]
        self.assertEqual(ids, [b, a])
