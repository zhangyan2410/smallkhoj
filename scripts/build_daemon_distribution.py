#!/usr/bin/env python3
"""Build a versioned SmallKhoj daemon distribution archive."""

from __future__ import annotations

import argparse
import hashlib
import json
import platform as platform_module
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DAEMON_RELATIVE_DIR = Path("agent/daemon/aaa-daemon")
ARTIFACT_PREFIX = "smallkhoj-daemon"
WINDOWS_PLATFORM_PREFIX = "win32-"


@dataclass(frozen=True)
class DaemonDistribution:
    version: str
    platform: str
    source_revision: str
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


def copy_windows_runtime(
    staging_dir: Path,
    *,
    runtime_dir: Path | None,
    launcher_path: Path | None,
) -> None:
    """Stage the private Windows Node runtime and user-facing Aura launcher.

    A macOS checkout cannot manufacture a valid PE executable.  The builder
    therefore requires a Windows-produced runtime directory (or an explicit
    launcher path) for ``win32-*`` targets and fails closed with an actionable
    message when it is missing.  The Windows release job supplies these files;
    Unix builds continue to use the shell launchers above.
    """

    if runtime_dir is None and launcher_path is None:
        raise ValueError(
            "Windows standalone packaging requires --windows-runtime-dir "
            "(containing node.exe and aura.exe) or --windows-launcher"
        )

    def require_pe(path: Path, label: str) -> None:
        try:
            with path.open("rb") as handle:
                dos_header = handle.read(64)
                if len(dos_header) < 64 or dos_header[:2] != b"MZ":
                    raise ValueError
                pe_offset = int.from_bytes(dos_header[0x3C:0x40], "little")
                handle.seek(pe_offset)
                if handle.read(4) != b"PE\0\0":
                    raise ValueError
        except (OSError, ValueError):
            raise ValueError(f"Windows {label} must be a PE executable (MZ/PE header): {path}") from None

    if runtime_dir is not None:
        runtime_dir = runtime_dir.resolve()
        node_runtime = runtime_dir / "node.exe"
        if not node_runtime.is_file():
            raise FileNotFoundError(f"Windows private Node runtime is missing: {node_runtime}")
        require_pe(node_runtime, "private Node runtime")
        shutil.copy2(node_runtime, staging_dir / "node.exe")
        bundled_launcher = runtime_dir / "aura.exe"
        if bundled_launcher.is_file():
            require_pe(bundled_launcher, "Aura launcher")
            shutil.copy2(bundled_launcher, staging_dir / "aura.exe")

    if launcher_path is not None:
        launcher_path = launcher_path.resolve()
        if not launcher_path.is_file():
            raise FileNotFoundError(f"Windows Aura launcher is missing: {launcher_path}")
        require_pe(launcher_path, "Aura launcher")
        shutil.copy2(launcher_path, staging_dir / "aura.exe")

    if not (staging_dir / "aura.exe").is_file():
        raise FileNotFoundError(
            "Windows standalone packaging requires a valid aura.exe in the "
            "runtime directory or --windows-launcher"
        )
    require_pe(staging_dir / "aura.exe", "Aura launcher")

    # The .cmd shim is intentionally retained for diagnostics and PATH probes;
    # the product command remains aura.exe once a real launcher is supplied.
    (staging_dir / "aura.cmd").write_text(
        "@echo off\r\nset \"AURA_STANDALONE=1\"\r\n\"%~dp0aura.exe\" %*\r\n",
        encoding="utf-8",
    )


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
        "standalone": target_platform.startswith(WINDOWS_PLATFORM_PREFIX),
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
            ["git", "rev-parse", "--verify", "HEAD"],
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
    revision = completed.stdout.strip().lower()
    return revision if re.fullmatch(r"[0-9a-f]{40}", revision) else None


def resolve_source_revision(root: Path, requested: str | None) -> str:
    current = current_git_commit(root)
    revision = requested.strip().lower() if isinstance(requested, str) else current
    if revision is None or re.fullmatch(r"[0-9a-f]{40}", revision) is None:
        raise ValueError("source revision must be a 40-character Git commit SHA")
    if current is not None and revision != current:
        raise ValueError("source revision must equal the current HEAD")
    return revision


def clean_artifact_output(root: Path, daemon_dir: Path, output_dir: Path) -> None:
    protected = {root.resolve(), daemon_dir.resolve(), Path("/")}
    if output_dir in protected:
        raise ValueError("refusing to clean a protected daemon artifact directory")
    if root.resolve() not in output_dir.parents:
        raise ValueError("clean daemon artifact output must be inside the project root")
    if output_dir.exists():
        shutil.rmtree(output_dir)


def create_archive(staging_dir: Path, output_dir: Path, *, version: str, target_platform: str) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    if target_platform.startswith(WINDOWS_PLATFORM_PREFIX):
        artifact = output_dir / f"{ARTIFACT_PREFIX}-v{version}-{target_platform}.zip"
        root_name = artifact.stem
        with zipfile.ZipFile(artifact, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(staging_dir.rglob("*")):
                if path.is_file():
                    archive.write(path, arcname=str(Path(root_name) / path.relative_to(staging_dir)))
        return artifact

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
    if target_platform.startswith(WINDOWS_PLATFORM_PREFIX):
        return write_windows_install_script(
            output_dir,
            artifact_name=artifact_name,
            root_name=root_name,
            version=version,
            target_platform=target_platform,
            sha256=sha256,
        )

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


def write_windows_install_script(
    output_dir: Path,
    *,
    artifact_name: str,
    root_name: str,
    version: str,
    target_platform: str,
    sha256: str,
) -> Path:
    """Write a no-admin, fail-closed PowerShell installer for Aura.

    The script intentionally performs architecture detection before download,
    verifies the immutable SHA-256, stages a versioned directory under
    ``%LOCALAPPDATA%\\Aura``, and updates the user PATH only after the files are
    complete.  It is generated on any host but must be executed and smoke-tested
    on a native Windows host before release.
    """

    install_script = output_dir / "install.ps1"
    expected_arch = target_platform.removeprefix(WINDOWS_PLATFORM_PREFIX)
    install_script.write_text(
        "\n".join(
            [
                "[CmdletBinding()]",
                "param([string]$BaseUrl = $env:AURA_DOWNLOAD_BASE_URL)",
                "$ErrorActionPreference = 'Stop'",
                "",
                "function Get-AuraArchitecture {",
                "  $raw = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }",
                "  switch ($raw.ToUpperInvariant()) {",
                "    'AMD64' { return 'x64' }",
                "    'ARM64' { return 'arm64' }",
                "    'X86' { return 'x86' }",
                "    default { throw \"Unsupported Windows CPU architecture: $raw\" }",
                "  }",
                "}",
                "",
                f"$expectedPlatform = '{target_platform}'",
                f"$expectedArchitecture = '{expected_arch}'",
                "$architecture = Get-AuraArchitecture",
                "if ($architecture -ne $expectedArchitecture) {",
                "  throw \"This Aura release targets $expectedArchitecture, but the host reports $architecture.\"",
                "}",
                "if ([string]::IsNullOrWhiteSpace($BaseUrl)) {",
                "  throw 'AURA_DOWNLOAD_BASE_URL is required (for example https://server/downloads/smallkhoj-daemon).'",
                "}",
                "",
                f"$artifactName = '{artifact_name}'",
                f"$artifactSha256 = '{sha256.lower()}'",
                f"$version = '{version}'",
                f"$rootName = '{root_name}'",
                "$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ('aura-install-' + [Guid]::NewGuid().ToString('N'))",
                "$archivePath = Join-Path $temporaryRoot $artifactName",
                "$extractPath = Join-Path $temporaryRoot 'extract'",
                "New-Item -ItemType Directory -Force -Path $temporaryRoot, $extractPath | Out-Null",
                "try {",
                "  Invoke-WebRequest -UseBasicParsing -Uri ($BaseUrl.TrimEnd('/') + '/' + $artifactName) -OutFile $archivePath",
                "  $actualSha256 = (Get-FileHash -Algorithm SHA256 -Path $archivePath).Hash.ToLowerInvariant()",
                "  if ($actualSha256 -ne $artifactSha256) { throw \"SHA-256 verification failed for $artifactName.\" }",
                "  Expand-Archive -LiteralPath $archivePath -DestinationPath $extractPath -Force",
                "  $source = Join-Path $extractPath $rootName",
                "  if (-not (Test-Path (Join-Path $source 'aura.exe'))) { throw 'The archive does not contain aura.exe.' }",
                "  if (-not (Test-Path (Join-Path $source 'node.exe'))) { throw 'The archive does not contain the private node.exe runtime.' }",
                "  if (-not (Test-Path (Join-Path $source 'manifest.json'))) { throw 'The archive does not contain manifest.json.' }",
                "  $installRoot = Join-Path $env:LOCALAPPDATA 'Aura'",
                "  $versionRoot = Join-Path (Join-Path $installRoot 'versions') ('v' + $version + '-' + $expectedPlatform)",
                "  $binRoot = Join-Path $installRoot 'bin'",
                "  New-Item -ItemType Directory -Force -Path (Split-Path $versionRoot), $binRoot | Out-Null",
                "  $staging = $versionRoot + '.staging-' + [Guid]::NewGuid().ToString('N')",
                "  Copy-Item -LiteralPath $source -Destination $staging -Recurse -Force",
                "  if (Test-Path $versionRoot) { Remove-Item -LiteralPath $versionRoot -Recurse -Force }",
                "  Move-Item -LiteralPath $staging -Destination $versionRoot",
                "  $launcherContent = '@echo off`r`nset \"AURA_STANDALONE=1\"`r`n\"' + (Join-Path $versionRoot 'aura.exe') + '\" %*`r`n'",
                "  Set-Content -LiteralPath (Join-Path $binRoot 'aura.cmd') -Value $launcherContent -Encoding ASCII",
                "  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')",
                "  $pathParts = @($userPath -split ';' | Where-Object { $_ })",
                "  if ($pathParts -notcontains $binRoot) { [Environment]::SetEnvironmentVariable('Path', (($pathParts + $binRoot) -join ';'), 'User') }",
                "  $activePath = Join-Path $installRoot 'active.json'",
                "  $activeTemp = $activePath + '.tmp-' + [Guid]::NewGuid().ToString('N')",
                "  @{ version = $version; platform = $expectedPlatform; path = $versionRoot } | ConvertTo-Json | Set-Content -LiteralPath $activeTemp -Encoding UTF8",
                "  Move-Item -LiteralPath $activeTemp -Destination $activePath -Force",
                "  Write-Output (\"Installed Aura $version ($expectedPlatform) to $versionRoot\")",
                "  Write-Output (\"Open a new PowerShell window before running 'aura'.\")",
                "} finally {",
                "  if (Test-Path $temporaryRoot) { Remove-Item -LiteralPath $temporaryRoot -Recurse -Force -ErrorAction SilentlyContinue }",
                "}",
                "",
            ]
        ),
        encoding="utf-8",
    )
    return install_script


def build_distribution(
    *,
    root: Path,
    output_dir: Path,
    target_platform: str | None = None,
    skip_build: bool = False,
    install_production_deps: bool = True,
    source_revision: str | None = None,
    clean_output_dir: bool = False,
    windows_runtime_dir: Path | None = None,
    windows_launcher: Path | None = None,
) -> DaemonDistribution:
    root = root.resolve()
    daemon_dir = root / DAEMON_RELATIVE_DIR
    output_dir = output_dir.resolve()
    revision = resolve_source_revision(root, source_revision)
    if clean_output_dir:
        clean_artifact_output(root, daemon_dir, output_dir)
    package_json = read_package_json(daemon_dir)
    version = str(package_json["version"])
    platform_value = target_platform or default_platform()
    if platform_value.startswith(WINDOWS_PLATFORM_PREFIX) and platform_value not in {
        "win32-x64",
        "win32-arm64",
        "win32-x86",
    }:
        raise ValueError(
            "Windows target platform must be win32-x64, win32-arm64, or win32-x86 "
            f"(received {platform_value})"
        )

    if not skip_build:
        dist_dir = daemon_dir / "dist"
        if dist_dir.is_symlink():
            dist_dir.unlink()
        elif dist_dir.exists():
            shutil.rmtree(dist_dir)
        run_command(["npm", "ci", "--silent"], cwd=daemon_dir, timeout=180)
        run_command(["npm", "run", "build"], cwd=daemon_dir, timeout=120)

    npm_package = create_npm_package(daemon_dir, output_dir)

    with tempfile.TemporaryDirectory(prefix="smallkhoj-daemon-dist-") as tmp:
        staging_dir = Path(tmp) / "staging"
        staging_dir.mkdir(parents=True)
        copy_required_runtime_files(daemon_dir, staging_dir)
        if platform_value.startswith(WINDOWS_PLATFORM_PREFIX):
            copy_windows_runtime(
                staging_dir,
                runtime_dir=windows_runtime_dir,
                launcher_path=windows_launcher,
            )
        else:
            write_launcher(staging_dir)
        write_manifest(
            staging_dir,
            version=version,
            target_platform=platform_value,
            git_commit=revision,
        )
        if install_production_deps:
            run_command(["npm", "install", "--omit=dev", "--silent"], cwd=staging_dir, timeout=180)
        artifact = create_archive(
            staging_dir,
            output_dir,
            version=version,
            target_platform=platform_value,
        )

    digest = sha256_file(artifact)
    checksum = artifact.with_suffix(artifact.suffix + ".sha256")
    checksum.write_text(f"{digest}  {artifact.name}\n", encoding="utf-8")
    install_script = write_install_script(
        output_dir,
        artifact_name=artifact.name,
        root_name=artifact.stem if platform_value.startswith(WINDOWS_PLATFORM_PREFIX) else artifact.name.removesuffix(".tar.gz"),
        version=version,
        target_platform=platform_value,
        sha256=digest,
    )
    manifest = artifact.with_suffix(artifact.suffix + ".manifest.json")
    generated_files = (artifact, npm_package, checksum, install_script)
    manifest.write_text(
        json.dumps(
            {
                "name": ARTIFACT_PREFIX,
                "version": version,
                "platform": platform_value,
                "sourceRevision": revision,
                "artifact": str(artifact),
                "npmPackage": str(npm_package),
                "sha256": digest,
                "checksumFile": str(checksum),
                "installScript": str(install_script),
                "files": {
                    path.name: sha256_file(path)
                    for path in generated_files
                },
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
        source_revision=revision,
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
        "sourceRevision": result.source_revision,
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
    parser.add_argument(
        "--source-revision",
        help="40-character Git commit SHA recorded in the release manifest.",
    )
    parser.add_argument(
        "--clean-output-dir",
        action="store_true",
        help="Remove stale generated files from the output directory before packaging.",
    )
    parser.add_argument("--skip-build", action="store_true", help="Do not run npm install/npm run build before packaging.")
    parser.add_argument(
        "--skip-production-deps",
        action="store_true",
        help="Do not run npm install --omit=dev in the staged artifact.",
    )
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON.")
    parser.add_argument(
        "--windows-runtime-dir",
        type=Path,
        help="Windows-only directory containing a private node.exe and aura.exe launcher.",
    )
    parser.add_argument(
        "--windows-launcher",
        type=Path,
        help="Windows-only path to a prebuilt aura.exe launcher.",
    )
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
            source_revision=args.source_revision,
            clean_output_dir=args.clean_output_dir,
            windows_runtime_dir=args.windows_runtime_dir,
            windows_launcher=args.windows_launcher,
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
