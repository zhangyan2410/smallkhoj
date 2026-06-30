import json
import tarfile
import tempfile
import unittest
from pathlib import Path

from scripts import build_daemon_distribution as builder
from scripts.tests.test_initial_release_deploy_preflight import write


def make_daemon_tree(root: Path, *, version: str = "0.2.0") -> None:
    daemon_dir = root / "agent" / "daemon" / "aaa-daemon"
    write(daemon_dir / "package.json", f"""
        {{
          "name": "@smallkhoj/smallkhoj-daemon",
          "version": "{version}",
          "type": "module",
          "files": ["dist", "README.md"],
          "bin": {{
            "smallkhoj-daemon": "dist/cmd/main.js"
          }},
          "dependencies": {{}}
        }}
    """)
    write(daemon_dir / "package-lock.json", """
        {
          "name": "@smallkhoj/smallkhoj-daemon",
          "lockfileVersion": 3,
          "packages": {}
        }
    """)
    write(daemon_dir / "dist" / "cmd" / "main.js", """
        console.log("smallkhoj daemon")
    """)
    write(daemon_dir / "README.md", "# daemon")


class BuildDaemonDistributionTests(unittest.TestCase):
    def test_build_distribution_creates_versioned_platform_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_daemon_tree(root)
            output_dir = root / "artifacts"

            result = builder.build_distribution(
                root=root,
                output_dir=output_dir,
                target_platform="darwin-arm64",
                skip_build=True,
                install_production_deps=False,
            )

            self.assertEqual(result.version, "0.2.0")
            self.assertEqual(result.platform, "darwin-arm64")
            self.assertEqual(result.artifact.name, "smallkhoj-daemon-v0.2.0-darwin-arm64.tar.gz")
            self.assertEqual(result.npm_package.name, "smallkhoj-smallkhoj-daemon-0.2.0.tgz")
            self.assertTrue(result.npm_package.is_file())
            self.assertTrue(result.checksum_file.is_file())
            self.assertTrue(result.manifest.is_file())
            self.assertTrue(result.install_script.is_file())
            self.assertIn(result.sha256, result.checksum_file.read_text(encoding="utf-8"))
            install_script = result.install_script.read_text(encoding="utf-8")
            self.assertIn("SMALLKHOJ_DAEMON_DOWNLOAD_BASE_URL", install_script)
            self.assertIn("smallkhoj-daemon-v0.2.0-darwin-arm64.tar.gz", install_script)
            self.assertIn(result.sha256, install_script)
            self.assertIn('exec "${VERSION_DIR}/smallkhoj-daemon" "\\$@"', install_script)
            self.assertNotIn("ln -sfn", install_script)

            with tarfile.open(result.artifact, "r:gz") as tar:
                names = set(tar.getnames())

            prefix = "smallkhoj-daemon-v0.2.0-darwin-arm64"
            self.assertIn(f"{prefix}/smallkhoj-daemon", names)
            self.assertIn(f"{prefix}/dist/cmd/main.js", names)
            self.assertIn(f"{prefix}/manifest.json", names)
            self.assertNotIn("agent/daemon/aaa-daemon", "\n".join(names))

    def test_report_payload_is_machine_readable(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_daemon_tree(root, version="0.3.0")

            result = builder.build_distribution(
                root=root,
                output_dir=root / "artifacts",
                target_platform="linux-x64",
                skip_build=True,
                install_production_deps=False,
            )
            payload = builder.report_to_dict(result)

            self.assertEqual(payload["version"], "0.3.0")
            self.assertEqual(payload["platform"], "linux-x64")
            self.assertTrue(payload["artifact"].endswith("smallkhoj-daemon-v0.3.0-linux-x64.tar.gz"))
            self.assertTrue(payload["npmPackage"].endswith("smallkhoj-smallkhoj-daemon-0.3.0.tgz"))
            json.dumps(payload)


if __name__ == "__main__":
    unittest.main()
