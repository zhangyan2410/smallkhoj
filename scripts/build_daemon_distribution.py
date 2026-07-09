#!/usr/bin/env python3
"""Build a versioned SmallKhoj daemon distribution archive."""

from __future__ import annotations

import argparse
import hashlib
import json
import platform as platform_module
import shutil
import subprocess
import sys
import tarfile
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DAEMON_RELATIVE_DIR = Path("agent/daemon/aaa-daemon")
ARTIFACT_PREFIX = "smallkhoj-daemon"


@dataclass(frozen=True)
class DaemonDistribution:
    version: str
    platform: str
    artifact: Path
    npm_package: Path
    checksum_file: Path
    sha256: str
    manifest: Path
    install_script: Path


def normalize_machine(machine: str) -> str:
    value = machine.lower()
    if value in {"arm64", "aarch64"}:
        return "arm64"
    if value in {"x86_64", "amd64"}:
        return "x64"
    return value or "unknown"


def default_platform() -> str:
    os_name = sys.platform
    if os_name == "darwin":
        os_part = "darwin"
    elif os_name.startswith("linux"):
        os_part = "linux"
    else:
        os_part = os_name.replace(" ", "-").lower()
    return f"{os_part}-{normalize_machine(platform_module.machine())}"


def read_package_json(daemon_dir: Path) -> dict[str, Any]:
    path = daemon_dir / "package.json"
    return json.loads(path.read_text(encoding="utf-8"))


def run_command(args: list[str], *, cwd: Path, timeout: int = 120) -> None:
    completed = subprocess.run(args, cwd=cwd, check=False, text=True, timeout=timeout)
    if completed.returncode != 0:
        raise RuntimeError(f"Command failed with exit code {completed.returncode}: {' '.join(args)}")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def copy_required_runtime_files(daemon_dir: Path, staging_dir: Path) -> None:
    dist_dir = daemon_dir / "dist"
    if not dist_dir.is_dir():
        raise FileNotFoundError(f"Daemon dist directory is missing: {dist_dir}")
    shutil.copytree(dist_dir, staging_dir / "dist")
    shutil.copy2(daemon_dir / "package.json", staging_dir / "package.json")
    package_lock = daemon_dir / "package-lock.json"
    if package_lock.is_file():
        shutil.copy2(package_lock, staging_dir / "package-lock.json")
    readme = daemon_dir / "README.md"
    if readme.is_file():
        shutil.copy2(readme, staging_dir / "README.md")


def write_launcher(staging_dir: Path) -> None:
    launcher = staging_dir / "smallkhoj-daemon"
    launcher_text = (
        "\n".join([
            "#!/usr/bin/env bash",
            "set -euo pipefail",
            'DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
            'exec node "$DIR/dist/cmd/main.js" "$@"',
            "",
        ])
    )
    launcher.write_text(launcher_text, encoding="utf-8")
    launcher.chmod(0o755)
    aura_launcher = staging_dir / "aura"
    aura_launcher.write_text(launcher_text, encoding="utf-8")
    aura_launcher.chmod(0o755)


def write_manifest(
    staging_dir: Path,
    *,
    version: str,
    target_platform: str,
    git_commit: str | None,
) -> None:
    payload = {
        "name": ARTIFACT_PREFIX,
        "version": version,
        "platform": target_platform,
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "gitCommit": git_commit,
        "entrypoint": "aura",
        "requires": {
            "node": ">=20",
        },
    }
    (staging_dir / "manifest.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def current_git_commit(root: Path) -> str | None:
    try:
        completed = subprocess.run(
            ["git", "rev-parse", "--short=12", "HEAD"],
            cwd=root,
            check=False,
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if completed.returncode != 0:
        return None
    return completed.stdout.strip() or None


def create_archive(staging_dir: Path, output_dir: Path, *, version: str, target_platform: str) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    artifact = output_dir / f"{ARTIFACT_PREFIX}-v{version}-{target_platform}.tar.gz"
    root_name = artifact.name.removesuffix(".tar.gz")
    with tarfile.open(artifact, "w:gz") as tar:
        for path in sorted(staging_dir.rglob("*")):
            tar.add(path, arcname=str(Path(root_name) / path.relative_to(staging_dir)))
    return artifact


def create_npm_package(daemon_dir: Path, output_dir: Path) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    completed = subprocess.run(
        ["npm", "pack", "--pack-destination", str(output_dir), "--json"],
        cwd=daemon_dir,
        check=False,
        capture_output=True,
        text=True,
        timeout=120,
    )
    if completed.returncode != 0:
        raise RuntimeError(f"npm pack failed with exit code {completed.returncode}: {completed.stderr.strip()}")
    try:
        payload = json.loads(completed.stdout)
        filename = payload[0]["filename"]
    except (IndexError, KeyError, json.JSONDecodeError, TypeError) as exc:
        raise RuntimeError(f"npm pack returned an unexpected payload: {completed.stdout}") from exc
    package_path = output_dir / filename
    if not package_path.is_file():
        raise FileNotFoundError(f"npm pack did not create expected package: {package_path}")
    return package_path


def write_install_script(
    output_dir: Path,
    *,
    artifact_name: str,
    root_name: str,
    version: str,
    target_platform: str,
    sha256: str,
) -> Path:
    install_script = output_dir / "install.sh"
    install_script.write_text(
        "\n".join([
            "#!/usr/bin/env bash",
            "set -euo pipefail",
            "",
            f'ARTIFACT_NAME="{artifact_name}"',
            f'ARTIFACT_ROOT="{root_name}"',
            f'DAEMON_VERSION="{version}"',
            f'DAEMON_PLATFORM="{target_platform}"',
            f'ARTIFACT_SHA256="{sha256}"',
            'BASE_URL="${SMALLKHOJ_DAEMON_DOWNLOAD_BASE_URL:-}"',
            'INSTALL_HOME="${SMALLKHOJ_DAEMON_HOME:-${HOME}/.smallkhoj/daemon}"',
            'BIN_DIR="${SMALLKHOJ_DAEMON_BIN_DIR:-${HOME}/.smallkhoj/bin}"',
            "",
            'if [[ -z "$BASE_URL" ]]; then',
            '  echo "SMALLKHOJ_DAEMON_DOWNLOAD_BASE_URL is required, e.g. https://server/downloads/smallkhoj-daemon" >&2',
            "  exit 2",
            "fi",
            "",
            'TMP_DIR="$(mktemp -d)"',
            'trap \'rm -rf "$TMP_DIR"\' EXIT',
            'ARCHIVE_PATH="${TMP_DIR}/${ARTIFACT_NAME}"',
            "",
            'curl -fsSL "${BASE_URL%/}/${ARTIFACT_NAME}" -o "$ARCHIVE_PATH"',
            'if command -v shasum >/dev/null 2>&1; then',
            '  printf "%s  %s\\n" "$ARTIFACT_SHA256" "$ARCHIVE_PATH" | shasum -a 256 -c - >/dev/null',
            "else",
            '  printf "%s  %s\\n" "$ARTIFACT_SHA256" "$ARCHIVE_PATH" | sha256sum -c - >/dev/null',
            "fi",
            "",
            'tar -xzf "$ARCHIVE_PATH" -C "$TMP_DIR"',
            'VERSION_DIR="${INSTALL_HOME}/versions/v${DAEMON_VERSION}-${DAEMON_PLATFORM}"',
            'rm -rf "$VERSION_DIR"',
            'mkdir -p "$VERSION_DIR" "$BIN_DIR"',
            'cp -R "${TMP_DIR}/${ARTIFACT_ROOT}/." "$VERSION_DIR/"',
            'cat > "${BIN_DIR}/smallkhoj-daemon" <<EOF',
            '#!/usr/bin/env bash',
            'exec "${VERSION_DIR}/smallkhoj-daemon" "\\$@"',
            'EOF',
            'cat > "${BIN_DIR}/aura" <<EOF',
            '#!/usr/bin/env bash',
            'exec "${VERSION_DIR}/aura" "\\$@"',
            'EOF',
            'chmod +x "${VERSION_DIR}/smallkhoj-daemon"',
            'chmod +x "${VERSION_DIR}/aura"',
            'chmod +x "${BIN_DIR}/smallkhoj-daemon"',
            'chmod +x "${BIN_DIR}/aura"',
            "",
            'echo "Installed AuraTeam daemon ${DAEMON_VERSION} (${DAEMON_PLATFORM}) to ${VERSION_DIR}"',
            'echo "Add ${BIN_DIR} to PATH if aura is not found."',
            "",
        ]),
        encoding="utf-8",
    )
    install_script.chmod(0o755)
    return install_script


def build_distribution(
    *,
    root: Path,
    output_dir: Path,
    target_platform: str | None = None,
    skip_build: bool = False,
    install_production_deps: bool = True,
) -> DaemonDistribution:
    root = root.resolve()
    daemon_dir = root / DAEMON_RELATIVE_DIR
    package_json = read_package_json(daemon_dir)
    version = str(package_json["version"])
    platform_value = target_platform or default_platform()

    if not skip_build:
        run_command(["npm", "install", "--silent"], cwd=daemon_dir, timeout=180)
        run_command(["npm", "run", "build"], cwd=daemon_dir, timeout=120)

    npm_package = create_npm_package(daemon_dir, output_dir.resolve())

    with tempfile.TemporaryDirectory(prefix="smallkhoj-daemon-dist-") as tmp:
        staging_dir = Path(tmp) / "staging"
        staging_dir.mkdir(parents=True)
        copy_required_runtime_files(daemon_dir, staging_dir)
        write_launcher(staging_dir)
        write_manifest(
            staging_dir,
            version=version,
            target_platform=platform_value,
            git_commit=current_git_commit(root),
        )
        if install_production_deps:
            run_command(["npm", "install", "--omit=dev", "--silent"], cwd=staging_dir, timeout=180)
        artifact = create_archive(staging_dir, output_dir.resolve(), version=version, target_platform=platform_value)

    digest = sha256_file(artifact)
    checksum = artifact.with_suffix(artifact.suffix + ".sha256")
    checksum.write_text(f"{digest}  {artifact.name}\n", encoding="utf-8")
    install_script = write_install_script(
        output_dir.resolve(),
        artifact_name=artifact.name,
        root_name=artifact.name.removesuffix(".tar.gz"),
        version=version,
        target_platform=platform_value,
        sha256=digest,
    )
    manifest = artifact.with_suffix(artifact.suffix + ".manifest.json")
    manifest.write_text(
        json.dumps(
            {
                "name": ARTIFACT_PREFIX,
                "version": version,
                "platform": platform_value,
                "artifact": str(artifact),
                "npmPackage": str(npm_package),
                "sha256": digest,
                "checksumFile": str(checksum),
                "installScript": str(install_script),
            },
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )
    return DaemonDistribution(
        version=version,
        platform=platform_value,
        artifact=artifact,
        npm_package=npm_package,
        checksum_file=checksum,
        sha256=digest,
        manifest=manifest,
        install_script=install_script,
    )


def report_to_dict(result: DaemonDistribution) -> dict[str, Any]:
    return {
        "version": result.version,
        "platform": result.platform,
        "artifact": str(result.artifact),
        "npmPackage": str(result.npm_package),
        "checksumFile": str(result.checksum_file),
        "sha256": result.sha256,
        "manifest": str(result.manifest),
        "installScript": str(result.install_script),
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build a versioned SmallKhoj daemon distribution archive.")
    parser.add_argument("--root", default=".", help="Project root. Defaults to current directory.")
    parser.add_argument("--output-dir", required=True, help="Directory where the daemon artifact should be written.")
    parser.add_argument("--platform", dest="target_platform", help="Target platform label, e.g. darwin-arm64.")
    parser.add_argument("--skip-build", action="store_true", help="Do not run npm install/npm run build before packaging.")
    parser.add_argument(
        "--skip-production-deps",
        action="store_true",
        help="Do not run npm install --omit=dev in the staged artifact.",
    )
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        result = build_distribution(
            root=Path(args.root),
            output_dir=Path(args.output_dir),
            target_platform=args.target_platform,
            skip_build=args.skip_build,
            install_production_deps=not args.skip_production_deps,
        )
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1
    if args.json:
        print(json.dumps(report_to_dict(result), ensure_ascii=False, indent=2, sort_keys=True))
    else:
        print(str(result.artifact))
        print(str(result.checksum_file))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
