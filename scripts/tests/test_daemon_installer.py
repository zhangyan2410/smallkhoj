"""Executable macOS/Unix Ensure installer regressions.

These tests intentionally execute the generated product shell script rather
than only asserting string fragments.  A file:// carrier keeps the test
offline and deterministic while still exercising checksum, staging, active
pointer, launcher, and same-version reuse behavior.
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

from scripts import build_daemon_distribution as builder
from scripts.tests.test_build_daemon_distribution import make_daemon_tree


REVISION = "0123456789abcdef0123456789abcdef01234567"


class DaemonInstallerExecutionTests(unittest.TestCase):
    def run_installer(
        self,
        script: Path,
        *,
        home: Path,
        bin_dir: Path,
        carrier: Path,
        version: str | None = None,
        minimum_version: str | None = None,
    ) -> subprocess.CompletedProcess[str]:
        env = {
            "HOME": str(home),
            "PATH": f"{bin_dir}:/usr/local/bin:/usr/bin:/bin",
            "SMALLKHOJ_DAEMON_HOME": str(home / ".smallkhoj" / "daemon"),
            "SMALLKHOJ_DAEMON_BIN_DIR": str(bin_dir),
            "SMALLKHOJ_DAEMON_DOWNLOAD_BASE_URL": carrier.as_uri(),
        }
        if version:
            env["SMALLKHOJ_DAEMON_VERSION"] = version
        if minimum_version:
            env["SMALLKHOJ_DAEMON_MINIMUM_VERSION"] = minimum_version
        return subprocess.run(
            [str(script)],
            env={**os.environ, **env},
            text=True,
            capture_output=True,
            check=False,
        )

    def build(self, root: Path, version: str, output: Path) -> builder.DaemonDistribution:
        make_daemon_tree(root, version=version)
        return builder.build_distribution(
            root=root,
            output_dir=output,
            target_platform="darwin-arm64",
            skip_build=True,
            install_production_deps=False,
            source_revision=REVISION,
        )

    def test_same_version_reuses_complete_install_without_archive(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "source"
            carrier = Path(tmp) / "carrier"
            home = Path(tmp) / "home"
            bin_dir = Path(tmp) / "bin"
            carrier.mkdir()
            bin_dir.mkdir()
            result = self.build(root, "0.2.0", carrier)

            first = self.run_installer(result.install_script, home=home, bin_dir=bin_dir, carrier=carrier)
            self.assertEqual(first.returncode, 0, first.stderr)
            self.assertIn("Installed Aura", first.stdout)
            active = json.loads((home / ".smallkhoj" / "daemon" / "active.json").read_text())
            self.assertEqual(active["version"], "0.2.0")

            # The second invocation may read the small sidecar manifest, but it
            # must not need the large archive at all.
            result.artifact.unlink()
            second = self.run_installer(result.install_script, home=home, bin_dir=bin_dir, carrier=carrier)
            self.assertEqual(second.returncode, 0, second.stderr)
            self.assertIn("archive download skipped", second.stdout)

    def test_corruption_repairs_from_archive_and_failed_hash_keeps_active(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "source"
            carrier = Path(tmp) / "carrier"
            home = Path(tmp) / "home"
            bin_dir = Path(tmp) / "bin"
            carrier.mkdir()
            bin_dir.mkdir()
            result = self.build(root, "0.2.0", carrier)

            first = self.run_installer(result.install_script, home=home, bin_dir=bin_dir, carrier=carrier)
            self.assertEqual(first.returncode, 0, first.stderr)
            version_dir = home / ".smallkhoj" / "daemon" / "versions" / "v0.2.0-darwin-arm64"
            (version_dir / "manifest.json").write_text("corrupt")
            repaired = self.run_installer(result.install_script, home=home, bin_dir=bin_dir, carrier=carrier)
            self.assertEqual(repaired.returncode, 0, repaired.stderr)
            self.assertIn('"version": "0.2.0"', (version_dir / "manifest.json").read_text())

            # A bad archive checksum must fail closed and leave the known-good
            # active pointer untouched.
            before = (home / ".smallkhoj" / "daemon" / "active.json").read_text()
            (version_dir / "manifest.json").write_text("corrupt-again")
            result.artifact.write_bytes(b"not-a-valid-archive")
            failed = self.run_installer(result.install_script, home=home, bin_dir=bin_dir, carrier=carrier)
            self.assertNotEqual(failed.returncode, 0)
            self.assertEqual((home / ".smallkhoj" / "daemon" / "active.json").read_text(), before)

    def test_newer_active_version_refuses_downgrade(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "source"
            carrier = Path(tmp) / "carrier"
            home = Path(tmp) / "home"
            bin_dir = Path(tmp) / "bin"
            carrier.mkdir()
            bin_dir.mkdir()
            result = self.build(root, "0.3.0", carrier)
            first = self.run_installer(result.install_script, home=home, bin_dir=bin_dir, carrier=carrier)
            self.assertEqual(first.returncode, 0, first.stderr)

            # Keep the 0.3.0 archive available while asking the same installer
            # for its embedded lower version; the active pointer is authoritative.
            lower_root = Path(tmp) / "lower-source"
            lower_carrier = Path(tmp) / "lower-carrier"
            lower_carrier.mkdir()
            lower = self.build(lower_root, "0.2.0", lower_carrier)
            downgrade = self.run_installer(lower.install_script, home=home, bin_dir=bin_dir, carrier=lower_carrier)
            self.assertNotEqual(downgrade.returncode, 0)
            self.assertIn("refusing to downgrade", downgrade.stderr)

    def test_legacy_sidecar_without_minimum_preserves_embedded_offline_floor(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root_old = Path(tmp) / "old-source"
            old_carrier = Path(tmp) / "old-carrier"
            root_new = Path(tmp) / "new-source"
            new_carrier = Path(tmp) / "new-carrier"
            home = Path(tmp) / "home"
            bin_dir = Path(tmp) / "bin"
            old_carrier.mkdir()
            new_carrier.mkdir()
            bin_dir.mkdir()

            old = self.build(root_old, "0.2.0", old_carrier)
            first = self.run_installer(old.install_script, home=home, bin_dir=bin_dir, carrier=old_carrier)
            self.assertEqual(first.returncode, 0, first.stderr)

            newer = self.build(root_new, "0.3.0", new_carrier)
            sidecar = json.loads(newer.manifest.read_text(encoding="utf-8"))
            sidecar.pop("minimumDaemonVersion", None)
            newer.manifest.write_text(json.dumps(sidecar, indent=2), encoding="utf-8")
            newer.artifact.unlink()

            reused = self.run_installer(
                newer.install_script,
                home=home,
                bin_dir=bin_dir,
                carrier=new_carrier,
                minimum_version="0.2.0",
            )
            self.assertEqual(reused.returncode, 0, reused.stderr)
            self.assertIn("offline-reused", reused.stdout)
            active = json.loads((home / ".smallkhoj" / "daemon" / "active.json").read_text())
            self.assertEqual(active["version"], "0.2.0")


if __name__ == "__main__":
    unittest.main()
