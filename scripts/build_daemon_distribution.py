#!/usr/bin/env python3
"""Build a versioned SmallKhoj daemon distribution archive."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
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


def validate_standalone_dependencies(staging_dir: Path) -> None:
    """Fail closed when a standalone archive omitted a runtime dependency.

    ``--skip-production-deps`` remains useful for tiny builder unit fixtures,
    but it must never silently produce a launchable-looking Aura archive for
    the real daemon package.  Checking every declared production dependency
    catches the exact failure where the private Node starts and then crashes
    on the first import (for example, missing ``commander``).
    """

    package = read_package_json(staging_dir)
    dependencies = package.get("dependencies", {})
    if not isinstance(dependencies, dict) or not dependencies:
        return
    modules_root = staging_dir / "node_modules"
    missing = [
        name
        for name in dependencies
        if not (modules_root / name).is_dir()
    ]
    if missing:
        preview = ", ".join(sorted(missing)[:6])
        suffix = " …" if len(missing) > 6 else ""
        raise RuntimeError(
            "Standalone Aura release is missing production dependencies: "
            f"{preview}{suffix}. Build with production dependencies enabled."
        )


def write_launcher(staging_dir: Path, *, private_node: bool = False) -> None:
    """Write the Unix launchers used inside a versioned release.

    A managed release must not accidentally pick up the user's Node/npm
    installation.  When ``private_node`` is true the launcher resolves the
    sibling ``node`` runtime first and only uses ambient Node for the explicit
    development/compatibility build where no private runtime was staged.
    """

    node_lines = [
        'if [[ -x "$DIR/node" ]]; then',
        '  NODE="$DIR/node"',
        'else',
        '  NODE="${AURA_NODE_PATH:-}"',
        '  if [[ -z "$NODE" ]]; then NODE="$(command -v node || true)"; fi',
        '  if [[ -z "$NODE" ]]; then echo "Aura requires Node.js 20+ (bundled runtime is missing)." >&2; exit 127; fi',
        'fi',
        'exec "$NODE" "$DIR/dist/cmd/main.js" "$@"',
    ] if private_node else [
        'exec node "$DIR/dist/cmd/main.js" "$@"',
    ]
    launcher = staging_dir / "smallkhoj-daemon"
    launcher_text = "\n".join([
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        'DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
        'export AURA_RELEASE_ROOT="$DIR"',
        'if [[ -f "$DIR/node" ]]; then export AURA_STANDALONE=1; fi',
        *node_lines,
        "",
    ])
    launcher.write_text(launcher_text, encoding="utf-8")
    launcher.chmod(0o755)
    aura_launcher = staging_dir / "aura"
    aura_launcher.write_text(launcher_text, encoding="utf-8")
    aura_launcher.chmod(0o755)


def require_pe_executable(path: Path, label: str) -> None:
    """Fail closed when a Windows runtime input is not a native PE binary."""

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

    if runtime_dir is not None:
        runtime_dir = runtime_dir.resolve()
        node_runtime = runtime_dir / "node.exe"
        if not node_runtime.is_file():
            raise FileNotFoundError(f"Windows private Node runtime is missing: {node_runtime}")
        require_pe_executable(node_runtime, "private Node runtime")
        shutil.copy2(node_runtime, staging_dir / "node.exe")
        bundled_launcher = runtime_dir / "aura.exe"
        if bundled_launcher.is_file():
            require_pe_executable(bundled_launcher, "Aura launcher")
            shutil.copy2(bundled_launcher, staging_dir / "aura.exe")

    if launcher_path is not None:
        launcher_path = launcher_path.resolve()
        if not launcher_path.is_file():
            raise FileNotFoundError(f"Windows Aura launcher is missing: {launcher_path}")
        require_pe_executable(launcher_path, "Aura launcher")
        shutil.copy2(launcher_path, staging_dir / "aura.exe")

    if not (staging_dir / "aura.exe").is_file():
        raise FileNotFoundError(
            "Windows standalone packaging requires a valid aura.exe in the "
            "runtime directory or --windows-launcher"
        )
    require_pe_executable(staging_dir / "aura.exe", "Aura launcher")

    # The .cmd shim is intentionally retained for diagnostics and PATH probes;
    # the product command remains aura.exe once a real launcher is supplied.
    (staging_dir / "aura.cmd").write_text(
        "@echo off\r\nset \"AURA_STANDALONE=1\"\r\n\"%~dp0aura.exe\" %*\r\n",
        encoding="utf-8",
    )


def copy_private_node(staging_dir: Path, runtime_path: Path | None) -> bool:
    """Copy a platform-native Node runtime into a Unix release when supplied."""

    if runtime_path is None:
        return False
    source = runtime_path.expanduser().resolve()
    if not source.is_file():
        raise FileNotFoundError(f"Private Node runtime is missing: {source}")
    destination = staging_dir / "node"
    shutil.copy2(source, destination)
    destination.chmod(destination.stat().st_mode | 0o111)
    return True


def copy_codex_acp_binary(
    staging_dir: Path,
    binary_path: Path | None,
    *,
    target_platform: str,
) -> str | None:
    """Stage the release-owned Codex ACP binary and return its pinned version.

    The ACP package publishes a tiny JavaScript shim plus a large
    platform-specific binary.  The release builder accepts the already
    selected native binary so a macOS or Windows build cannot accidentally
    ship a host-incompatible executable.  The runtime discovers this absolute
    sibling path and never needs to invoke ``npx`` in a managed release.
    """

    if binary_path is None:
        return None
    source = binary_path.expanduser().resolve()
    if not source.is_file():
        raise FileNotFoundError(f"Codex ACP binary is missing: {source}")
    windows = target_platform.startswith(WINDOWS_PLATFORM_PREFIX)
    if windows:
        require_pe_executable(source, "Codex ACP sidecar")
    executable_name = "codex-acp.exe" if windows else "codex-acp"
    destination = staging_dir / "sidecars" / "codex-acp" / executable_name
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)
    destination.chmod(destination.stat().st_mode | 0o111)
    version = "0.16.0"
    (destination.parent / "manifest.json").write_text(
        json.dumps(
            {
                "name": "@zed-industries/codex-acp",
                "version": version,
                "entrypoint": executable_name,
                "sha256": sha256_file(destination),
            },
            indent=2,
            sort_keys=True,
        ) + "\n",
        encoding="utf-8",
    )
    return version


def write_manifest(
    staging_dir: Path,
    *,
    version: str,
    target_platform: str,
    git_commit: str | None,
    standalone: bool,
    minimum_daemon_version: str,
    codex_acp_version: str | None = None,
    codex_acp_entrypoint: str | None = None,
) -> None:
    payload = {
        "name": ARTIFACT_PREFIX,
        "version": version,
        "minimumDaemonVersion": minimum_daemon_version,
        "platform": target_platform,
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "gitCommit": git_commit,
        "entrypoint": "aura",
        "standalone": standalone,
        "requires": {
            "node": "bundled" if standalone else ">=20",
        },
        "runtimeInventory": {
            "privateNode": standalone,
            "codexAcp": {
                "available": bool(codex_acp_version),
                "version": codex_acp_version,
                "entrypoint": codex_acp_entrypoint if codex_acp_version else None,
            },
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
            # ``rglob`` already visits descendants.  Keep each addition
            # non-recursive; recursively adding every directory here repeats
            # the same files once per ancestor (and inflated the real Aura
            # archive by several hundred megabytes).
            tar.add(
                path,
                arcname=str(Path(root_name) / path.relative_to(staging_dir)),
                recursive=False,
            )
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
    minimum_daemon_version: str,
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
    # Keep this installer dependency-light (curl, tar, sed, and standard POSIX
    # shell tools only).  The release manifest is fetched before the large
    # archive, so a complete same-version installation performs no archive
    # request on subsequent runs.  The embedded values are a safe fallback for
    # older carriers that have not published the sidecar manifest yet.
    script = r'''#!/usr/bin/env bash
set -euo pipefail

EMBEDDED_VERSION="__VERSION__"
EMBEDDED_PLATFORM="__PLATFORM__"
EMBEDDED_ARTIFACT_NAME="__ARTIFACT_NAME__"
EMBEDDED_ARTIFACT_ROOT="__ARTIFACT_ROOT__"
EMBEDDED_ARTIFACT_SHA256="__SHA256__"
EMBEDDED_MINIMUM_VERSION="__MINIMUM_VERSION__"
BASE_URL="${SMALLKHOJ_DAEMON_DOWNLOAD_BASE_URL:-}"
REQUESTED_VERSION="${SMALLKHOJ_DAEMON_VERSION:-$EMBEDDED_VERSION}"
STATE_ROOT="${SMALLKHOJ_DAEMON_HOME:-${HOME}/.smallkhoj/daemon}"
VERSIONS_ROOT="${STATE_ROOT}/versions"
ACTIVE_PATH="${STATE_ROOT}/active.json"
FORCE="${SMALLKHOJ_DAEMON_FORCE:-0}"

fail() {
  echo "Aura install failed: $*" >&2
  exit 1
}

if [[ -z "$BASE_URL" ]]; then
  fail "SMALLKHOJ_DAEMON_DOWNLOAD_BASE_URL is required (for example https://server/downloads/smallkhoj-daemon)."
fi
[[ "$REQUESTED_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][A-Za-z0-9.-]+)?$ ]] || fail "Invalid Aura version: $REQUESTED_VERSION"

json_field() {
  local key="$1"
  local file="$2"
  # ``manifest.json`` also contains nested runtime versions; the top-level
  # release version is emitted last by the sorted builder payload.
  sed -nE "s/^[[:space:]]*\"${key}\"[[:space:]]*:[[:space:]]*\"([^\"]*)\"[,[:space:]]*$/\1/p" "$file" | tail -n 1
}

json_escape() {
  local value="$1"
  value=${value//\\/\\\\}
  value=${value//\"/\\\"}
  printf '%s' "$value"
}

version_key() {
  local value="${1#v}"
  value="${value%%-*}"
  local major minor patch
  IFS=. read -r major minor patch _ <<< "$value"
  major=${major:-0}; minor=${minor:-0}; patch=${patch:-0}
  major=$((10#$major)); minor=$((10#$minor)); patch=$((10#$patch))
  printf '%08d%08d%08d' "$major" "$minor" "$patch"
}

detect_platform() {
  local os machine arm_capable
  os="$(uname -s 2>/dev/null || true)"
  machine="$(uname -m 2>/dev/null || true)"
  case "$os" in
    Darwin)
      arm_capable="$(sysctl -in hw.optional.arm64 2>/dev/null || true)"
      if [[ "$machine" == "arm64" || "$arm_capable" == "1" ]]; then
        printf 'darwin-arm64'
      elif [[ "$machine" == "x86_64" || "$machine" == "amd64" ]]; then
        printf 'darwin-x64'
      else
        printf 'darwin-unknown'
      fi
      ;;
    Linux)
      case "$machine" in
        aarch64|arm64) printf 'linux-arm64' ;;
        x86_64|amd64) printf 'linux-x64' ;;
        *) printf 'linux-%s' "$machine" ;;
      esac
      ;;
    *)
      printf '%s-%s' "$(printf '%s' "$os" | tr '[:upper:]' '[:lower:]')" "$machine"
      ;;
  esac
}

TARGET_PLATFORM="$(detect_platform)"
case "$TARGET_PLATFORM" in
  darwin-arm64|darwin-x64|linux-arm64|linux-x64) ;;
  *) fail "Unsupported host platform/architecture: $TARGET_PLATFORM" ;;
esac

if [[ "$TARGET_PLATFORM" != "$EMBEDDED_PLATFORM" && -z "${SMALLKHOJ_DAEMON_VERSION:-}" ]]; then
  # A direct, unpinned invocation may select the matching platform release;
  # the product UI always supplies a version pin.
  :
fi

ARTIFACT_SUFFIX="tar.gz"
ARTIFACT_NAME="smallkhoj-daemon-v${REQUESTED_VERSION}-${TARGET_PLATFORM}.${ARTIFACT_SUFFIX}"
ARTIFACT_ROOT="smallkhoj-daemon-v${REQUESTED_VERSION}-${TARGET_PLATFORM}"
ARTIFACT_SHA256=""
MINIMUM_VERSION="${SMALLKHOJ_DAEMON_MINIMUM_VERSION:-$EMBEDDED_MINIMUM_VERSION}"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/aura-install.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

METADATA_PATH="${TMP_DIR}/artifact.manifest.json"
if curl -fsSL "${BASE_URL%/}/${ARTIFACT_NAME}.manifest.json" -o "$METADATA_PATH" 2>/dev/null; then
  metadata_version="$(json_field version "$METADATA_PATH")"
  metadata_platform="$(json_field platform "$METADATA_PATH")"
  metadata_sha="$(json_field sha256 "$METADATA_PATH")"
  if [[ "$metadata_version" != "$REQUESTED_VERSION" || "$metadata_platform" != "$TARGET_PLATFORM" || ! "$metadata_sha" =~ ^[0-9a-fA-F]{64}$ ]]; then
    fail "Release manifest does not match ${REQUESTED_VERSION}/${TARGET_PLATFORM}."
  fi
  ARTIFACT_SHA256="$(printf '%s' "$metadata_sha" | tr '[:upper:]' '[:lower:]')"
  metadata_minimum="$(json_field minimumDaemonVersion "$METADATA_PATH")"
  # Older carriers may publish a sidecar without the compatibility floor.
  # Preserve the embedded/env floor instead of silently disabling offline
  # reuse and minimum-version protection.
  if [[ -n "$metadata_minimum" ]]; then MINIMUM_VERSION="$metadata_minimum"; fi
else
  if [[ "$REQUESTED_VERSION" == "$EMBEDDED_VERSION" && "$TARGET_PLATFORM" == "$EMBEDDED_PLATFORM" ]]; then
    ARTIFACT_SHA256="$EMBEDDED_ARTIFACT_SHA256"
  else
    offline_version="$(json_field version "$ACTIVE_PATH" 2>/dev/null || true)"
    offline_path="$(json_field path "$ACTIVE_PATH" 2>/dev/null || true)"
    if [[ -n "$MINIMUM_VERSION" && -n "$offline_version" && "$(version_key "$offline_version")" -ge "$(version_key "$MINIMUM_VERSION")" && -x "$offline_path/aura" && -f "$offline_path/manifest.json" ]]; then
      echo "Aura ${offline_version} (${TARGET_PLATFORM}) offline-reused; release manifest was unavailable."
      exit 0
    fi
    fail "No release manifest is available for ${REQUESTED_VERSION}/${TARGET_PLATFORM}; pin a published version or retry when the carrier is online."
  fi
fi

VERSION_DIR="${VERSIONS_ROOT}/v${REQUESTED_VERSION}-${TARGET_PLATFORM}"

local_complete() {
  local directory="$1"
  local expected_version="${2:-$REQUESTED_VERSION}"
  local expected_platform="${3:-$TARGET_PLATFORM}"
  local expected_sha="${4:-$ARTIFACT_SHA256}"
  [[ -d "$directory" ]] || return 1
  [[ -x "$directory/aura" && -x "$directory/smallkhoj-daemon" ]] || return 1
  [[ -f "$directory/dist/cmd/main.js" && -f "$directory/manifest.json" && -f "$directory/install-state.json" ]] || return 1
  [[ "$(json_field version "$directory/manifest.json")" == "$expected_version" ]] || return 1
  [[ "$(json_field platform "$directory/manifest.json")" == "$expected_platform" ]] || return 1
  [[ -n "$expected_sha" && "$(json_field artifactSha256 "$directory/install-state.json")" == "$expected_sha" ]] || return 1
  if grep -Eq '"standalone"[[:space:]]*:[[:space:]]*true' "$directory/manifest.json"; then
    [[ -x "$directory/node" ]] || return 1
  fi
  return 0
}

active_version=""
active_path=""
if [[ -f "$ACTIVE_PATH" ]]; then
  active_version="$(json_field version "$ACTIVE_PATH")"
  active_path="$(json_field path "$ACTIVE_PATH")"
fi
if [[ -n "$active_version" && "$(version_key "$active_version")" -gt "$(version_key "$REQUESTED_VERSION")" && "$FORCE" != "1" ]]; then
  fail "A newer Aura version (${active_version}) is already active; refusing to downgrade to ${REQUESTED_VERSION}. Set SMALLKHOJ_DAEMON_FORCE=1 only for an explicit rollback."
fi

choose_bin_dir() {
  local candidate
  if [[ -n "${SMALLKHOJ_DAEMON_BIN_DIR:-}" ]]; then
    candidate="${SMALLKHOJ_DAEMON_BIN_DIR/#\~/$HOME}"
    mkdir -p "$candidate"
    printf '%s' "$candidate"
    return 0
  fi
  local path_entry
  IFS=: read -r -a path_entries <<< "${PATH:-}"
  for path_entry in "${path_entries[@]}"; do
    [[ -n "$path_entry" && -d "$path_entry" && -w "$path_entry" ]] || continue
    # Prefer the documented user directory when it is already discoverable.
    if [[ "$path_entry" == "$HOME/.local/bin" ]]; then printf '%s' "$path_entry"; return 0; fi
  done
  for path_entry in "${path_entries[@]}"; do
    [[ -n "$path_entry" && -d "$path_entry" && -w "$path_entry" ]] || continue
    printf '%s' "$path_entry"
    return 0
  done
  fail "No writable directory already present in PATH. Add a user bin directory to PATH once, then rerun the installer; Aura will not print a misleading export command."
}

BIN_DIR="$(choose_bin_dir)"
case ":${PATH:-}:" in
  *:"$BIN_DIR":*) ;;
  *) fail "Selected launcher directory is not discoverable in this shell: $BIN_DIR" ;;
esac

write_launcher() {
  local target="$1"
  local state_root_quoted
  printf -v state_root_quoted '%q' "$STATE_ROOT"
  local temporary="${target}.tmp-$$"
  cat > "$temporary" <<EOF
#!/usr/bin/env bash
set -euo pipefail
STATE_ROOT=${state_root_quoted}
ACTIVE_PATH="\$STATE_ROOT/active.json"
if [[ ! -f "\$ACTIVE_PATH" ]]; then echo "Aura is installed but no active version is selected; rerun the installer." >&2; exit 1; fi
VERSION_DIR="\$(sed -nE 's/^[[:space:]]*"path"[[:space:]]*:[[:space:]]*"([^\"]*)"[,[:space:]]*$/\\1/p' "\$ACTIVE_PATH" | head -n 1)"
if [[ -z "\$VERSION_DIR" || ! -x "\$VERSION_DIR/aura" ]]; then echo "Aura active version is missing or incomplete; run the installer again." >&2; exit 1; fi
export AURA_STANDALONE=1
export AURA_RELEASE_ROOT="\$VERSION_DIR"
exec "\$VERSION_DIR/aura" "\$@"
EOF
  chmod +x "$temporary"
  mv -f "$temporary" "$target"
}

activate() {
  local directory="$1"
  local temporary="${ACTIVE_PATH}.tmp-$$"
  mkdir -p "$STATE_ROOT"
  printf '{\n  "version": "%s",\n  "platform": "%s",\n  "path": "%s",\n  "artifactSha256": "%s"\n}\n' \
    "$(json_escape "$REQUESTED_VERSION")" "$(json_escape "$TARGET_PLATFORM")" \
    "$(json_escape "$directory")" "$(json_escape "$ARTIFACT_SHA256")" > "$temporary"
  mv -f "$temporary" "$ACTIVE_PATH"
}

mkdir -p "$VERSIONS_ROOT"
if local_complete "$VERSION_DIR"; then
  activate "$VERSION_DIR"
  write_launcher "$BIN_DIR/aura"
  write_launcher "$BIN_DIR/smallkhoj-daemon"
  if [[ "$BIN_DIR" != "$HOME/.smallkhoj/bin" && -d "$HOME/.smallkhoj/bin" && -w "$HOME/.smallkhoj/bin" ]]; then
    write_launcher "$HOME/.smallkhoj/bin/aura"
    write_launcher "$HOME/.smallkhoj/bin/smallkhoj-daemon"
  fi
  echo "Aura ${REQUESTED_VERSION} (${TARGET_PLATFORM}) already-installed; archive download skipped."
  echo "Aura is ready: ${BIN_DIR}/aura"
  exit 0
fi

ARCHIVE_PATH="${TMP_DIR}/${ARTIFACT_NAME}"
if ! curl -fsSL "${BASE_URL%/}/${ARTIFACT_NAME}" -o "$ARCHIVE_PATH"; then
  if [[ -n "$active_path" && -n "$active_version" && -n "$MINIMUM_VERSION" && "$(version_key "$active_version")" -ge "$(version_key "$MINIMUM_VERSION")" ]]; then
    active_sha="$(json_field artifactSha256 "$active_path/install-state.json" 2>/dev/null || true)"
    if local_complete "$active_path" "$active_version" "$TARGET_PLATFORM" "$active_sha"; then
      echo "Aura ${active_version} (${TARGET_PLATFORM}) offline-reused; release archive was unavailable."
      exit 0
    fi
  fi
  fail "Unable to download ${ARTIFACT_NAME}; no complete compatible local version is available."
fi

actual_sha="$(shasum -a 256 "$ARCHIVE_PATH" 2>/dev/null | awk '{print $1}' || true)"
if [[ -z "$actual_sha" ]]; then actual_sha="$(sha256sum "$ARCHIVE_PATH" 2>/dev/null | awk '{print $1}' || true)"; fi
[[ "$actual_sha" == "$ARTIFACT_SHA256" ]] || fail "SHA-256 verification failed for ${ARTIFACT_NAME}."

tar -xzf "$ARCHIVE_PATH" -C "$TMP_DIR"
SOURCE_DIR="${TMP_DIR}/${ARTIFACT_ROOT}"
[[ -d "$SOURCE_DIR" ]] || fail "The archive does not contain ${ARTIFACT_ROOT}."
[[ -x "$SOURCE_DIR/aura" && -x "$SOURCE_DIR/smallkhoj-daemon" ]] || fail "The archive is missing executable Aura launchers."
[[ -f "$SOURCE_DIR/dist/cmd/main.js" && -f "$SOURCE_DIR/manifest.json" ]] || fail "The archive is incomplete (dist/manifest missing)."
[[ "$(json_field version "$SOURCE_DIR/manifest.json")" == "$REQUESTED_VERSION" ]] || fail "Archive manifest version mismatch."
[[ "$(json_field platform "$SOURCE_DIR/manifest.json")" == "$TARGET_PLATFORM" ]] || fail "Archive manifest platform mismatch."
if grep -Eq '"standalone"[[:space:]]*:[[:space:]]*true' "$SOURCE_DIR/manifest.json" && [[ ! -x "$SOURCE_DIR/node" ]]; then
  fail "Standalone archive is missing its private Node runtime."
fi

STAGING_DIR="$(mktemp -d "${VERSIONS_ROOT}/.staging.XXXXXX")"
cp -R "${SOURCE_DIR}/." "$STAGING_DIR/"
printf '{\n  "version": "%s",\n  "platform": "%s",\n  "artifactSha256": "%s"\n}\n' \
  "$(json_escape "$REQUESTED_VERSION")" "$(json_escape "$TARGET_PLATFORM")" "$(json_escape "$ARTIFACT_SHA256")" > "$STAGING_DIR/install-state.json"
chmod +x "$STAGING_DIR/aura" "$STAGING_DIR/smallkhoj-daemon" "$STAGING_DIR/node" 2>/dev/null || true

BACKUP_DIR=""
if [[ -e "$VERSION_DIR" ]]; then
  BACKUP_DIR="${VERSION_DIR}.previous-$$"
  mv "$VERSION_DIR" "$BACKUP_DIR"
fi
if ! mv "$STAGING_DIR" "$VERSION_DIR"; then
  [[ -n "$BACKUP_DIR" && -e "$BACKUP_DIR" ]] && mv "$BACKUP_DIR" "$VERSION_DIR"
  fail "Could not promote the verified Aura version; the previous installation was kept."
fi

# The launcher only reads active.json at invocation time, so install it before
# switching the pointer.  A failure here leaves the old pointer and version
# untouched; this closes the small window where a new pointer could outlive a
# failed launcher write.
if ! write_launcher "$BIN_DIR/aura" || ! write_launcher "$BIN_DIR/smallkhoj-daemon"; then
  rm -rf "$VERSION_DIR"
  [[ -n "$BACKUP_DIR" && -e "$BACKUP_DIR" ]] && mv "$BACKUP_DIR" "$VERSION_DIR"
  fail "Could not install the stable Aura launcher; the previous installation was kept."
fi
if [[ "$BIN_DIR" != "$HOME/.smallkhoj/bin" ]]; then
  if [[ -d "$HOME/.smallkhoj/bin" || -w "$HOME/.smallkhoj" ]]; then
    mkdir -p "$HOME/.smallkhoj/bin" 2>/dev/null || true
    if [[ -d "$HOME/.smallkhoj/bin" && -w "$HOME/.smallkhoj/bin" ]]; then
      write_launcher "$HOME/.smallkhoj/bin/aura" || true
      write_launcher "$HOME/.smallkhoj/bin/smallkhoj-daemon" || true
    fi
  fi
fi
if ! activate "$VERSION_DIR"; then
  rm -rf "$VERSION_DIR"
  [[ -n "$BACKUP_DIR" && -e "$BACKUP_DIR" ]] && mv "$BACKUP_DIR" "$VERSION_DIR"
  fail "Could not switch the active Aura pointer; the previous installation was kept."
fi
[[ -z "$BACKUP_DIR" ]] || rm -rf "$BACKUP_DIR"

echo "Installed Aura ${REQUESTED_VERSION} (${TARGET_PLATFORM}) to ${VERSION_DIR}"
echo "Aura is ready in this shell: ${BIN_DIR}/aura"
'''
    replacements = {
        "__VERSION__": version,
        "__PLATFORM__": target_platform,
        "__ARTIFACT_NAME__": artifact_name,
        "__ARTIFACT_ROOT__": root_name,
        "__SHA256__": sha256,
        "__MINIMUM_VERSION__": minimum_daemon_version,
    }
    for key, value in replacements.items():
        script = script.replace(key, value)
    install_script.write_text(script, encoding="utf-8")
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
                "  # irm | iex runs in the caller's PowerShell session; update its PATH too so",
                "  # the very next `aura` command works without opening another window.",
                "  $env:Path = $binRoot + ';' + [string]$env:Path",
                "  $activePath = Join-Path $installRoot 'active.json'",
                "  $activeTemp = $activePath + '.tmp-' + [Guid]::NewGuid().ToString('N')",
                "  @{ version = $version; platform = $expectedPlatform; path = $versionRoot } | ConvertTo-Json | Set-Content -LiteralPath $activeTemp -Encoding UTF8",
                "  Move-Item -LiteralPath $activeTemp -Destination $activePath -Force",
                "  Write-Output (\"Installed Aura $version ($expectedPlatform) to $versionRoot\")",
                "  Write-Output (\"Aura is ready in this PowerShell: \" + (Join-Path $binRoot 'aura.cmd'))",
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
    node_runtime: Path | None = None,
    codex_acp_binary: Path | None = None,
    minimum_daemon_version: str | None = None,
) -> DaemonDistribution:
    root = root.resolve()
    daemon_dir = root / DAEMON_RELATIVE_DIR
    output_dir = output_dir.resolve()
    revision = resolve_source_revision(root, source_revision)
    if clean_output_dir:
        clean_artifact_output(root, daemon_dir, output_dir)
    package_json = read_package_json(daemon_dir)
    version = str(package_json["version"])
    compatibility_floor = (
        minimum_daemon_version
        or os.environ.get("MINIMUM_DAEMON_VERSION")
        or os.environ.get("SMALLKHOJ_DAEMON_MINIMUM_VERSION")
        or version
    ).strip()
    if not re.fullmatch(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:[-+][A-Za-z0-9.-]+)?", compatibility_floor):
        raise ValueError("minimum daemon version must be a stable semantic version")
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
        private_node = False
        codex_acp_version: str | None = None
        if platform_value.startswith(WINDOWS_PLATFORM_PREFIX):
            copy_windows_runtime(
                staging_dir,
                runtime_dir=windows_runtime_dir,
                launcher_path=windows_launcher,
            )
        else:
            private_node = copy_private_node(staging_dir, node_runtime)
            write_launcher(staging_dir, private_node=private_node)
        codex_acp_version = copy_codex_acp_binary(
            staging_dir,
            codex_acp_binary,
            target_platform=platform_value,
        )
        codex_acp_entrypoint = (
            "sidecars/codex-acp/codex-acp.exe"
            if platform_value.startswith(WINDOWS_PLATFORM_PREFIX)
            else "sidecars/codex-acp/codex-acp"
        ) if codex_acp_version else None
        write_manifest(
            staging_dir,
            version=version,
            target_platform=platform_value,
            git_commit=revision,
            standalone=platform_value.startswith(WINDOWS_PLATFORM_PREFIX) or private_node,
            minimum_daemon_version=compatibility_floor,
            codex_acp_version=codex_acp_version,
            codex_acp_entrypoint=codex_acp_entrypoint,
        )
        if install_production_deps:
            run_command(["npm", "install", "--omit=dev", "--silent"], cwd=staging_dir, timeout=180)
        if platform_value.startswith(WINDOWS_PLATFORM_PREFIX) or private_node:
            validate_standalone_dependencies(staging_dir)
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
        minimum_daemon_version=compatibility_floor,
    )
    manifest = artifact.with_suffix(artifact.suffix + ".manifest.json")
    generated_files = (artifact, npm_package, checksum, install_script)
    manifest.write_text(
        json.dumps(
            {
                "name": ARTIFACT_PREFIX,
                "version": version,
                "minimumDaemonVersion": compatibility_floor,
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
    parser.add_argument(
        "--node-runtime",
        type=Path,
        help="Unix-only path to a platform-native private Node runtime to bundle in Aura.",
    )
    parser.add_argument(
        "--codex-acp-binary",
        type=Path,
        help="Path to the platform-native codex-acp binary (v0.16.0) to ship as an optional sidecar.",
    )
    parser.add_argument(
        "--minimum-daemon-version",
        help="Compatibility floor embedded in the release manifest (defaults to MINIMUM_DAEMON_VERSION or this release version).",
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
            node_runtime=args.node_runtime,
            codex_acp_binary=args.codex_acp_binary,
            minimum_daemon_version=args.minimum_daemon_version,
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
