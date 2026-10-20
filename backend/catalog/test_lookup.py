from unittest import mock

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, override_settings
from rest_framework.test import APITestCase

from accounts.models import Membership

from . import lookup
from .models import Congregation, Song, Team

User = get_user_model()

DESCRIPTION = """Official lyric video for "What A Beautiful Name".

Written by Ben Fielding & Brooke Ligertwood
CCLI Song # 7068424
© 2016 Hillsong Music Publishing Australia
All rights reserved.
"""


class TitleCleaningTests(SimpleTestCase):
    def test_cases(self):
        cases = [
            ("Hillsong Worship - What A Beautiful Name (Official Lyric Video)", "Hillsong Worship", "What A Beautiful Name"),
            ("What A Beautiful Name - Hillsong Worship", "Hillsong Worship", "What A Beautiful Name"),
            ("Never Gonna Give You Up (4K Remaster)", "Rick Astley", "Never Gonna Give You Up"),
            ("Goodness of God | Live | Bethel Music", "Bethel Music", "Goodness of God"),
            ("Way Maker [Official Lyric Video]", "", "Way Maker"),
            ("Graves Into Gardens (Live) - Elevation Worship", "Elevation Worship", "Graves Into Gardens"),
            ("10,000 Reasons (Bless the Lord)", "MattRedman", "10,000 Reasons (Bless the Lord)"),
            ("Another In The Fire (Acoustic)", "Hillsong UNITED", "Another In The Fire"),
        ]
        for raw, artist, want in cases:
            with self.subTest(raw=raw):
                self.assertEqual(lookup.clean_title(raw, artist), want)

    def test_channel_cleaning(self):
        self.assertEqual(lookup.clean_channel("Elevation Worship - Topic"), "Elevation Worship")
        self.assertEqual(lookup.clean_channel("HillsongWorshipVEVO"), "HillsongWorship")


class BilingualTitleTests(SimpleTestCase):
    def test_splits_chinese_and_english_titles(self):
        cases = [
            ("能不能 Can I", "", ("能不能", "Can I")),
            ("【能不能 Can I】讚美之泉 官方MV", "讚美之泉 Stream of Praise", ("能不能", "Can I")),
            ("讚美之泉 - 能不能 | Can I (Official Lyric Video)", "讚美之泉", ("能不能", "Can I")),
            ("約書亞樂團 - 祢是王 You Are King (Official Music Video)", "約書亞樂團 Joshua Band", ("祢是王", "You Are King")),
            ("《我要看見》Shout to the Lord - 讚美之泉", "讚美之泉", ("我要看見", "Shout to the Lord")),
            ("【能不能】讚美之泉 Stream of Praise 官方MV", "讚美之泉 Stream of Praise", ("能不能", "")),
            ("奇異恩典 動態歌詞", "", ("奇異恩典", "")),
        ]
        for raw, artist, expected in cases:
            with self.subTest(raw=raw):
                self.assertEqual(lookup.split_bilingual(raw, artist), expected)

    def test_english_only_titles_are_left_alone(self):
        self.assertEqual(lookup.split_bilingual("What A Beautiful Name (Live)"), ("", ""))


class ExtractionTests(SimpleTestCase):
    def test_description_fields(self):
        self.assertEqual(lookup.extract_ccli(DESCRIPTION), "7068424")
        self.assertEqual(
            lookup.extract_copyright(DESCRIPTION), "© 2016 Hillsong Music Publishing Australia"
        )
        self.assertEqual(
            lookup.extract_songwriters(DESCRIPTION), ["Ben Fielding", "Brooke Ligertwood"]
        )

    def test_ccli_variants(self):
        for text in ("CCLI #1234567", "CCLI: 1234567", "CCLI Song No. 1234567", "ccli number 1234567"):
            with self.subTest(text=text):
                self.assertEqual(lookup.extract_ccli(text), "1234567")
        self.assertEqual(lookup.extract_ccli("CCLI license required"), "")

    def test_copyright_skips_all_rights_reserved(self):
        self.assertEqual(lookup.extract_copyright("© All rights reserved"), "")
        self.assertEqual(lookup.extract_copyright("Copyright 2020 Bethel Music"), "© 2020 Bethel Music")

    def test_link_parsing(self):
        self.assertEqual(lookup.youtube_video_id("https://youtu.be/nQWFzMvCfLE?si=x"), "nQWFzMvCfLE")
        self.assertEqual(lookup.youtube_video_id("https://www.youtube.com/shorts/nQWFzMvCfLE"), "nQWFzMvCfLE")
        self.assertIsNone(lookup.youtube_video_id("https://youtube.com.evil.com/watch?v=nQWFzMvCfLE"))
        self.assertEqual(
            lookup.spotify_track_id("https://open.spotify.com/intl-de/track/4uLU6hMCjMI75M1A2tKUQC?si=1"),
            "4uLU6hMCjMI75M1A2tKUQC",
        )
        self.assertIsNone(lookup.spotify_track_id("https://open.spotify.com/album/1ATL5GLyefJaxhQzSPVrLX"))


def fake_get_json(responses):
    def _get(url):
        for prefix, payload in responses.items():
            if url.startswith(prefix):
                if isinstance(payload, Exception):
                    raise payload
                return payload
        raise AssertionError(f"unexpected upstream call: {url}")

    return _get


class LookupEndpointTests(APITestCase):
    def setUp(self):
        cong = Congregation.objects.create(name="Main", primary_language="en")
        self.team = Team.objects.create(name="Team A", congregation=cong)
        self.leader = self._user("leaderA", Membership.Role.LEADER)
        self.vol = self._user("vol", Membership.Role.VOLUNTEER)

    def _user(self, username, role):
        user = User.objects.create_user(username=username, password="pw")
        Membership.objects.filter(user=user).update(team=self.team, role=role, is_approved=True)
        return User.objects.get(pk=user.pk)

    def _post(self, url, user=None):
        self.client.force_authenticate(user or self.leader)
        return self.client.post("/api/songs/lookup/", {"url": url}, format="json")

    @override_settings(YOUTUBE_API_KEY="k")
    def test_youtube_with_api_key_fills_licensing_fields(self):
        api = {
            "items": [
                {
                    "snippet": {
                        "title": "Hillsong Worship - What A Beautiful Name (Official Lyric Video)",
                        "channelTitle": "Hillsong Worship",
                        "description": DESCRIPTION,
                    }
                }
            ]
        }
        with mock.patch.object(lookup, "_get_json", fake_get_json({"https://www.googleapis.com/": api})):
            data = self._post("https://youtu.be/nQWFzMvCfLE").json()
        self.assertEqual(data["fields"]["title"], {"value": "What A Beautiful Name", "source": "youtube"})
        self.assertEqual(data["fields"]["ccli_number"]["value"], "7068424")
        self.assertEqual(
            data["fields"]["copyright_holder"]["value"], "© 2016 Hillsong Music Publishing Australia"
        )
        self.assertEqual(
            data["fields"]["reference_url"]["value"], "https://www.youtube.com/watch?v=nQWFzMvCfLE"
        )
        self.assertEqual(data["artist"], "Hillsong Worship")
        self.assertEqual(data["songwriters"], ["Ben Fielding", "Brooke Ligertwood"])
        self.assertEqual(data["warnings"], [])

    @override_settings(YOUTUBE_API_KEY="")
    def test_youtube_without_key_uses_oembed_title_only(self):
        oembed = {"title": "Way Maker (Live)", "author_name": "Leeland"}
        with mock.patch.object(lookup, "_get_json", fake_get_json({"https://www.youtube.com/oembed": oembed})):
            data = self._post("https://www.youtube.com/watch?v=nQWFzMvCfLE").json()
        self.assertEqual(data["fields"]["title"]["value"], "Way Maker")
        self.assertNotIn("ccli_number", data["fields"])
        self.assertTrue(data["warnings"])

    @override_settings(YOUTUBE_API_KEY="k")
    def test_api_failure_falls_back_to_oembed(self):
        responses = {
            "https://www.googleapis.com/": OSError("down"),
            "https://www.youtube.com/oembed": {"title": "Way Maker", "author_name": "Leeland"},
        }
        with mock.patch.object(lookup, "_get_json", fake_get_json(responses)):
            data = self._post("https://youtu.be/nQWFzMvCfLE").json()
        self.assertEqual(data["fields"]["title"]["value"], "Way Maker")
        self.assertTrue(any("couldn't be fetched" in w for w in data["warnings"]))

    @override_settings(YOUTUBE_API_KEY="")
    def test_unreachable_video_is_400(self):
        with mock.patch.object(lookup, "_get_json", fake_get_json({"https://www.youtube.com/oembed": OSError()})):
            res = self._post("https://youtu.be/nQWFzMvCfLE")
        self.assertEqual(res.status_code, 400)

    def test_spotify_track_title(self):
        oembed = {"title": "Goodness of God"}
        with mock.patch.object(lookup, "_get_json", fake_get_json({"https://open.spotify.com/oembed": oembed})):
            data = self._post("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC").json()
        self.assertEqual(data["provider"], "spotify")
        self.assertEqual(data["fields"]["title"]["value"], "Goodness of God")
        self.assertEqual(
            data["fields"]["reference_url"]["value"],
            "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
        )

    def test_unsupported_links_are_400_with_message(self):
        for url in ("", "https://example.com/song", "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M"):
            with self.subTest(url=url):
                res = self._post(url)
                self.assertEqual(res.status_code, 400)
                self.assertTrue(res.json()["detail"])

    @override_settings(YOUTUBE_API_KEY="")
    def test_duplicates_by_video_and_title(self):
        same_video = Song.objects.create(
            title="Other", copyright_holder="H", reference_url="https://youtu.be/nQWFzMvCfLE"
        )
        same_title = Song.objects.create(title="What a Beautiful Name", copyright_holder="H")
        oembed = {"title": "What A Beautiful Name", "author_name": "Hillsong Worship"}
        with mock.patch.object(lookup, "_get_json", fake_get_json({"https://www.youtube.com/oembed": oembed})):
            dups = self._post("https://www.youtube.com/watch?v=nQWFzMvCfLE").json()["duplicates"]
        self.assertEqual(
            {(d["id"], d["reason"]) for d in dups},
            {(same_video.id, "same video"), (same_title.id, "similar title")},
        )

    @override_settings(YOUTUBE_API_KEY="")
    def test_bilingual_title_suggests_english_title_and_matches_it(self):
        existing = Song.objects.create(title="Neng Bu Neng", english_title="Can I", copyright_holder="H")
        oembed = {"title": "能不能 Can I | 讚美之泉", "author_name": "讚美之泉 Stream of Praise"}
        with mock.patch.object(lookup, "_get_json", fake_get_json({"https://www.youtube.com/oembed": oembed})):
            data = self._post("https://youtu.be/nQWFzMvCfLE").json()
        self.assertEqual(data["fields"]["title"]["value"], "能不能")
        self.assertEqual(data["fields"]["english_title"], {"value": "Can I", "source": "youtube"})
        self.assertEqual([d["id"] for d in data["duplicates"]], [existing.id])

    def test_search_matches_english_title(self):
        song = Song.objects.create(title="能不能", english_title="Can I", copyright_holder="H")
        Song.objects.create(title="Other", copyright_holder="H")
        res = self.client.get("/api/songs/", {"search": "can i"}).json()
        self.assertEqual([s["id"] for s in res["results"]], [song.id])
        self.assertEqual(res["results"][0]["english_title"], "Can I")

    def test_only_leaders_can_look_up(self):
        self.assertEqual(self._post("https://youtu.be/nQWFzMvCfLE", user=self.vol).status_code, 403)
