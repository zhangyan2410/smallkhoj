#!/usr/bin/env python3
"""Build, archive, upload, and load production images for first-release hosts."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shlex
import subprocess
import sys
import tarfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.local_capacity_probe import stored_capacity_report_failures  # noqa: E402

DEFAULT_BACKEND_IMAGE = "smallkhoj-backend:local-release"
DEFAULT_FRONTEND_IMAGE = "smallkhoj-frontend:local-release"
DEFAULT_CADDY_IMAGE = "smallkhoj-caddy:local-release"
DEFAULT_OUTPUT_ARCHIVE = Path("/tmp/smallkhoj-production-images.tar")
DEFAULT_REMOTE_DIR = "/opt/smallkhoj-deploy"
DEFAULT_PROXY_URL = "http://host.docker.internal:7897"
SOURCE_REVISION_LABEL = "org.opencontainers.image.revision"
FORMAL_CAPACITY_PROFILE_ID = "formal-300-500-30-v1"
DAEMON_RELEASE_ARTIFACT_DIR = Path("release-artifacts/smallkhoj-daemon")
GIT_SHA_PATTERN = re.compile(r"[0-9a-f]{40}")
TASK_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{1,100}$")
IMAGE_ID_PATTERN = re.compile(r"sha256:[0-9a-f]{64}")
IMAGE_INSPECT_TEMPLATE = (
    '{"id":{{json .Id}},'
    '"repoTags":{{json .RepoTags}},'
    '"os":{{json .Os}},'
    '"architecture":{{json .Architecture}},'
    '"sourceRevision":'
    f'{{{{json (index .Config.Labels "{SOURCE_REVISION_LABEL}")}}}}'
    "}"
)


@dataclass(frozen=True)
class TransferOptions:
    host: str
    source_revision: str
    user: str | None = None
    port: int | None = None
    identity_file: Path | None = None
    remote_dir: str = DEFAULT_REMOTE_DIR
    output_archive: Path = DEFAULT_OUTPUT_ARCHIVE
    backend_image: str = DEFAULT_BACKEND_IMAGE
    frontend_image: str = DEFAULT_FRONTEND_IMAGE
    caddy_image: str = DEFAULT_CADDY_IMAGE
    skip_build: bool = False
    skip_daemon_build: bool = False
    platform: str | None = None
    use_vpn_proxy: bool = False
    proxy_url: str = DEFAULT_PROXY_URL
    next_public_api_base_url: str = ""
    next_public_ws_base_url: str = ""


@dataclass(frozen=True)
class PlanStep:
    label: str
    argv: list[str]
    remote: bool = False


@dataclass(frozen=True)
class CommandPlan:
    steps: list[PlanStep]


@dataclass(frozen=True)
class GitCandidate:
    head: str
    tree: str


@dataclass(frozen=True)
class CapacityEvidence:
    profile_id: str
    candidate_head: str
    candidate_tree: str
    report_path: Path
    report_sha256: str


@dataclass(frozen=True)
class ImageIdentity:
    image_id: str
    os: str
    architecture: str
    source_revision: str


def remote_target(options: TransferOptions) -> str:
    return f"{options.user}@{options.host}" if options.user else options.host


def ssh_base(options: TransferOptions) -> list[str]:
    argv = ["ssh"]
    if options.identity_file:
        argv.extend(["-i", str(options.identity_file)])
    if options.port:
        argv.extend(["-p", str(options.port)])
    argv.append(remote_target(options))
    return argv


def scp_base(options: TransferOptions) -> list[str]:
    argv = ["scp"]
    if options.identity_file:
        argv.extend(["-i", str(options.identity_file)])
    if options.port:
        argv.extend(["-P", str(options.port)])
    return argv


def shell_join(argv: list[str]) -> str:
    return " ".join(shlex.quote(item) for item in argv)


def normalize_git_sha(value: object, *, field: str) -> str:
    revision = value.strip().lower() if isinstance(value, str) else ""
    if GIT_SHA_PATTERN.fullmatch(revision) is None:
        raise ValueError(f"{field} must be a 40-character Git SHA")
    return revision


def run_capture(argv: list[str], *, cwd: Path | None = None) -> str:
    try:
        completed = subprocess.run(
            argv,
            cwd=cwd,
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ValueError(f"could not run required command: {argv[0]}") from exc
    if completed.returncode != 0:
        raise ValueError(f"required command failed: {argv[0]}")
    return completed.stdout


def validate_release_candidate(root: Path, source_revision: str) -> GitCandidate:
    root = root.resolve()
    expected_head = normalize_git_sha(source_revision, field="source revision")
    head = normalize_git_sha(
        run_capture(["git", "rev-parse", "--verify", "HEAD"], cwd=root),
        field="current HEAD",
    )
    tree = normalize_git_sha(
        run_capture(["git", "rev-parse", "--verify", "HEAD^{tree}"], cwd=root),
        field="current HEAD tree",
    )
    if expected_head != head:
        raise ValueError("source revision must equal the current HEAD")
    status = run_capture(
        ["git", "status", "--porcelain=v1", "--untracked-files=all"],
        cwd=root,
    )
    if status:
        raise ValueError(
            "production image worktree must be clean "
            "(no staged, unstaged, or untracked files)"
        )
    return GitCandidate(head=head, tree=tree)


def validate_capacity_report(
    report_path: Path,
    current_tree: str,
) -> CapacityEvidence:
    report_path = report_path.resolve()
    try:
        report_bytes = report_path.read_bytes()
        payload = json.loads(report_bytes)
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("capacity report is missing or invalid JSON") from exc
    if not isinstance(payload, dict):
        raise ValueError("capacity report must be a JSON object")

    recomputed_failures = stored_capacity_report_failures(payload)
    if recomputed_failures:
        raise ValueError(
            "capacity report evidence did not validate: "
            + ",".join(recomputed_failures)
        )

    acceptance = payload.get("acceptance")
    if (
        not isinstance(acceptance, dict)
        or acceptance.get("passed") is not True
        or acceptance.get("failures") != []
    ):
        raise ValueError("capacity report was not accepted")

    config = payload.get("config")
    profile_id = config.get("profileId") if isinstance(config, dict) else None
    if profile_id != FORMAL_CAPACITY_PROFILE_ID:
        raise ValueError(
            "capacity report must use formal-300-500-30-v1"
        )

    metadata = payload.get("metadata")
    if not isinstance(metadata, dict):
        raise ValueError("capacity report candidate metadata is missing")
    candidate = metadata.get("candidate")
    candidate_finished = metadata.get("candidateFinished")
    if not isinstance(candidate, dict) or not isinstance(candidate_finished, dict):
        raise ValueError("capacity report candidate metadata is missing")
    if candidate != candidate_finished:
        raise ValueError("capacity report candidate changed during the run")
    if candidate.get("dirty") is not False:
        raise ValueError("capacity report candidate must be clean")

    candidate_head = normalize_git_sha(
        candidate.get("head"),
        field="capacity candidate HEAD",
    )
    candidate_tree = normalize_git_sha(
        candidate.get("tree"),
        field="capacity candidate tree",
    )
    release_tree = normalize_git_sha(current_tree, field="current HEAD tree")
    if candidate_tree != release_tree:
        raise ValueError(
            "capacity candidate tree must equal the current HEAD tree"
        )
    return CapacityEvidence(
        profile_id=profile_id,
        candidate_head=candidate_head,
        candidate_tree=candidate_tree,
        report_path=report_path,
        report_sha256=hashlib.sha256(report_bytes).hexdigest(),
    )


def validate_task_scope(root: Path, task_id: str) -> str:
    """Validate an explicit task-scoped deploy without making a capacity claim."""
    normalized = task_id.strip()
    if TASK_ID_PATTERN.fullmatch(normalized) is None:
        raise ValueError("task-scoped deployment requires a safe Trellis task id")
    tasks_root = root / ".trellis" / "tasks"
    if not tasks_root.is_dir():
        raise ValueError(f"Trellis task metadata not found for task-scoped deployment: {normalized}")
    # Trellis task directories may carry a date prefix (for example
    # ``08-06-windows-computer-install-setup-connect``) while task.json.id is
    # the stable slug. Resolve by the recorded id instead of assuming the
    # filesystem directory name is the public task identifier.
    for task_path in tasks_root.rglob("task.json"):
        if not task_path.is_file():
            continue
        try:
            payload = json.loads(task_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise ValueError(f"task metadata is invalid for {normalized}") from exc
        if isinstance(payload, dict) and payload.get("id") == normalized:
            return normalized
    raise ValueError(f"Trellis task metadata not found for task-scoped deployment: {normalized}")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_daemon_release_artifacts(
    artifact_dir: Path,
    expected_revision: str,
) -> None:
    revision = normalize_git_sha(expected_revision, field="source revision")
    try:
        entries = list(artifact_dir.iterdir())
    except OSError as exc:
        raise ValueError("daemon release artifact directory is missing") from exc
    manifests = [
        path
        for path in entries
        if path.is_file() and path.name.endswith(".manifest.json")
    ]
    if len(manifests) != 1:
        raise ValueError("daemon release artifacts require exactly one manifest")
    try:
        manifest = json.loads(manifests[0].read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("daemon release artifact manifest is invalid") from exc
    if not isinstance(manifest, dict):
        raise ValueError("daemon release artifact manifest is invalid")
    manifest_revision = normalize_git_sha(
        manifest.get("sourceRevision"),
        field="daemon artifact source revision",
    )
    if manifest_revision != revision:
        raise ValueError("daemon artifact source revision does not match current HEAD")

    files = manifest.get("files")
    if not isinstance(files, dict) or not files:
        raise ValueError("daemon release artifact checksums are missing")
    expected_names: set[str] = set()
    for filename, expected_checksum in files.items():
        if (
            not isinstance(filename, str)
            or not filename
            or Path(filename).name != filename
            or filename.startswith(".")
        ):
            raise ValueError("daemon release artifact filename is invalid")
        checksum = (
            expected_checksum.strip().lower()
            if isinstance(expected_checksum, str)
            else ""
        )
        if re.fullmatch(r"[0-9a-f]{64}", checksum) is None:
            raise ValueError("daemon release artifact checksum is invalid")
        artifact = artifact_dir / filename
        if not artifact.is_file() or artifact.is_symlink():
            raise ValueError("daemon release artifact file is missing")
        if sha256_file(artifact) != checksum:
            raise ValueError("daemon release artifact checksum mismatch")
        expected_names.add(filename)

    npm_package_value = manifest.get("npmPackage")
    npm_package = (
        Path(npm_package_value).name
        if isinstance(npm_package_value, str)
        else ""
    )
    if not npm_package.endswith(".tgz") or npm_package not in expected_names:
        raise ValueError("daemon npm release artifact is missing")

    actual_names = {path.name for path in entries}
    if actual_names != expected_names | {manifests[0].name}:
        raise ValueError("daemon release artifact directory contains unverified files")


def image_tags(options: TransferOptions) -> tuple[str, str, str]:
    return (
        options.backend_image,
        options.frontend_image,
        options.caddy_image,
    )


def inspect_candidate_images(
    options: TransferOptions,
    expected_revision: str,
    *,
    expected_identities: dict[str, ImageIdentity] | None = None,
) -> dict[str, ImageIdentity]:
    revision = normalize_git_sha(expected_revision, field="source revision")
    identities: dict[str, ImageIdentity] = {}
    for tag in image_tags(options):
        output = run_capture(
            [
                "docker",
                "image",
                "inspect",
                "--format",
                IMAGE_INSPECT_TEMPLATE,
                tag,
            ]
        )
        try:
            payload = json.loads(output)
        except json.JSONDecodeError as exc:
            raise ValueError(f"image inspection failed for {tag}") from exc
        if not isinstance(payload, dict):
            raise ValueError(f"image inspection failed for {tag}")

        image_id = payload.get("id")
        if not isinstance(image_id, str) or IMAGE_ID_PATTERN.fullmatch(image_id) is None:
            raise ValueError(f"image identity is invalid for {tag}")
        repo_tags = payload.get("repoTags")
        if not isinstance(repo_tags, list) or tag not in repo_tags:
            raise ValueError(f"image tag identity is invalid for {tag}")
        os_name = payload.get("os")
        architecture = payload.get("architecture")
        if not isinstance(os_name, str) or not os_name:
            raise ValueError(f"image OS identity is invalid for {tag}")
        if not isinstance(architecture, str) or not architecture:
            raise ValueError(f"image architecture identity is invalid for {tag}")
        if options.platform:
            platform_parts = options.platform.lower().split("/")
            if len(platform_parts) < 2:
                raise ValueError("platform must include OS and architecture")
            if (os_name.lower(), architecture.lower()) != tuple(platform_parts[:2]):
                raise ValueError(f"image platform does not match target for {tag}")

        image_revision = payload.get("sourceRevision")
        if (
            not isinstance(image_revision, str)
            or image_revision.strip().lower() != revision
        ):
            raise ValueError(f"image revision label mismatch for {tag}")
        identities[tag] = ImageIdentity(
            image_id=image_id,
            os=os_name.lower(),
            architecture=architecture.lower(),
            source_revision=revision,
        )

    if len({identity.image_id for identity in identities.values()}) != len(identities):
        raise ValueError("backend, frontend, and Caddy must be distinct images")
    if expected_identities is not None and identities != expected_identities:
        raise ValueError("candidate image identities changed during archive creation")
    return identities


def validate_saved_image_archive(
    archive_path: Path,
    expected_identities: dict[str, ImageIdentity],
) -> None:
    try:
        with tarfile.open(archive_path, "r:*") as archive:
            member = archive.getmember("manifest.json")
            if member.size > 1024 * 1024:
                raise ValueError("saved image archive manifest is unexpectedly large")
            handle = archive.extractfile(member)
            if handle is None:
                raise ValueError("saved image archive manifest is missing")
            payload = json.loads(handle.read().decode("utf-8"))
    except (OSError, tarfile.TarError, KeyError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("saved image archive manifest is invalid") from exc
    if not isinstance(payload, list):
        raise ValueError("saved image archive manifest is invalid")

    archived: dict[str, str] = {}
    for entry in payload:
        if not isinstance(entry, dict):
            raise ValueError("saved image archive manifest is invalid")
        config = entry.get("Config")
        repo_tags = entry.get("RepoTags")
        if not isinstance(config, str) or not config.endswith(".json"):
            raise ValueError("saved image archive identity is invalid")
        image_id = f"sha256:{Path(config).name.removesuffix('.json')}"
        if IMAGE_ID_PATTERN.fullmatch(image_id) is None:
            raise ValueError("saved image archive identity is invalid")
        if not isinstance(repo_tags, list):
            raise ValueError("saved image archive tags are invalid")
        for tag in repo_tags:
            if tag in expected_identities:
                if tag in archived:
                    raise ValueError("saved image archive contains duplicate candidate tags")
                archived[tag] = image_id

    expected = {
        tag: identity.image_id
        for tag, identity in expected_identities.items()
    }
    if archived != expected:
        raise ValueError("saved archive image identities do not match inspected images")


def resolve_transfer_output(path: Path, root: Path) -> Path:
    return path.resolve() if path.is_absolute() else (root / path).resolve()


def default_release_evidence_path(archive_path: Path) -> Path:
    return archive_path.with_name(f"{archive_path.name}.release-evidence.json")


def build_release_evidence(
    *,
    tested: CapacityEvidence | None,
    tested_candidate: GitCandidate,
    merge: GitCandidate,
    identities: dict[str, ImageIdentity],
    archive_path: Path,
    archive_sha256: str,
    deployment_scope: dict[str, str],
) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "status": "transferred",
        "deploymentScope": deployment_scope,
        "testedCandidate": {
            "head": tested_candidate.head,
            "tree": tested_candidate.tree,
        },
        "mergeCandidate": {
            "head": merge.head,
            "tree": merge.tree,
        },
        "capacityReport": {
            "path": str(tested.report_path),
            "sha256": tested.report_sha256,
            "profileId": tested.profile_id,
        } if tested else None,
        "images": [
            {
                "tag": tag,
                "id": identity.image_id,
                "revisionLabel": identity.source_revision,
                "platform": f"{identity.os}/{identity.architecture}",
            }
            for tag, identity in sorted(identities.items())
        ],
        "archive": {
            "path": str(archive_path),
            "sha256": archive_sha256,
        },
    }


def persist_release_evidence(
    evidence_path: Path,
    payload: dict[str, Any],
) -> str:
    serialized = (
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    )
    temporary_path = evidence_path.with_name(f".{evidence_path.name}.tmp")
    try:
        evidence_path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path.write_text(serialized, encoding="utf-8")
        temporary_path.replace(evidence_path)
    except OSError as exc:
        try:
            temporary_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise ValueError("could not persist release evidence") from exc
    return sha256_file(evidence_path)


def build_proxy_args(options: TransferOptions) -> list[str]:
    if not options.use_vpn_proxy:
        return []
    args: list[str] = []
    for key in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
        args.extend(["--build-arg", f"{key}={options.proxy_url}"])
    return args


def build_platform_args(options: TransferOptions) -> list[str]:
    return ["--platform", options.platform] if options.platform else []


def source_revision_args(options: TransferOptions) -> list[str]:
    revision = normalize_git_sha(options.source_revision, field="source revision")
    return ["--label", f"{SOURCE_REVISION_LABEL}={revision}"]


def remote_shell(options: TransferOptions, command: str) -> list[str]:
    return [*ssh_base(options), command]


def build_steps(options: TransferOptions) -> list[PlanStep]:
    if options.skip_build:
        return []

    proxy_args = build_proxy_args(options)
    platform_args = build_platform_args(options)
    revision_args = source_revision_args(options)
    steps: list[PlanStep] = []
    if not options.skip_daemon_build:
        steps.append(PlanStep("build-daemon-release-artifacts", [
                sys.executable,
                "scripts/build_daemon_distribution.py",
                "--root",
                ".",
                "--output-dir",
                str(DAEMON_RELEASE_ARTIFACT_DIR),
                "--source-revision",
                options.source_revision.strip().lower(),
                "--clean-output-dir",
                "--json",
            ]))
    steps.extend([
        PlanStep("build-backend-image", [
            "docker",
            "build",
            *revision_args,
            *platform_args,
            *proxy_args,
            "-f",
            "backend/Dockerfile",
            "-t",
            options.backend_image,
            ".",
        ]),
        PlanStep("build-frontend-image", [
            "docker",
            "build",
            "--no-cache",
            *revision_args,
            *platform_args,
            *proxy_args,
            "--build-arg",
            f"NEXT_PUBLIC_API_BASE_URL={options.next_public_api_base_url}",
            "--build-arg",
            f"NEXT_PUBLIC_WS_BASE_URL={options.next_public_ws_base_url}",
            "--build-arg",
            "NEXT_PUBLIC_DEPLOYMENT_ENV=production",
            "--secret",
            "id=public_api_key,env=PUBLIC_API_KEY",
            "-t",
            options.frontend_image,
            "./frontend",
        ]),
        PlanStep("build-caddy-image", [
            "docker",
            "build",
            *revision_args,
            *platform_args,
            *proxy_args,
            "-t",
            options.caddy_image,
            "./deploy/caddy",
        ]),
    ])
    return steps


def build_plan(options: TransferOptions) -> CommandPlan:
    source_revision_args(options)
    remote_dir = options.remote_dir.rstrip("/")
    archive_name = options.output_archive.name
    remote_archive = f"{remote_dir}/{archive_name}"
    tags = list(image_tags(options))

    steps: list[PlanStep] = [
        *build_steps(options),
        PlanStep("save-image-archive", [
            "docker",
            "save",
            "-o",
            str(options.output_archive),
            *tags,
        ]),
        PlanStep("prepare-remote-dir", remote_shell(options, f"mkdir -p {shlex.quote(remote_dir)}"), remote=True),
        PlanStep("upload-image-archive", [
            *scp_base(options),
            str(options.output_archive),
            f"{remote_target(options)}:{remote_dir}/",
        ]),
        PlanStep("load-image-archive", remote_shell(
            options,
            f"docker load -i {shlex.quote(remote_archive)}",
        ), remote=True),
    ]
    return CommandPlan(steps=steps)


def plan_to_payload(plan: CommandPlan) -> dict[str, Any]:
    return {
        "steps": [
            {
                "label": step.label,
                "command": shell_join(step.argv),
                "argv": step.argv,
                "remote": step.remote,
            }
            for step in plan.steps
        ],
    }


def run_step(step: PlanStep, *, root: Path | None = None) -> int:
    print(f"[{step.label}] {shell_join(step.argv)}", flush=True)
    completed = subprocess.run(step.argv, cwd=root, check=False)
    return completed.returncode


def run_plan(plan: CommandPlan, *, root: Path | None = None) -> int:
    for step in plan.steps:
        return_code = run_step(step, root=root)
        if return_code != 0:
            return return_code
    return 0


def execute_transfer(
    options: TransferOptions,
    *,
    capacity_report: Path | None,
    root: Path,
    release_evidence: Path | None = None,
    task_id: str | None = None,
) -> int:
    root = root.resolve()
    candidate = validate_release_candidate(root, options.source_revision)
    if bool(capacity_report) == bool(task_id):
        raise ValueError(
            "choose exactly one deployment gate: --capacity-report or --task-scoped with --task-id"
        )
    capacity = (
        validate_capacity_report(capacity_report.resolve(), candidate.tree)
        if capacity_report
        else None
    )
    tested_candidate = (
        GitCandidate(capacity.candidate_head, capacity.candidate_tree)
        if capacity
        else candidate
    )
    deployment_scope = (
        {"type": "formal-capacity", "profileId": capacity.profile_id}
        if capacity
        else {"type": "task-scoped", "taskId": validate_task_scope(root, task_id or ""), "capacityClaim": "not-asserted"}
    )
    # The carrier image serves these exact artifacts. Validate externally
    # prepared Windows input before any Docker/SSH side effects; the normal
    # builder path is revalidated after it runs below.
    validate_daemon_release_artifacts(
        root / DAEMON_RELEASE_ARTIFACT_DIR,
        candidate.head,
    )
    plan = build_plan(options)
    identities: dict[str, ImageIdentity] | None = None
    archive_path = resolve_transfer_output(options.output_archive, root)
    evidence_path = resolve_transfer_output(
        release_evidence or default_release_evidence_path(options.output_archive),
        root,
    )
    if evidence_path == archive_path or (capacity and evidence_path == capacity.report_path):
        raise ValueError(
            "release evidence path must differ from the archive and capacity report"
        )
    archive_sha256: str | None = None

    for step in plan.steps:
        if step.label == "save-image-archive":
            candidate = validate_release_candidate(root, options.source_revision)
            if capacity_report:
                capacity = validate_capacity_report(capacity_report.resolve(), candidate.tree)
            validate_daemon_release_artifacts(
                root / DAEMON_RELEASE_ARTIFACT_DIR,
                candidate.head,
            )
            identities = inspect_candidate_images(options, candidate.head)

        return_code = run_step(step, root=root)
        if return_code != 0:
            return return_code

        if step.label == "build-daemon-release-artifacts":
            candidate = validate_release_candidate(root, options.source_revision)
            validate_daemon_release_artifacts(
                root / DAEMON_RELEASE_ARTIFACT_DIR,
                candidate.head,
            )
        elif step.label == "save-image-archive":
            if identities is None:
                raise ValueError("candidate image identities were not captured")
            validate_saved_image_archive(archive_path, identities)
            archive_sha256 = sha256_file(archive_path)
            inspect_candidate_images(
                options,
                candidate.head,
                expected_identities=identities,
            )
            candidate = validate_release_candidate(root, options.source_revision)
            if capacity_report:
                capacity = validate_capacity_report(capacity_report.resolve(), candidate.tree)

    if identities is None or archive_sha256 is None:
        raise ValueError("candidate image archive evidence was not captured")
    candidate = validate_release_candidate(root, options.source_revision)
    if capacity_report:
        capacity = validate_capacity_report(capacity_report.resolve(), candidate.tree)
    if sha256_file(archive_path) != archive_sha256:
        raise ValueError("saved image archive changed during transfer")

    evidence = build_release_evidence(
        tested=capacity,
        tested_candidate=tested_candidate,
        merge=candidate,
        identities=identities,
        archive_path=archive_path,
        archive_sha256=archive_sha256,
        deployment_scope=deployment_scope,
    )
    evidence_sha256 = persist_release_evidence(evidence_path, evidence)
    print(
        json.dumps(
            {
                "event": "production-image-transfer-release-evidence",
                "path": str(evidence_path),
                "sha256": evidence_sha256,
                "evidence": evidence,
            },
            ensure_ascii=False,
            sort_keys=True,
        ),
        flush=True,
    )

    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build, archive, upload, and docker-load SmallKhoj production images over SSH.")
    parser.add_argument("--host", help="SSH host or IP address.")
    parser.add_argument(
        "--source-revision",
        help="40-character Git commit SHA to write into each application image label. Defaults to the current HEAD.",
    )
    parser.add_argument("--user", help="SSH username. If omitted, SSH default user resolution is used.")
    parser.add_argument("--port", type=int, help="SSH port.")
    parser.add_argument("--identity-file", type=Path, help="SSH private key path.")
    parser.add_argument("--remote-dir", default=DEFAULT_REMOTE_DIR, help=f"Remote directory for the image archive. Default: {DEFAULT_REMOTE_DIR}")
    parser.add_argument("--output-archive", type=Path, default=DEFAULT_OUTPUT_ARCHIVE, help=f"Local docker save archive. Default: {DEFAULT_OUTPUT_ARCHIVE}")
    parser.add_argument("--backend-image", default=DEFAULT_BACKEND_IMAGE, help=f"Backend image tag. Default: {DEFAULT_BACKEND_IMAGE}")
    parser.add_argument("--frontend-image", default=DEFAULT_FRONTEND_IMAGE, help=f"Frontend image tag. Default: {DEFAULT_FRONTEND_IMAGE}")
    parser.add_argument("--caddy-image", default=DEFAULT_CADDY_IMAGE, help=f"Caddy image tag. Default: {DEFAULT_CADDY_IMAGE}")
    parser.add_argument("--skip-build", action="store_true", help="Skip daemon and Docker image builds; only save/upload/load existing local images.")
    parser.add_argument(
        "--skip-daemon-build",
        action="store_true",
        help="Reuse a prebuilt daemon artifact directory while still building the backend, frontend, and Caddy images.",
    )
    parser.add_argument("--platform", help="Docker build target platform, for example linux/amd64 or linux/arm64. Omit to use the local Docker default.")
    parser.add_argument("--use-vpn-proxy", action="store_true", help=f"Add Docker build proxy args for the local VPN proxy. Default proxy: {DEFAULT_PROXY_URL}")
    parser.add_argument("--proxy-url", default=DEFAULT_PROXY_URL, help=f"Docker build-container proxy URL. Default: {DEFAULT_PROXY_URL}")
    parser.add_argument("--next-public-api-base-url", default="", help="Frontend NEXT_PUBLIC_API_BASE_URL build arg. Default: empty same-origin mode.")
    parser.add_argument("--next-public-ws-base-url", default="", help="Frontend NEXT_PUBLIC_WS_BASE_URL build arg. Default: empty same-origin mode.")
    parser.add_argument(
        "--capacity-report",
        type=Path,
        help=(
            "Accepted formal capacity report whose candidate tree must equal "
            "the current HEAD tree. Required for a formal release transfer."
        ),
    )
    parser.add_argument(
        "--task-scoped",
        action="store_true",
        help=(
            "Allow a task-scoped transfer without a formal capacity claim. "
            "Requires --task-id and remains subject to clean-source/image/archive checks."
        ),
    )
    parser.add_argument(
        "--task-id",
        help="Trellis task id recorded in task-scoped release evidence.",
    )
    parser.add_argument(
        "--release-evidence",
        type=Path,
        help=(
            "Machine-readable release evidence output. Defaults to "
            "<output-archive>.release-evidence.json."
        ),
    )
    parser.add_argument(
        "--check-source-only",
        action="store_true",
        help="Validate that source revision equals a clean current HEAD, then exit.",
    )
    parser.add_argument("--dry-run", action="store_true", help="Print the command plan without executing it.")
    parser.add_argument("--json", action="store_true", help="Print the command plan as JSON. Implies dry-run.")
    return parser


def current_source_revision(root: Path | None = None) -> str:
    return normalize_git_sha(
        run_capture(["git", "rev-parse", "--verify", "HEAD"], cwd=root),
        field="current HEAD",
    )


def options_from_args(
    args: argparse.Namespace,
    *,
    source_revision: str | None = None,
) -> TransferOptions:
    if not args.host:
        raise ValueError("--host is required for an image transfer")
    return TransferOptions(
        host=args.host,
        source_revision=(
            source_revision
            or args.source_revision
            or current_source_revision()
        ),
        user=args.user,
        port=args.port,
        identity_file=args.identity_file,
        remote_dir=args.remote_dir,
        output_archive=args.output_archive,
        backend_image=args.backend_image,
        frontend_image=args.frontend_image,
        caddy_image=args.caddy_image,
        skip_build=args.skip_build,
        skip_daemon_build=args.skip_daemon_build,
        platform=args.platform,
        use_vpn_proxy=args.use_vpn_proxy,
        proxy_url=args.proxy_url,
        next_public_api_base_url=args.next_public_api_base_url,
        next_public_ws_base_url=args.next_public_ws_base_url,
    )


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    root = Path.cwd()
    try:
        revision = args.source_revision or current_source_revision(root)
        if args.check_source_only:
            validate_release_candidate(root, revision)
            return 0
        options = options_from_args(args, source_revision=revision)
        plan = build_plan(options)
    except ValueError as exc:
        print(f"release validation failed: {exc}", file=sys.stderr)
        return 2
    if args.json:
        print(json.dumps(plan_to_payload(plan), ensure_ascii=False, indent=2, sort_keys=True))
        return 0
    if args.dry_run:
        for step in plan.steps:
            print(f"[{step.label}] {shell_join(step.argv)}")
        return 0
    if args.task_scoped and not args.task_id:
        print(
            "release validation failed: --task-scoped requires --task-id",
            file=sys.stderr,
        )
        return 2
    if args.skip_build and args.skip_daemon_build:
        print(
            "release validation failed: --skip-build and --skip-daemon-build cannot be combined",
            file=sys.stderr,
        )
        return 2
    if args.task_id and not args.task_scoped:
        print(
            "release validation failed: --task-id requires --task-scoped",
            file=sys.stderr,
        )
        return 2
    if args.capacity_report is not None and args.task_scoped:
        print(
            "release validation failed: choose --capacity-report or --task-scoped, not both",
            file=sys.stderr,
        )
        return 2
    if args.capacity_report is None and not args.task_scoped:
        print(
            "release validation failed: use --capacity-report for a formal release or --task-scoped --task-id for a scoped deploy",
            file=sys.stderr,
        )
        return 2
    try:
        return execute_transfer(
            options,
            capacity_report=args.capacity_report,
            root=root,
            release_evidence=args.release_evidence,
            task_id=args.task_id if args.task_scoped else None,
        )
    except ValueError as exc:
        print(f"release validation failed: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
