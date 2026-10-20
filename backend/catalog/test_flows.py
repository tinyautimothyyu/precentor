from django.contrib.auth import get_user_model
from django.test import SimpleTestCase
from rest_framework.test import APITestCase

from accounts.models import Membership

from . import flows
from .models import Congregation, Service, ServiceSong, Song, SongFlow, SongLyrics, Team

User = get_user_model()


def sec(sid, *lines):
    return {"id": sid, "lines": list(lines)}


class FlowModuleTests(SimpleTestCase):
    def test_canonical_ids_and_labels(self):
        self.assertEqual(flows.canonical_id("v"), "V1")
        self.assertEqual(flows.canonical_id("v3"), "V3")
        self.assertEqual(flows.canonical_id("c1"), "C")
        self.assertEqual(flows.canonical_id("C2"), "C2")
        self.assertEqual(flows.canonical_id("pc"), "PC")
        self.assertIsNone(flows.canonical_id("X"))
        self.assertIsNone(flows.canonical_id("MB"))
        self.assertEqual(flows.section_label("V2"), "Verse 2")
        self.assertEqual(flows.section_label("C"), "Chorus")
        self.assertEqual(flows.section_label("ET"), "End tag")

    def test_validate_sections(self):
        out = flows.validate_sections([sec("v", "a"), sec("c", "b")])
        self.assertEqual([(s["id"], s["type"], s["label"]) for s in out],
                         [("V1", "verse", "Verse 1"), ("C", "chorus", "Chorus")])
        with self.assertRaisesRegex(ValueError, "twice"):
            flows.validate_sections([sec("V1"), sec("v")])
        with self.assertRaisesRegex(ValueError, "invalid id"):
            flows.validate_sections([sec("Q")])

    def test_validate_steps(self):
        steps = flows.validate_steps(
            [{"section": "v"}, {"marker": "mb"}, {"song": 7, "section": "c"}], lambda i: i == 7
        )
        self.assertEqual(steps, [{"section": "V1"}, {"marker": "MB", "label": "Music break"},
                                 {"song": 7, "section": "C"}])
        with self.assertRaisesRegex(ValueError, "doesn't exist"):
            flows.validate_steps([{"song": 8, "section": "C"}], lambda i: False)
        with self.assertRaisesRegex(ValueError, "unknown marker"):
            flows.validate_steps([{"marker": "XX"}], lambda i: True)

    def test_legacy_ids(self):
        self.assertEqual(flows.legacy_to_id("verse1", set()), "V1")
        self.assertEqual(flows.legacy_to_id("Chorus", set()), "C")
        self.assertEqual(flows.legacy_to_id("pre-chorus", set()), "PC")
        self.assertEqual(flows.legacy_to_id("weird", {"V1"}), "V2")


class FlowApiTests(APITestCase):
    def setUp(self):
        cong = Congregation.objects.create(name="Main", primary_language="en")
        self.team_a = Team.objects.create(name="Team A", congregation=cong)
        self.team_b = Team.objects.create(name="Team B", congregation=cong)
        self.leader_a = self._user("leaderA", self.team_a, Membership.Role.LEADER)
        self.leader_b = self._user("leaderB", self.team_b, Membership.Role.LEADER)
        self.vol = self._user("vol", self.team_a, Membership.Role.VOLUNTEER)
        self.song = Song.objects.create(title="Song", copyright_holder="H", ccli_number="111", owner_team=self.team_a)
        SongLyrics.objects.create(
            song=self.song, language="English", owner_team=self.team_a,
            segments=flows.validate_sections([sec("V1", "v1 line"), sec("V2", "v2 line"), sec("C", "chorus line")]),
        )
        SongLyrics.objects.create(
            song=self.song, language="Chinese", owner_team=self.team_a,
            segments=flows.validate_sections([sec("V1", "主歌一"), sec("C", "副歌")]),
        )
        self.other = Song.objects.create(title="Other", copyright_holder="Other Pub", ccli_number="222")
        SongLyrics.objects.create(song=self.other, language="English",
                                  segments=flows.validate_sections([sec("C", "borrowed chorus")]))

    def _user(self, username, team, role):
        user = User.objects.create_user(username=username, password="pw")
        Membership.objects.filter(user=user).update(team=team, role=role, is_approved=True)
        return User.objects.get(pk=user.pk)

    def _create_flow(self, user, steps, name="Standard", is_default=False):
        self.client.force_authenticate(user)
        return self.client.post("/api/flows/", {"song": self.song.id, "name": name, "steps": steps,
                                                "is_default": is_default}, format="json")

    def _arrange(self, **body):
        self.client.force_authenticate(None)
        return self.client.post(f"/api/songs/{self.song.id}/arrange/", body, format="json").json()

    def test_other_team_can_create_flow_on_song_it_does_not_own(self):
        res = self._create_flow(self.leader_b, [{"section": "v"}, {"section": "c"}])
        self.assertEqual(res.status_code, 201)
        flow = SongFlow.objects.get(pk=res.json()["id"])
        self.assertEqual(flow.owner_team, self.team_b)
        self.assertEqual(flow.steps, [{"section": "V1"}, {"section": "C"}])

    def test_only_owning_team_edits_flow(self):
        flow_id = self._create_flow(self.leader_b, [{"section": "C"}]).json()["id"]
        self.client.force_authenticate(self.leader_a)
        self.assertEqual(self.client.patch(f"/api/flows/{flow_id}/", {"name": "Mine"}, format="json").status_code, 403)
        self.client.force_authenticate(self.leader_b)
        self.assertEqual(self.client.patch(f"/api/flows/{flow_id}/", {"name": "Mine"}, format="json").status_code, 200)

    def test_volunteer_cannot_create_flow(self):
        self.assertEqual(self._create_flow(self.vol, []).status_code, 403)

    def test_duplicate_name_per_team_rejected_but_other_team_may_reuse(self):
        self._create_flow(self.leader_a, [])
        self.assertEqual(self._create_flow(self.leader_a, [], name="standard").status_code, 400)
        self.assertEqual(self._create_flow(self.leader_b, []).status_code, 201)

    def test_one_default_per_team(self):
        first = self._create_flow(self.leader_a, [], name="One", is_default=True).json()["id"]
        second = self._create_flow(self.leader_a, [], name="Two", is_default=True).json()["id"]
        self.assertFalse(SongFlow.objects.get(pk=first).is_default)
        self.assertTrue(SongFlow.objects.get(pk=second).is_default)

    def test_arrange_expands_flow_with_marker_missing_and_remix(self):
        steps = [{"section": "V1"}, {"section": "C"}, {"marker": "MB"}, {"section": "V2"},
                 {"song": self.other.id, "section": "C"}, {"section": "ET"}]
        flow_id = self._create_flow(self.leader_a, steps).json()["id"]
        data = self._arrange(flow=flow_id, language="English")
        kinds = [(i["kind"], i.get("id") or i.get("label")) for i in data["items"]]
        self.assertEqual(kinds, [("section", "V1"), ("section", "C"), ("marker", "Music break"),
                                 ("section", "V2"), ("section", "C"), ("missing", "ET")])
        self.assertEqual(data["items"][4]["lines"], ["borrowed chorus"])
        self.assertEqual(data["items"][4]["song"]["ccli_number"], "222")
        self.assertEqual(data["borrowed"][0]["copyright_holder"], "Other Pub")
        self.assertEqual(data["flow"]["name"], "Standard")

    def test_same_flow_drives_translation(self):
        flow_id = self._create_flow(self.leader_a, [{"section": "C"}, {"section": "V1"}]).json()["id"]
        data = self._arrange(flow=flow_id, language="chinese")
        self.assertEqual(data["language"], "Chinese")
        self.assertEqual([i["lines"] for i in data["items"]], [["副歌"], ["主歌一"]])

    def test_arrange_without_flow_lists_sections_and_falls_back_language(self):
        data = self._arrange(language="Klingon")
        self.assertEqual(data["language"], "English")
        self.assertEqual([i["id"] for i in data["items"]], ["V1", "V2", "C"])
        self.assertIsNone(data["flow"])
        self.assertEqual(sorted(data["languages"]), ["Chinese", "English"])

    def test_arrange_uses_team_default(self):
        self._create_flow(self.leader_b, [{"section": "C"}], is_default=True)
        data = self._arrange(team=self.team_b.id)
        self.assertEqual([i["id"] for i in data["items"]], ["C"])
        self.assertEqual(data["flow"]["owner_team_name"], "Team B")

    def test_arrange_preview_with_unsaved_steps(self):
        data = self._arrange(steps=[{"section": "c"}, {"marker": "INST"}])
        self.assertEqual([i["kind"] for i in data["items"]], ["section", "marker"])
        self.client.force_authenticate(None)
        res = self.client.post(f"/api/songs/{self.song.id}/arrange/", {"steps": [{"section": "Q"}]}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_lyrics_api_rejects_duplicate_sections(self):
        self.client.force_authenticate(self.leader_a)
        res = self.client.post("/api/lyrics/", {"song": self.other.id, "language": "French",
                                                "segments": [sec("C", "a"), sec("c1", "b")]}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_service_item_flow_must_match_song(self):
        flow_id = self._create_flow(self.leader_a, []).json()["id"]
        service = Service.objects.create(team=self.team_a, date="2026-10-25")
        item = ServiceSong.objects.create(service=service, song=self.other)
        self.client.force_authenticate(self.leader_a)
        res = self.client.patch(f"/api/service-songs/{item.id}/", {"flow": flow_id}, format="json")
        self.assertEqual(res.status_code, 400)
        ok = ServiceSong.objects.create(service=service, song=self.song)
        res = self.client.patch(f"/api/service-songs/{ok.id}/", {"flow": flow_id}, format="json")
        self.assertEqual(res.status_code, 200)

    def test_song_detail_lists_flows(self):
        self._create_flow(self.leader_b, [{"section": "C"}])
        data = self.client.get(f"/api/songs/{self.song.id}/").json()
        self.assertEqual([(f["owner_team_name"], f["name"]) for f in data["flows"]], [("Team B", "Standard")])
