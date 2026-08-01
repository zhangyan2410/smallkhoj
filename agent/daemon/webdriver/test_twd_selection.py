import unittest
import argparse
import contextlib
import io
import json
import os
import socket
import subprocess
import threading
import time
from pathlib import Path
import sys
from unittest.mock import patch

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


class PortResolutionTests(unittest.TestCase):
    def args(self, port=None, *, tab=None, url_match=None):
        return argparse.Namespace(
            host="127.0.0.1",
            port=port,
            token=None,
            tab=tab,
            url_match=url_match,
        )

    def test_explicit_cli_port_wins_over_discovery(self):
        with patch.dict(os.environ, {}, clear=True):
            selected = twd.resolve_twd_port(
                self.args(port=18765),
                session_probe=lambda host, port, token: [{"id": "connected"}],
            )

        self.assertEqual(selected, 18765)

    def test_env_port_wins_over_discovery(self):
        with patch.dict(os.environ, {"TWD_PORT": "18765"}, clear=True):
            selected = twd.resolve_twd_port(
                self.args(),
                session_probe=lambda host, port, token: [{"id": "connected"}],
            )

        self.assertEqual(selected, 18765)

    def test_auto_discovery_prefers_candidate_with_connected_tabs(self):
        sessions_by_port = {
            28765: [],
            18765: [{"id": "1", "url": "http://127.0.0.1:3000/tasks"}],
        }
        with patch.dict(os.environ, {}, clear=True):
            selected = twd.resolve_twd_port(
                self.args(),
                session_probe=lambda host, port, token: sessions_by_port.get(port),
            )

        self.assertEqual(selected, 18765)

    def test_auto_discovery_falls_back_to_preferred_candidate_when_no_tabs_are_connected(self):
        with patch.dict(os.environ, {}, clear=True):
            selected = twd.resolve_twd_port(
                self.args(),
                session_probe=lambda host, port, token: [],
            )

        self.assertEqual(selected, 28765)

    def test_port_candidates_can_be_overridden_for_local_experiments(self):
        with patch.dict(os.environ, {"TWD_PORT_CANDIDATES": "39000, 39010"}, clear=True):
            selected = twd.resolve_twd_port(
                self.args(),
                session_probe=lambda host, port, token: None,
            )

        self.assertEqual(selected, 39000)

    def test_auto_discovery_finds_exact_tab_owner_across_all_bridges(self):
        sessions_by_port = {
            28765: [{"id": "111", "url": "http://example.test/"}],
            18765: [{"id": "909091", "url": "http://127.0.0.1:3000/tasks"}],
        }
        with patch.dict(os.environ, {}, clear=True):
            selected = twd.resolve_twd_port(
                self.args(tab=909091),
                session_probe=lambda host, port, token: sessions_by_port.get(port),
            )

        self.assertEqual(selected, 18765)

    def test_auto_discovery_finds_url_match_owner_across_all_bridges(self):
        sessions_by_port = {
            28765: [{"id": "111", "url": "http://example.test/"}],
            18765: [{"id": "222", "url": "http://127.0.0.1:3000/tasks"}],
        }
        with patch.dict(os.environ, {}, clear=True):
            selected = twd.resolve_twd_port(
                self.args(url_match="127.0.0.1:3000/tasks"),
                session_probe=lambda host, port, token: sessions_by_port.get(port),
            )

        self.assertEqual(selected, 18765)

    def test_auto_discovery_rejects_same_exact_tab_on_multiple_bridges(self):
        sessions_by_port = {
            28765: [{"id": "909091", "url": "http://127.0.0.1:3000/tasks"}],
            18765: [{"id": "909091", "url": "http://127.0.0.1:3001/tasks"}],
        }
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(twd.TabSelectionError) as caught:
                twd.resolve_twd_port(
                    self.args(tab=909091),
                    session_probe=lambda host, port, token: sessions_by_port.get(port),
                )

        self.assertEqual(caught.exception.code, "AMBIGUOUS_BRIDGE")
        self.assertEqual({item["port"] for item in caught.exception.candidates}, {28765, 18765})

    def test_auto_discovery_rejects_same_url_match_on_multiple_bridges(self):
        sessions_by_port = {
            28765: [{"id": "111", "url": "http://127.0.0.1:3000/tasks"}],
            18765: [{"id": "222", "url": "http://127.0.0.1:3000/tasks?view=board"}],
        }
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(twd.TabSelectionError) as caught:
                twd.resolve_twd_port(
                    self.args(url_match="127.0.0.1:3000/tasks"),
                    session_probe=lambda host, port, token: sessions_by_port.get(port),
                )

        self.assertEqual(caught.exception.code, "AMBIGUOUS_BRIDGE")
        self.assertEqual({item["port"] for item in caught.exception.candidates}, {28765, 18765})

    def test_auto_discovery_rejects_selector_not_owned_by_any_bridge(self):
        sessions_by_port = {
            28765: [{"id": "111", "url": "http://example.test/"}],
            18765: [{"id": "222", "url": "http://127.0.0.1:3000/tasks"}],
        }
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(twd.TabSelectionError) as caught:
                twd.resolve_twd_port(
                    self.args(tab=909091),
                    session_probe=lambda host, port, token: sessions_by_port.get(port),
                )

        self.assertEqual(caught.exception.code, "NO_MATCHING_BRIDGE")
        self.assertEqual({item["port"] for item in caught.exception.candidates}, {28765, 18765})

    def test_collect_candidate_sessions_aggregates_source_ports(self):
        sessions_by_port = {
            28765: [{"id": "111", "url": "http://example.test/"}],
            18765: [{"id": "222", "url": "http://127.0.0.1:3000/tasks"}],
        }
        with patch.dict(os.environ, {}, clear=True):
            sessions = twd.collect_candidate_sessions(
                self.args(),
                session_probe=lambda host, port, token: sessions_by_port.get(port),
            )

        self.assertEqual(
            [(item["id"], item["port"]) for item in sessions],
            [("111", 28765), ("222", 18765)],
        )


class ExecutionContractTests(unittest.TestCase):
    class FakeClient:
        def __init__(self, driver, ack=False):
            self.driver = driver
            self.ack = ack

        def send_message(self, payload):
            exec_id = json.loads(payload)["id"]
            if self.ack:
                self.driver.acks[exec_id] = True

    def driver(self, *, ack=False):
        driver = tmwebdriver_core.TMWebDriver.__new__(tmwebdriver_core.TMWebDriver)
        driver.is_remote = False
        driver.results = {}
        driver.acks = {}
        driver.pending = set()
        client = self.FakeClient(driver, ack=ack)
        driver.sessions = {
            "1": tmwebdriver_core.Session(
                "1",
                {"type": "ext_ws", "url": "http://127.0.0.1:3000/tasks"},
                client,
            )
        }
        driver.default_session_id = "1"
        driver.latest_session_id = "1"
        return driver

    def test_no_ack_timeout_raises_coded_error_and_cleans_pending_state(self):
        driver = self.driver(ack=False)

        with self.assertRaises(Exception) as caught:
            driver.execute_js("return true", timeout=0.01, session_id="1")

        self.assertEqual(getattr(caught.exception, "code", None), "EXECUTION_TIMEOUT")
        self.assertIn("not delivered", str(caught.exception))
        self.assertEqual(driver.pending, set())
        self.assertEqual(driver.acks, {})
        self.assertEqual(driver.results, {})

    def test_ack_without_result_raises_coded_error(self):
        driver = self.driver(ack=True)

        with self.assertRaises(Exception) as caught:
            driver.execute_js("return true", timeout=0.01, session_id="1")

        self.assertEqual(getattr(caught.exception, "code", None), "EXECUTION_TIMEOUT")
        self.assertIn("delivered", str(caught.exception))

    def test_late_results_are_discarded_after_pending_execution_is_removed(self):
        driver = self.driver()

        accepted = driver._record_result("late-id", success=True, data={"late": True})

        self.assertFalse(accepted)
        self.assertNotIn("late-id", driver.results)

    def test_delayed_result_after_real_timeout_is_discarded(self):
        driver = self.driver()
        completed = threading.Event()
        accepted = []

        class DelayedClient:
            def send_message(self, payload):
                exec_id = json.loads(payload)["id"]
                driver._record_ack(exec_id)

                def finish_late():
                    time.sleep(0.5)
                    accepted.append(driver._record_result(exec_id, success=True, data={"late": True}))
                    completed.set()

                threading.Thread(target=finish_late, daemon=True).start()

        driver.sessions["1"].ws_client = DelayedClient()

        with self.assertRaises(Exception) as caught:
            driver.execute_js("return true", timeout=0.005, session_id="1")

        self.assertEqual(getattr(caught.exception, "code", None), "EXECUTION_TIMEOUT")
        self.assertTrue(completed.wait(1.0))
        self.assertEqual(accepted, [False])
        self.assertEqual(driver.pending, set())
        self.assertEqual(driver.acks, {})
        self.assertEqual(driver.results, {})


class CliContractTests(unittest.TestCase):
    class FakeDriver:
        def __init__(self, result=None, error=None):
            self.result = result
            self.error = error

        def execute_js(self, *args, **kwargs):
            if self.error:
                raise self.error
            return self.result

    class CodedError(RuntimeError):
        code = "EXECUTION_TIMEOUT"

    def run_main(self, argv, driver):
        stdout = io.StringIO()
        with patch.object(twd, "make_driver", return_value=driver), contextlib.redirect_stdout(stdout):
            status = twd.main(argv)
        return status, stdout.getvalue()

    def test_compact_is_accepted_after_subcommand_and_errors_stay_single_line(self):
        status, output = self.run_main(
            ["eval", "--tab", "1", "return true", "--compact"],
            self.FakeDriver(error=self.CodedError("delivered but no result")),
        )

        self.assertNotEqual(status, 0)
        self.assertEqual(output.count("\n"), 1)
        self.assertEqual(json.loads(output)["code"], "EXECUTION_TIMEOUT")

    def test_compact_screenshot_success_stays_single_line(self):
        output_path = Path(self.id().replace(".", "-") + ".png")
        self.addCleanup(output_path.unlink, missing_ok=True)

        status, output = self.run_main(
            ["screenshot", "--tab", "1", str(output_path), "--compact"],
            self.FakeDriver(result={"data": {"data": "cG5n"}}),
        )

        self.assertEqual(status, 0)
        self.assertEqual(output.count("\n"), 1)
        self.assertTrue(json.loads(output)["ok"])

    def test_goto_does_not_convert_uncertain_mapping_to_navigated_true(self):
        status, output = self.run_main(
            ["--compact", "goto", "--tab", "1", "http://127.0.0.1:3000/tasks"],
            self.FakeDriver(result={"result": "uncertain"}),
        )

        self.assertNotEqual(status, 0)
        self.assertEqual(json.loads(output)["code"], "NAVIGATION_UNCONFIRMED")

    def test_goto_accepts_browser_assignment_result_only_when_it_matches_target(self):
        target = "http://127.0.0.1:3000/tasks"
        status, output = self.run_main(
            ["--compact", "goto", "--tab", "1", target],
            self.FakeDriver(result={"data": target}),
        )

        self.assertEqual(status, 0)
        self.assertTrue(json.loads(output)["navigated"])

    def test_legacy_master_timeout_mapping_is_rejected_by_new_cli(self):
        status, output = self.run_main(
            ["--compact", "eval", "--tab", "1", "return true"],
            self.FakeDriver(
                result={"result": "No response data in 0.5s (ACK received, script may still be running)"}
            ),
        )

        self.assertNotEqual(status, 0)
        self.assertEqual(json.loads(output)["code"], "EXECUTION_TIMEOUT")

    def test_groups_collapsed_false_uses_strict_text_boolean(self):
        args = twd.build_parser().parse_args(["groups", "update", "--collapsed", "false"])

        self.assertIs(args.collapsed, False)

    def test_groups_collapsed_rejects_invalid_text_boolean(self):
        with self.assertRaises(SystemExit):
            twd.build_parser().parse_args(["groups", "update", "--collapsed", "not-a-bool"])

    def test_cleanup_selector_is_serialized_into_javascript_without_driver_args(self):
        calls = []

        class Driver:
            def execute_js(self, script, **kwargs):
                calls.append((script, kwargs))
                return {"data": 2}

        result = twd.cleanup_selector(Driver(), "[data-test=\"quoted\"]", "1", 2.0)

        self.assertEqual(result, 2)
        self.assertIn('"[data-test=\\\"quoted\\\"]"', calls[0][0])
        self.assertNotIn("args", calls[0][1])


    def test_act_preserves_coded_action_failure_in_json(self):
        with patch.object(twd, "_take_snapshot", return_value="<main>same</main>"):
            status, output = self.run_main(
                ["--compact", "act", "--tab", "1", "return true", "--monitor", "0", "--settle", "0"],
                self.FakeDriver(error=self.CodedError("delivered but no result")),
            )

        payload = json.loads(output)
        self.assertNotEqual(status, 0)
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["code"], "EXECUTION_TIMEOUT")
        self.assertEqual(output.count("\n"), 1)

    def test_act_cleanup_failure_has_stable_code(self):
        with (
            patch.object(twd, "_take_snapshot", return_value="<main>same</main>"),
            patch.object(twd, "cleanup_selector", side_effect=RuntimeError("cleanup broke")),
        ):
            status, output = self.run_main(
                [
                    "--compact",
                    "act",
                    "--tab",
                    "1",
                    "return true",
                    "--monitor",
                    "0",
                    "--settle",
                    "0",
                    "--cleanup-after",
                    "[data-test=cleanup]",
                ],
                self.FakeDriver(result={"data": True}),
            )

        payload = json.loads(output)
        self.assertNotEqual(status, 0)
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["code"], "CLEANUP_FAILED")
        self.assertEqual(output.count("\n"), 1)


class TwdCliBridgeIntegrationTests(unittest.TestCase):
    class ReplyClient:
        def __init__(self, driver, result):
            self.driver = driver
            self.result = result

        def send_message(self, payload):
            exec_id = json.loads(payload)["id"]
            self.driver._record_ack(exec_id)
            self.driver._record_result(exec_id, success=True, data=self.result)

    @staticmethod
    def free_port_pair():
        for _ in range(50):
            with socket.socket() as probe:
                probe.bind(("127.0.0.1", 0))
                port = probe.getsockname()[1]
            if port >= 65534:
                continue
            first = socket.socket()
            second = socket.socket()
            try:
                first.bind(("127.0.0.1", port))
                second.bind(("127.0.0.1", port + 1))
                return port
            except OSError:
                continue
            finally:
                first.close()
                second.close()
        raise RuntimeError("Unable to reserve a TWD port pair")

    def test_real_cli_selects_exact_tab_owner_and_aggregates_bridge_tabs(self):
        first_port = self.free_port_pair()
        second_port = self.free_port_pair()
        while second_port in {first_port - 1, first_port, first_port + 1}:
            second_port = self.free_port_pair()

        first = tmwebdriver_core.TMWebDriver(host="127.0.0.1", port=first_port)
        second = tmwebdriver_core.TMWebDriver(host="127.0.0.1", port=second_port)
        first_client = self.ReplyClient(first, {"bridge": first_port})
        second_client = self.ReplyClient(second, {"bridge": second_port})
        first._register_client(
            "111",
            first_client,
            {"type": "ext_ws", "url": "http://example.test/"},
        )
        second._register_client(
            "909091",
            second_client,
            {"type": "ext_ws", "url": "http://127.0.0.1:3000/tasks"},
        )
        time.sleep(0.1)

        root = Path(__file__).resolve().parents[3]
        env = {
            **os.environ,
            "TWD_PORT_CANDIDATES": f"{first_port},{second_port}",
        }
        evaluated = subprocess.run(
            [str(root / "twd"), "eval", "--tab", "909091", "return true", "--compact"],
            cwd=root,
            env=env,
            text=True,
            capture_output=True,
            timeout=5,
            check=False,
        )
        self.assertEqual(evaluated.returncode, 0, evaluated.stderr)
        eval_payload = json.loads(evaluated.stdout)
        self.assertEqual(eval_payload["tabId"], "909091")
        self.assertEqual(eval_payload["result"]["bridge"], second_port)

        listed = subprocess.run(
            [str(root / "twd"), "tabs", "--wait", "0.1", "--compact"],
            cwd=root,
            env=env,
            text=True,
            capture_output=True,
            timeout=5,
            check=False,
        )
        self.assertEqual(listed.returncode, 0, listed.stderr)
        tabs_payload = json.loads(listed.stdout)
        self.assertEqual(tabs_payload["count"], 2)
        self.assertEqual(
            {(tab["id"], tab["port"]) for tab in tabs_payload["tabs"]},
            {("111", first_port), ("909091", second_port)},
        )


if __name__ == "__main__":
    unittest.main()
