import unittest
import argparse
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
import twd
import tmwebdriver_core


class TabSelectionTests(unittest.TestCase):
    def test_selects_single_url_match(self):
        selected = twd.select_matching_session(
            [
                {"id": "1", "url": "http://127.0.0.1:3000/chat/all"},
                {"id": "2", "url": "http://example.test/"},
            ],
            url_match="127.0.0.1:3000",
        )

        self.assertEqual(selected["id"], "1")

    def test_prefers_unique_active_matching_tab(self):
        selected = twd.select_matching_session(
            [
                {"id": "1", "url": "http://127.0.0.1:3000/chat/old", "active": False},
                {"id": "2", "url": "http://127.0.0.1:3000/chat/all", "active": True},
            ],
            url_match="127.0.0.1:3000",
        )

        self.assertEqual(selected["id"], "2")

    def test_rejects_multiple_url_matches_without_active_signal(self):
        with self.assertRaises(twd.TabSelectionError) as caught:
            twd.select_matching_session(
                [
                    {"id": "1", "url": "http://127.0.0.1:3000/chat/old"},
                    {"id": "2", "url": "http://127.0.0.1:3000/chat/all"},
                ],
                url_match="127.0.0.1:3000",
            )

        self.assertEqual(caught.exception.code, "AMBIGUOUS_TAB")
        self.assertIn("http://127.0.0.1:3000/chat/old", caught.exception.candidates[0]["url"])
        self.assertIn("http://127.0.0.1:3000/chat/all", caught.exception.candidates[1]["url"])

    def test_rejects_multiple_active_matching_tabs(self):
        with self.assertRaises(twd.TabSelectionError) as caught:
            twd.select_matching_session(
                [
                    {"id": "1", "url": "http://127.0.0.1:3000/chat/old", "active": True, "windowId": 10},
                    {"id": "2", "url": "http://127.0.0.1:3000/chat/all", "active": True, "windowId": 20},
                ],
                url_match="127.0.0.1:3000",
            )

        self.assertEqual(caught.exception.code, "AMBIGUOUS_TAB")

    def test_choose_session_refreshes_live_active_tab_metadata(self):
        class FakeDriver:
            def __init__(self):
                self.called = False

            def get_all_sessions(self):
                return [
                    {"id": "1", "type": "ext_ws", "url": "http://127.0.0.1:3000/chat/old"},
                    {"id": "2", "type": "ext_ws", "url": "http://127.0.0.1:3000/chat/all"},
                ]

            def execute_js(self, code, timeout=15, session_id=None):
                self.called = True
                return {
                    "data": [
                        {"id": 1, "url": "http://127.0.0.1:3000/chat/old", "active": False, "windowId": 10},
                        {"id": 2, "url": "http://127.0.0.1:3000/chat/all", "active": True, "windowId": 10},
                    ]
                }

        args = argparse.Namespace(tab=None, url_match="127.0.0.1:3000", wait=0.01, timeout=1)
        driver = FakeDriver()

        selected = twd.choose_session_info(driver, args)

        self.assertTrue(driver.called)
        self.assertEqual(selected["id"], "2")
        self.assertEqual(args._twd_selected_session["url"], "http://127.0.0.1:3000/chat/all")

    def test_choose_session_merges_live_tabs_from_multiple_bridge_sessions(self):
        class FakeDriver:
            def __init__(self):
                self.session_ids = []

            def get_all_sessions(self):
                return [
                    {"id": "1", "type": "ext_ws", "url": "http://127.0.0.1:3000/chat/all"},
                    {"id": "2", "type": "ext_ws", "url": "http://127.0.0.1:3000/login"},
                ]

            def execute_js(self, code, timeout=15, session_id=None):
                self.session_ids.append(session_id)
                if session_id == "1":
                    return {"data": [{"id": 1, "url": "http://127.0.0.1:3000/chat/all", "active": False}]}
                return {"data": [{"id": 2, "url": "http://127.0.0.1:3000/login", "active": True}]}

        args = argparse.Namespace(tab=None, url_match="127.0.0.1:3000", wait=0.01, timeout=1)
        driver = FakeDriver()

        selected = twd.choose_session_info(driver, args)

        self.assertEqual(driver.session_ids, ["1", "2"])
        self.assertEqual(selected["id"], "2")

    def test_ext_tabs_update_only_disconnects_sessions_for_same_client(self):
        client_a = object()
        client_b = object()
        session = tmwebdriver_core.Session("1", {"type": "ext_ws", "url": "http://127.0.0.1:3000/chat/all"}, client_a)

        self.assertFalse(tmwebdriver_core.should_disconnect_ext_session(session, {"2"}, client_b))
        self.assertTrue(tmwebdriver_core.should_disconnect_ext_session(session, {"2"}, client_a))

    def test_ext_tabs_update_reassigns_existing_tab_to_latest_client(self):
        driver = tmwebdriver_core.TMWebDriver.__new__(tmwebdriver_core.TMWebDriver)
        driver.sessions = {}
        driver.latest_session_id = None
        driver.default_session_id = None
        client_a = object()
        client_b = object()

        driver._register_client(
            "1",
            client_a,
            {"type": "ext_ws", "url": "http://127.0.0.1:3000/chat/all", "title": "old"},
        )

        tmwebdriver_core.upsert_ext_tab_session(
            driver,
            {"id": 1, "url": "http://127.0.0.1:3000/chat/all", "title": "new", "active": True, "windowId": 10},
            client_b,
        )

        session = driver.sessions["1"]
        self.assertIs(session.ws_client, client_b)
        self.assertTrue(session.is_active())
        self.assertEqual(session.info["title"], "new")
        self.assertTrue(session.info["active"])

        driver._unregister_client(client_a)
        self.assertTrue(session.is_active())

        driver._unregister_client(client_b)
        self.assertFalse(session.is_active())


if __name__ == "__main__":
    unittest.main()
