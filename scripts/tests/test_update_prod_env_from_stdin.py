import tempfile
import unittest
from pathlib import Path

from scripts import update_prod_env_from_stdin as updater


class UpdateProdEnvFromStdinTests(unittest.TestCase):
    def test_updates_existing_keys_and_appends_missing_without_printing_values(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            env_file = Path(tmp) / ".env.prod"
            env_file.write_text(
                "# existing\n"
                "FEISHU_WORKER_APP_ID=<app-id>\n"
                "POSTGRES_PASSWORD=keep-me\n",
                encoding="utf-8",
            )

            result = updater.update_env_file(
                env_file,
                "FEISHU_WORKER_APP_ID=cli_real\nFEISHU_WORKER_APP_SECRET=dummy-secret\n",
            )

            content = env_file.read_text(encoding="utf-8")
            self.assertIn("FEISHU_WORKER_APP_ID=cli_real\n", content)
            self.assertIn("FEISHU_WORKER_APP_SECRET=dummy-secret\n", content)
            self.assertIn("POSTGRES_PASSWORD=keep-me\n", content)
            self.assertEqual((env_file.with_suffix(env_file.suffix + ".bak")).read_text(encoding="utf-8").splitlines()[0], "# existing")
            self.assertEqual(result.updated_keys, ["FEISHU_WORKER_APP_ID"])
            self.assertEqual(result.added_keys, ["FEISHU_WORKER_APP_SECRET"])
            self.assertEqual(result.sanitized_details(), {
                "added": {"FEISHU_WORKER_APP_SECRET": "<set>"},
                "updated": {"FEISHU_WORKER_APP_ID": "<set>"},
                "unchanged": {},
            })
            self.assertNotIn("dummy-secret", str(result.sanitized_details()))

    def test_empty_value_is_reported_without_value(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            env_file = Path(tmp) / ".env.prod"
            env_file.write_text("FEISHU_WORKER_BOT_OPEN_ID=ou_old\n", encoding="utf-8")

            result = updater.update_env_file(env_file, "FEISHU_WORKER_BOT_OPEN_ID=\n")

            self.assertIn("FEISHU_WORKER_BOT_OPEN_ID=\n", env_file.read_text(encoding="utf-8"))
            self.assertEqual(result.sanitized_details()["updated"], {"FEISHU_WORKER_BOT_OPEN_ID": "<empty>"})

    def test_unknown_key_is_rejected_before_writing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            env_file = Path(tmp) / ".env.prod"
            env_file.write_text("FEISHU_WORKER_APP_ID=<app-id>\n", encoding="utf-8")

            with self.assertRaises(ValueError) as exc:
                updater.update_env_file(env_file, "UNRELATED_SECRET=value\n")

            self.assertIn("UNRELATED_SECRET", str(exc.exception))
            self.assertEqual(env_file.read_text(encoding="utf-8"), "FEISHU_WORKER_APP_ID=<app-id>\n")
            self.assertFalse(env_file.with_suffix(env_file.suffix + ".bak").exists())

    def test_malformed_line_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            env_file = Path(tmp) / ".env.prod"
            env_file.write_text("FEISHU_WORKER_APP_ID=<app-id>\n", encoding="utf-8")

            with self.assertRaises(ValueError):
                updater.update_env_file(env_file, "FEISHU_WORKER_APP_ID\n")


if __name__ == "__main__":
    unittest.main()
