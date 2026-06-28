import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from scripts import validate_release_worker_env as validator


COMPLETE_ENV = "\n".join([
    "FEISHU_WORKER_ENABLED=true",
    "FEISHU_WORKER_CONNECTOR_ID=11111111-1111-1111-1111-111111111111",
    "FEISHU_WORKER_JIRA_CONNECTOR_ID=22222222-2222-2222-2222-222222222222",
    "FEISHU_WORKER_CREATOR_ID=33333333-3333-3333-3333-333333333333",
    "FEISHU_WORKER_APP_ID=cli_a_real_app",
    "FEISHU_WORKER_APP_SECRET=super-secret",
    "FEISHU_REPLY_ACCESS_TOKEN=reply-token",
    "JIRA_EMAIL=ops@example.com",
    "JIRA_API_TOKEN=jira-token",
])


class ValidateReleaseWorkerEnvTests(unittest.TestCase):
    def test_complete_env_is_ready_without_exposing_values(self) -> None:
        result = validator.validate_release_worker_env(COMPLETE_ENV)

        self.assertTrue(result.ready)
        self.assertEqual(result.missing_keys, [])
        payload = validator.result_payload(result)
        payload_text = json.dumps(payload, sort_keys=True)
        self.assertIn("FEISHU_WORKER_APP_SECRET", payload_text)
        self.assertIn("JIRA_API_TOKEN", payload_text)
        self.assertNotIn("super-secret", payload_text)
        self.assertNotIn("jira-token", payload_text)

    def test_missing_required_keys_are_reported_by_name_only(self) -> None:
        result = validator.validate_release_worker_env(
            "FEISHU_WORKER_CONNECTOR_ID=11111111-1111-1111-1111-111111111111\n"
            "FEISHU_WORKER_APP_SECRET=super-secret\n"
        )

        self.assertFalse(result.ready)
        self.assertEqual(result.reason_code, "RELEASE_WORKER_ENV_MISSING_REQUIRED_KEYS")
        self.assertIn("JIRA_API_TOKEN", result.missing_keys)
        payload_text = json.dumps(validator.result_payload(result), sort_keys=True)
        self.assertNotIn("super-secret", payload_text)

    def test_placeholder_values_count_as_missing(self) -> None:
        result = validator.validate_release_worker_env(COMPLETE_ENV.replace("jira-token", "<set-outside-repo>"))

        self.assertFalse(result.ready)
        self.assertIn("JIRA_API_TOKEN", result.missing_keys)

    def test_unknown_or_malformed_keys_fail_without_exposing_values(self) -> None:
        with self.assertRaises(ValueError) as exc:
            validator.validate_release_worker_env("UNRELATED_SECRET=do-not-print\n")

        self.assertIn("UNRELATED_SECRET", str(exc.exception))
        self.assertNotIn("do-not-print", str(exc.exception))

        with self.assertRaises(ValueError):
            validator.validate_release_worker_env("FEISHU_WORKER_APP_ID\n")

    def test_cli_reads_file_and_prints_redacted_json(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            env_file = Path(tmp) / "release-worker.env"
            env_file.write_text(COMPLETE_ENV, encoding="utf-8")

            exit_code, output = validator.run_cli([str(env_file), "--json"])

        self.assertEqual(exit_code, 0)
        self.assertIn('"ready": true', output)
        self.assertNotIn("super-secret", output)

    def test_script_path_execution_works_from_repo_root(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            env_file = Path(tmp) / "release-worker.env"
            env_file.write_text(COMPLETE_ENV, encoding="utf-8")

            completed = subprocess.run(
                [sys.executable, "scripts/validate_release_worker_env.py", "--json", str(env_file)],
                check=False,
                capture_output=True,
                text=True,
            )

        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn('"ready": true', completed.stdout)
        self.assertNotIn("super-secret", completed.stdout)


if __name__ == "__main__":
    unittest.main()
