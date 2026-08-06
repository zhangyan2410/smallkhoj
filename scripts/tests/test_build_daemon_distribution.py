import json
import hashlib
import tarfile
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

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
    write(daemon_dir / "dist" / "slock-cli.js", """
        console.log("smallkhoj agent cli")
    """)
    write(daemon_dir / "README.md", "# daemon")


def write_minimal_pe(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = bytearray(128)
    payload[:2] = b"MZ"
    payload[0x3C:0x40] = (64).to_bytes(4, "little")
    payload[64:68] = b"PE\0\0"
    path.write_bytes(payload)


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
                source_revision="0123456789abcdef0123456789abcdef01234567",
                clean_output_dir=True,
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
            self.assertIn('exec "${VERSION_DIR}/aura" "\\$@"', install_script)
            self.assertNotIn("ln -sfn", install_script)

            with tarfile.open(result.artifact, "r:gz") as tar:
                names = set(tar.getnames())

            prefix = "smallkhoj-daemon-v0.2.0-darwin-arm64"
            self.assertIn(f"{prefix}/smallkhoj-daemon", names)
            self.assertIn(f"{prefix}/aura", names)
            self.assertIn(f"{prefix}/dist/cmd/main.js", names)
            self.assertIn(f"{prefix}/dist/slock-cli.js", names)
            self.assertIn(f"{prefix}/manifest.json", names)
            self.assertNotIn("agent/daemon/aaa-daemon", "\n".join(names))
            manifest = json.loads(result.manifest.read_text(encoding="utf-8"))
            self.assertEqual(
                manifest["sourceRevision"],
                "0123456789abcdef0123456789abcdef01234567",
            )
            self.assertEqual(
                set(manifest["files"]),
                {
                    result.artifact.name,
                    result.npm_package.name,
                    result.checksum_file.name,
                    result.install_script.name,
                },
            )
            for filename, expected_sha256 in manifest["files"].items():
                actual = hashlib.sha256((output_dir / filename).read_bytes()).hexdigest()
                self.assertEqual(actual, expected_sha256)

    def test_clean_output_removes_stale_ignored_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_daemon_tree(root)
            output_dir = root / "artifacts"
            write(output_dir / "stale-secret.txt", "must not enter image context")

            builder.build_distribution(
                root=root,
                output_dir=output_dir,
                target_platform="linux-x64",
                skip_build=True,
                install_production_deps=False,
                source_revision="0123456789abcdef0123456789abcdef01234567",
                clean_output_dir=True,
            )

            self.assertFalse((output_dir / "stale-secret.txt").exists())

    def test_real_build_cleans_ignored_dist_and_uses_locked_install(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_daemon_tree(root)
            daemon_dir = root / builder.DAEMON_RELATIVE_DIR
            write(daemon_dir / "dist" / "stale.js", "stale ignored output")
            commands: list[list[str]] = []

            def run_command(
                args: list[str],
                *,
                cwd: Path,
                timeout: int = 120,
            ) -> None:
                del timeout
                commands.append(args)
                if args == ["npm", "run", "build"]:
                    write(cwd / "dist" / "cmd" / "main.js", "fresh build")

            def create_npm_package(daemon: Path, output: Path) -> Path:
                del daemon
                package = output / "smallkhoj-smallkhoj-daemon-0.2.0.tgz"
                write(package, "fresh package")
                return package

            with (
                mock.patch.object(builder, "run_command", side_effect=run_command),
                mock.patch.object(
                    builder,
                    "create_npm_package",
                    side_effect=create_npm_package,
                ),
            ):
                builder.build_distribution(
                    root=root,
                    output_dir=root / "artifacts",
                    target_platform="linux-x64",
                    skip_build=False,
                    install_production_deps=False,
                    source_revision=(
                        "0123456789abcdef0123456789abcdef01234567"
                    ),
                    clean_output_dir=True,
                )

            self.assertEqual(commands[0], ["npm", "ci", "--silent"])
            self.assertFalse((daemon_dir / "dist" / "stale.js").exists())
            self.assertEqual(
                (daemon_dir / "dist" / "cmd" / "main.js").read_text().strip(),
                "fresh build",
            )

    def test_clean_output_rejects_directory_outside_project_root(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, tempfile.TemporaryDirectory() as out:
            root = Path(tmp)
            make_daemon_tree(root)

            with self.assertRaisesRegex(ValueError, "inside the project root"):
                builder.build_distribution(
                    root=root,
                    output_dir=Path(out),
                    target_platform="linux-x64",
                    skip_build=True,
                    install_production_deps=False,
                    source_revision=(
                        "0123456789abcdef0123456789abcdef01234567"
                    ),
                    clean_output_dir=True,
                )

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
                source_revision="0123456789abcdef0123456789abcdef01234567",
                clean_output_dir=True,
            )
            payload = builder.report_to_dict(result)

            self.assertEqual(payload["version"], "0.3.0")
            self.assertEqual(payload["platform"], "linux-x64")
            self.assertTrue(payload["artifact"].endswith("smallkhoj-daemon-v0.3.0-linux-x64.tar.gz"))
            self.assertTrue(payload["npmPackage"].endswith("smallkhoj-smallkhoj-daemon-0.3.0.tgz"))
            json.dumps(payload)

    def test_windows_build_requires_native_runtime_and_emits_powershell_installer(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_daemon_tree(root)
            output_dir = root / "artifacts"

            with self.assertRaisesRegex(ValueError, "windows-runtime-dir"):
                builder.build_distribution(
                    root=root,
                    output_dir=output_dir,
                    target_platform="win32-x64",
                    skip_build=True,
                    install_production_deps=False,
                    source_revision="0123456789abcdef0123456789abcdef01234567",
                    clean_output_dir=True,
                )

            runtime = root / "windows-runtime"
            write_minimal_pe(runtime / "node.exe")
            write_minimal_pe(runtime / "aura.exe")
            result = builder.build_distribution(
                root=root,
                output_dir=output_dir,
                target_platform="win32-x64",
                skip_build=True,
                install_production_deps=False,
                source_revision="0123456789abcdef0123456789abcdef01234567",
                clean_output_dir=True,
                windows_runtime_dir=runtime,
            )

            self.assertEqual(result.artifact.name, "smallkhoj-daemon-v0.2.0-win32-x64.zip")
            self.assertEqual(result.install_script.name, "install.ps1")
            script = result.install_script.read_text(encoding="utf-8")
            self.assertIn("PROCESSOR_ARCHITEW6432", script)
            self.assertIn("Get-AuraArchitecture", script)
            self.assertIn("Get-FileHash -Algorithm SHA256", script)
            self.assertIn("LOCALAPPDATA", script)
            self.assertIn("AURA_STANDALONE=1", script)
            self.assertIn(result.sha256, script)
            self.assertIn("private node.exe runtime", script)
            self.assertIn("manifest.json", script)
            self.assertIn("$rootName = 'smallkhoj-daemon-v0.2.0-win32-x64'", script)
            self.assertNotIn("$rootName = 'smallkhoj-daemon-v0.2.0-win32-x64.zip'", script)
            with zipfile.ZipFile(result.artifact) as archive:
                names = set(archive.namelist())
                aura_cmd = archive.read("smallkhoj-daemon-v0.2.0-win32-x64/aura.cmd").decode("ascii")
            prefix = "smallkhoj-daemon-v0.2.0-win32-x64"
            self.assertIn(f"{prefix}/aura.exe", names)
            self.assertIn(f"{prefix}/node.exe", names)
            self.assertIn(f"{prefix}/aura.cmd", names)
            self.assertIn(f"{prefix}/manifest.json", names)
            self.assertIn("AURA_STANDALONE=1", aura_cmd)

    def test_windows_build_rejects_non_pe_runtime(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_daemon_tree(root)
            runtime = root / "windows-runtime"
            write(runtime / "node.exe", "not-a-real-node")
            write(runtime / "aura.exe", "not-a-real-pe")

            with self.assertRaisesRegex(ValueError, "PE executable"):
                builder.build_distribution(
                    root=root,
                    output_dir=root / "artifacts",
                    target_platform="win32-x64",
                    skip_build=True,
                    install_production_deps=False,
                    source_revision="0123456789abcdef0123456789abcdef01234567",
                    windows_runtime_dir=runtime,
                )

    def test_windows_platform_rejects_unknown_architecture_label(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_daemon_tree(root)
            with self.assertRaisesRegex(ValueError, "win32-x64"):
                builder.build_distribution(
                    root=root,
                    output_dir=root / "artifacts",
                    target_platform="win32-mips",
                    skip_build=True,
                    install_production_deps=False,
                    source_revision="0123456789abcdef0123456789abcdef01234567",
                )


if __name__ == "__main__":
    unittest.main()
