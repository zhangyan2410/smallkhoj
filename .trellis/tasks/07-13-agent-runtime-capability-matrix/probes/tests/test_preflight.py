from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path


PROBES_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROBES_ROOT))

from lib.preflight import ManifestError, extract_version, load_manifest, render_argv


class PreflightManifestTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(dir="/tmp")
        self.manifest_path = Path(self.temp_dir.name) / "manifest.json"

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def _write_manifest(self, checks: list[dict[str, object]]) -> None:
        self.manifest_path.write_text(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "fixtureRoot": "/tmp/smallkhoj-agent-runtime-capability-matrix",
                    "perProviderLimit": 2,
                    "checks": checks,
                }
            ),
            encoding="utf-8",
        )

    def test_accepts_only_non_model_version_help_and_schema_commands(self) -> None:
        self._write_manifest(
            [
                {
                    "id": "codex-version",
                    "provider": "codex",
                    "surface": "codex-exec",
                    "mode": "version",
                    "argv": ["codex", "--version"],
                },
                {
                    "id": "codex-appserver-schema",
                    "provider": "codex",
                    "surface": "codex-appserver",
                    "mode": "schema",
                    "argv": [
                        "codex",
                        "app-server",
                        "generate-json-schema",
                        "--experimental",
                        "-o",
                        "{fixture}/schema",
                    ],
                },
            ]
        )

        manifest = load_manifest(self.manifest_path)

        self.assertEqual(2, manifest.per_provider_limit)
        self.assertEqual(
            [
                "codex",
                "app-server",
                "generate-json-schema",
                "--experimental",
                "-o",
                str(Path("/tmp/fixture").resolve() / "schema"),
            ],
            render_argv(manifest.checks[1], Path("/tmp/fixture")),
        )

    def test_rejects_any_manifest_command_that_could_send_a_prompt(self) -> None:
        self._write_manifest(
            [
                {
                    "id": "bad-exec",
                    "provider": "codex",
                    "surface": "codex-exec",
                    "mode": "version",
                    "argv": ["codex", "exec", "solve the task"],
                }
            ]
        )

        with self.assertRaises(ManifestError):
            load_manifest(self.manifest_path)

    def test_extracts_a_semantic_version_from_safe_version_output(self) -> None:
        self.assertEqual("0.144.3", extract_version("codex-cli 0.144.3\n"))
        self.assertEqual("2.1.183", extract_version("2.1.183 (Claude Code)\n"))
        self.assertIsNone(extract_version("no version available\n"))


if __name__ == "__main__":
    unittest.main()
