import io
import json
import os
import re
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts import production_image_transfer as transfer

SOURCE_REVISION = "0123456789abcdef0123456789abcdef01234567"
SOURCE_TREE = "89abcdef0123456789abcdef0123456789abcdef"


def init_git_repo(root: Path) -> tuple[str, str]:
    subprocess.run(["git", "init", "-q"], cwd=root, check=True)
    subprocess.run(
        ["git", "config", "user.email", "audit@example.invalid"],
        cwd=root,
        check=True,
    )
    subprocess.run(
        ["git", "config", "user.name", "Audit Test"],
        cwd=root,
        check=True,
    )
    (root / ".gitignore").write_text("release-artifacts/\n", encoding="utf-8")
    (root / "tracked.txt").write_text("candidate\n", encoding="utf-8")
    subprocess.run(["git", "add", ".gitignore", "tracked.txt"], cwd=root, check=True)
    subprocess.run(
        ["git", "commit", "-q", "-m", "candidate"],
        cwd=root,
        check=True,
    )
    head = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    tree = subprocess.run(
        ["git", "rev-parse", "HEAD^{tree}"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    return head, tree


def write_capacity_report(
    path: Path,
    *,
    head: str = SOURCE_REVISION,
    tree: str = SOURCE_TREE,
) -> None:
    candidate = {
        "head": head,
        "tree": tree,
        "branch": "feat/audit",
        "dirty": False,
        "workingDiffSha256": (
            "e3b0c44298fc1c149afbf4c8996fb924"
            "27ae41e4649b934ca495991b7852b855"
        ),
    }
    path.write_text(
        json.dumps(
            {
                "metadata": {
                    "candidate": candidate,
                    "candidateFinished": {**candidate},
                },
                "config": {"profileId": "formal-300-500-30-v1"},
                "acceptance": {"passed": True, "failures": []},
            }
        ),
        encoding="utf-8",
    )


def write_task_metadata(root: Path, task_id: str) -> None:
    task_dir = root / ".trellis" / "tasks" / task_id
    task_dir.mkdir(parents=True, exist_ok=True)
    (task_dir / "task.json").write_text(
        json.dumps({"id": task_id, "status": "in_progress"}),
        encoding="utf-8",
    )


def write_daemon_artifacts(root: Path, revision: str) -> None:
    artifact_dir = root / "release-artifacts" / "smallkhoj-daemon"
    artifact_dir.mkdir(parents=True, exist_ok=True)
    package = artifact_dir / "smallkhoj-smallkhoj-daemon-0.2.6.tgz"
    package.write_bytes(b"candidate daemon package")
    manifest = artifact_dir / "smallkhoj-daemon-v0.2.6-linux-x64.tar.gz.manifest.json"
    manifest.write_text(
        json.dumps(
            {
                "sourceRevision": revision,
                "version": "0.2.6",
                "platform": "linux-x64",
                "npmPackage": package.name,
                "files": {package.name: transfer.sha256_file(package)},
            }
        ),
        encoding="utf-8",
    )


def image_inspect_payload(tag: str, revision: str = SOURCE_REVISION) -> dict[str, object]:
    service = tag.split(":", 1)[0].rsplit("-", 1)[-1]
    return {
        "id": f"sha256:{service.encode().hex():0<64}",
        "repoTags": [tag],
        "os": "linux",
        "architecture": "amd64",
        "sourceRevision": revision,
    }


class ProductionImageTransferTests(unittest.TestCase):
    def test_direct_cli_help_can_import_the_capacity_validator(self) -> None:
        root = Path(__file__).resolve().parents[2]

        completed = subprocess.run(
            [
                sys.executable,
                str(root / "scripts" / "production_image_transfer.py"),
                "--help",
            ],
            cwd=root,
            check=False,
            capture_output=True,
            text=True,
            timeout=10,
        )

        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn("--capacity-report", completed.stdout)
        self.assertIn("--task-scoped", completed.stdout)
        self.assertIn("--task-id", completed.stdout)
        self.assertIn("--release-evidence", completed.stdout)

    def test_default_plan_builds_saves_uploads_and_loads_images(self) -> None:
        options = transfer.TransferOptions(
            host="203.0.113.10",
            source_revision=SOURCE_REVISION,
            user="ubuntu",
            remote_dir="/opt/smallkhoj",
            output_archive=Path("/tmp/smallkhoj-images.tar"),
        )

        plan = transfer.build_plan(options)
        labels = [step.label for step in plan.steps]

        self.assertEqual(labels, [
            "build-daemon-release-artifacts-darwin-arm64",
            "build-daemon-release-artifacts-win32-x64",
            "build-backend-image",
            "build-frontend-image",
            "build-caddy-image",
            "save-image-archive",
            "prepare-remote-dir",
            "upload-image-archive",
            "load-image-archive",
        ])
        self.assertEqual(plan.steps[2].argv, [
            "docker",
            "build",
            "--label",
            f"org.opencontainers.image.revision={SOURCE_REVISION}",
            "-f",
            "backend/Dockerfile",
            "-t",
            "smallkhoj-backend:local-release",
            ".",
        ])
        daemon_step = plan.steps[0]
        self.assertIn("scripts/build_daemon_distribution.py", daemon_step.argv)
        self.assertIn("--clean-output-dir", daemon_step.argv)
        self.assertIn("--source-revision", daemon_step.argv)
        self.assertIn(SOURCE_REVISION, daemon_step.argv)
        windows_step = plan.steps[1]
        self.assertIn("scripts/build_daemon_distribution.py", windows_step.argv)
        windows_args = windows_step.argv
        self.assertEqual(
            windows_args[windows_args.index("--platform") + 1],
            "win32-x64",
        )
        self.assertEqual(
            windows_args[windows_args.index("--windows-runtime-dir") + 1],
            "aura-build-runtime",
        )
        self.assertIn("--reuse-npm-package", windows_args)
        self.assertNotIn("--clean-output-dir", windows_args)
        self.assertIn("smallkhoj-backend:local-release", plan.steps[5].argv)
        self.assertIn("smallkhoj-frontend:local-release", plan.steps[5].argv)
        self.assertIn("smallkhoj-caddy:local-release", plan.steps[5].argv)
        self.assertEqual(plan.steps[7].argv[:3], ["scp", "/tmp/smallkhoj-images.tar", "ubuntu@203.0.113.10:/opt/smallkhoj/"])
        self.assertIn("docker load -i /opt/smallkhoj/smallkhoj-images.tar", plan.steps[8].argv[-1])

    def test_skip_build_keeps_archive_upload_and_load_steps(self) -> None:
        options = transfer.TransferOptions(
            host="203.0.113.10",
            source_revision=SOURCE_REVISION,
            user="ubuntu",
            remote_dir="/opt/smallkhoj",
            output_archive=Path("/tmp/smallkhoj-images.tar"),
            skip_build=True,
        )

        plan = transfer.build_plan(options)
        labels = [step.label for step in plan.steps]

        self.assertEqual(labels, [
            "save-image-archive",
            "prepare-remote-dir",
            "upload-image-archive",
            "load-image-archive",
        ])

    def test_skip_daemon_build_keeps_docker_builds_and_reuses_artifacts(self) -> None:
        options = transfer.TransferOptions(
            host="203.0.113.10",
            source_revision=SOURCE_REVISION,
            output_archive=Path("/tmp/smallkhoj-images.tar"),
            skip_daemon_build=True,
        )

        labels = [step.label for step in transfer.build_plan(options).steps]

        self.assertFalse(
            any(label.startswith("build-daemon-release-artifacts") for label in labels)
        )
        self.assertIn("build-backend-image", labels)
        self.assertIn("build-frontend-image", labels)
        self.assertIn("build-caddy-image", labels)

    def test_vpn_proxy_adds_docker_build_proxy_args(self) -> None:
        options = transfer.TransferOptions(
            host="203.0.113.10",
            source_revision=SOURCE_REVISION,
            user="ubuntu",
            remote_dir="/opt/smallkhoj",
            output_archive=Path("/tmp/smallkhoj-images.tar"),
            use_vpn_proxy=True,
        )

        plan = transfer.build_plan(options)
        build_commands = "\n".join(" ".join(step.argv) for step in plan.steps if step.label.startswith("build-"))

        for key in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
            self.assertIn(f"{key}=http://host.docker.internal:7897", build_commands)
        self.assertIn("NEXT_PUBLIC_API_BASE_URL=", build_commands)
        self.assertIn("NEXT_PUBLIC_WS_BASE_URL=", build_commands)

    def test_frontend_production_key_uses_buildkit_secret_without_value_in_plan(self) -> None:
        options = transfer.TransferOptions(
            host="203.0.113.10",
            source_revision=SOURCE_REVISION,
            user="ubuntu",
            remote_dir="/opt/smallkhoj",
            output_archive=Path("/tmp/smallkhoj-images.tar"),
        )

        frontend = next(
            step for step in transfer.build_plan(options).steps
            if step.label == "build-frontend-image"
        )
        command = " ".join(frontend.argv)

        self.assertIn("--no-cache", frontend.argv)
        self.assertIn("--secret id=public_api_key,env=PUBLIC_API_KEY", command)
        self.assertIn("NEXT_PUBLIC_DEPLOYMENT_ENV=production", command)
        self.assertNotIn("sk_public_local", command)
        self.assertNotIn("NEXT_PUBLIC_API_KEY=", command)

    def test_platform_is_added_to_all_docker_builds_when_selected(self) -> None:
        options = transfer.TransferOptions(
            host="203.0.113.10",
            source_revision=SOURCE_REVISION,
            user="ubuntu",
            remote_dir="/opt/smallkhoj",
            output_archive=Path("/tmp/smallkhoj-images.tar"),
            platform="linux/amd64",
        )

        plan = transfer.build_plan(options)
        build_steps = [
            step
            for step in plan.steps
            if step.label in {
                "build-backend-image",
                "build-frontend-image",
                "build-caddy-image",
            }
        ]

        self.assertEqual(len(build_steps), 3)
        for step in build_steps:
            self.assertIn("--platform", step.argv)
            self.assertIn("linux/amd64", step.argv)
            self.assertIn("--label", step.argv)
            self.assertIn(
                f"org.opencontainers.image.revision={SOURCE_REVISION}",
                step.argv,
            )

    def test_plan_accepts_ssh_port_and_identity(self) -> None:
        options = transfer.TransferOptions(
            host="203.0.113.10",
            source_revision=SOURCE_REVISION,
            user="ubuntu",
            port=2222,
            identity_file=Path("/tmp/key.pem"),
            remote_dir="/opt/smallkhoj",
            output_archive=Path("/tmp/smallkhoj-images.tar"),
            skip_build=True,
        )

        plan = transfer.build_plan(options)

        ssh_step = next(step for step in plan.steps if step.label == "prepare-remote-dir")
        scp_step = next(step for step in plan.steps if step.label == "upload-image-archive")
        self.assertEqual(ssh_step.argv[:5], ["ssh", "-i", "/tmp/key.pem", "-p", "2222"])
        self.assertEqual(scp_step.argv[:6], ["scp", "-i", "/tmp/key.pem", "-P", "2222", "/tmp/smallkhoj-images.tar"])

    def test_plan_payload_does_not_print_env_or_secret_names(self) -> None:
        options = transfer.TransferOptions(
            host="203.0.113.10",
            source_revision=SOURCE_REVISION,
            user="ubuntu",
            remote_dir="/opt/smallkhoj",
            output_archive=Path("/tmp/smallkhoj-images.tar"),
            use_vpn_proxy=True,
        )

        payload_text = json.dumps(transfer.plan_to_payload(transfer.build_plan(options)), sort_keys=True)

        for forbidden in (
            ".env.prod",
            "POSTGRES_PASSWORD",
            "JIRA_API_TOKEN",
            "FEISHU_WORKER_APP_SECRET",
            "OPENAI_API_KEY",
        ):
            self.assertNotIn(forbidden, payload_text)

    def test_build_rejects_an_invalid_source_revision(self) -> None:
        options = transfer.TransferOptions(
            host="203.0.113.10",
            source_revision="unknown",
        )

        with self.assertRaises(ValueError):
            transfer.build_plan(options)

    def test_release_candidate_requires_exact_clean_head(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            head, tree = init_git_repo(root)

            candidate = transfer.validate_release_candidate(root, head)

            self.assertEqual(candidate.head, head)
            self.assertEqual(candidate.tree, tree)
            with self.assertRaisesRegex(ValueError, "current HEAD"):
                transfer.validate_release_candidate(root, "f" * 40)

    def test_release_candidate_rejects_staged_unstaged_and_untracked_changes(self) -> None:
        mutations = ("staged", "unstaged", "untracked")
        for mutation in mutations:
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                head, _ = init_git_repo(root)
                if mutation == "untracked":
                    (root / "untracked.txt").write_text("unsafe\n", encoding="utf-8")
                else:
                    (root / "tracked.txt").write_text("unsafe\n", encoding="utf-8")
                    if mutation == "staged":
                        subprocess.run(
                            ["git", "add", "tracked.txt"],
                            cwd=root,
                            check=True,
                        )

                with self.assertRaisesRegex(ValueError, "worktree must be clean"):
                    transfer.validate_release_candidate(root, head)

    def test_capacity_report_accepts_formal_candidate_with_same_current_tree(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            report_path = Path(tmp) / "capacity.json"
            write_capacity_report(report_path)

            with mock.patch.object(
                transfer,
                "stored_capacity_report_failures",
                return_value=[],
            ):
                evidence = transfer.validate_capacity_report(report_path, SOURCE_TREE)

            self.assertEqual(evidence.candidate_tree, SOURCE_TREE)
            self.assertEqual(evidence.profile_id, "formal-300-500-30-v1")

    def test_capacity_report_rejects_tree_or_candidate_finish_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            report_path = Path(tmp) / "capacity.json"
            write_capacity_report(report_path)

            with mock.patch.object(
                transfer,
                "stored_capacity_report_failures",
                return_value=[],
            ):
                with self.assertRaisesRegex(ValueError, "current HEAD tree"):
                    transfer.validate_capacity_report(report_path, "f" * 40)

            payload = json.loads(report_path.read_text(encoding="utf-8"))
            payload["metadata"]["candidateFinished"]["tree"] = "e" * 40
            report_path.write_text(json.dumps(payload), encoding="utf-8")
            with mock.patch.object(
                transfer,
                "stored_capacity_report_failures",
                return_value=[],
            ):
                with self.assertRaisesRegex(ValueError, "changed during the run"):
                    transfer.validate_capacity_report(report_path, SOURCE_TREE)

    def test_capacity_report_rejects_non_formal_or_failed_acceptance(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            report_path = Path(tmp) / "capacity.json"
            write_capacity_report(report_path)
            payload = json.loads(report_path.read_text(encoding="utf-8"))

            payload["config"]["profileId"] = "smoke"
            report_path.write_text(json.dumps(payload), encoding="utf-8")
            with mock.patch.object(
                transfer,
                "stored_capacity_report_failures",
                return_value=[],
            ):
                with self.assertRaisesRegex(ValueError, "formal-300-500-30-v1"):
                    transfer.validate_capacity_report(report_path, SOURCE_TREE)

            payload["config"]["profileId"] = "formal-300-500-30-v1"
            payload["acceptance"] = {
                "passed": False,
                "failures": ["HTTP_ERRORS"],
            }
            report_path.write_text(json.dumps(payload), encoding="utf-8")
            with mock.patch.object(
                transfer,
                "stored_capacity_report_failures",
                return_value=[],
            ):
                with self.assertRaisesRegex(ValueError, "not accepted"):
                    transfer.validate_capacity_report(report_path, SOURCE_TREE)

    def test_capacity_report_recomputes_evidence_instead_of_trusting_summary(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            report_path = Path(tmp) / "capacity.json"
            write_capacity_report(report_path)

            with self.assertRaisesRegex(ValueError, "evidence did not validate"):
                transfer.validate_capacity_report(report_path, SOURCE_TREE)

    def test_task_scope_requires_existing_trellis_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            task_id = "08-06-windows-computer-install-setup-connect"
            write_task_metadata(root, task_id)
            self.assertEqual(transfer.validate_task_scope(root, task_id), task_id)
            with self.assertRaisesRegex(ValueError, "task id"):
                transfer.validate_task_scope(root, "../unsafe")
            with self.assertRaisesRegex(ValueError, "metadata not found"):
                transfer.validate_task_scope(root, "missing-task")

    def test_task_scope_resolves_date_prefixed_directory_by_stable_id(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            task_id = "windows-computer-install-setup-connect"
            task_dir = root / ".trellis" / "tasks" / f"08-06-{task_id}"
            task_dir.mkdir(parents=True)
            (task_dir / "task.json").write_text(
                json.dumps({"id": task_id, "status": "in_progress"}),
                encoding="utf-8",
            )

            self.assertEqual(transfer.validate_task_scope(root, task_id), task_id)

    def test_task_scoped_transfer_records_no_capacity_claim(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            root = workspace / "repo"
            root.mkdir()
            head, tree = init_git_repo(root)
            task_id = "08-06-windows-computer-install-setup-connect"
            write_task_metadata(root, task_id)
            subprocess.run(["git", "add", ".trellis"], cwd=root, check=True)
            subprocess.run(["git", "commit", "-q", "-m", "task metadata"], cwd=root, check=True)
            head = subprocess.run(
                ["git", "rev-parse", "HEAD"], cwd=root, check=True, capture_output=True, text=True
            ).stdout.strip()
            tree = subprocess.run(
                ["git", "rev-parse", "HEAD^{tree}"], cwd=root, check=True, capture_output=True, text=True
            ).stdout.strip()
            write_daemon_artifacts(root, head)
            archive = workspace / "images.tar"
            evidence_path = workspace / "release-evidence.json"
            options = transfer.TransferOptions(
                host="203.0.113.10",
                source_revision=head,
                output_archive=archive,
                skip_build=True,
                platform="linux/amd64",
            )
            identities = {
                tag: transfer.ImageIdentity(
                    image_id=image_inspect_payload(tag, head)["id"],
                    os="linux",
                    architecture="amd64",
                    source_revision=head,
                )
                for tag in transfer.image_tags(options)
            }

            def run_step(step: transfer.PlanStep, **_: object) -> int:
                if step.label == "save-image-archive":
                    manifest_bytes = json.dumps(
                        [
                            {
                                "Config": identity.image_id.removeprefix("sha256:") + ".json",
                                "RepoTags": [tag],
                                "Layers": [],
                            }
                            for tag, identity in identities.items()
                        ]
                    ).encode()
                    with tarfile.open(archive, "w") as bundle:
                        info = tarfile.TarInfo("manifest.json")
                        info.size = len(manifest_bytes)
                        bundle.addfile(info, io.BytesIO(manifest_bytes))
                return 0

            with (
                mock.patch.object(transfer, "inspect_candidate_images", return_value=identities),
                mock.patch.object(transfer, "run_step", side_effect=run_step),
                mock.patch("builtins.print"),
            ):
                result = transfer.execute_transfer(
                    options,
                    capacity_report=None,
                    root=root,
                    release_evidence=evidence_path,
                    task_id=task_id,
                )

            self.assertEqual(result, 0)
            payload = json.loads(evidence_path.read_text(encoding="utf-8"))
            self.assertEqual(
                payload["deploymentScope"],
                {"type": "task-scoped", "taskId": task_id, "capacityClaim": "not-asserted"},
            )
            self.assertIsNone(payload["capacityReport"])
            self.assertEqual(payload["testedCandidate"], {"head": head, "tree": tree})

    def test_skip_build_image_inspection_binds_revision_platform_tag_and_id(self) -> None:
        options = transfer.TransferOptions(
            host="203.0.113.10",
            source_revision=SOURCE_REVISION,
            skip_build=True,
            platform="linux/amd64",
        )
        payloads = {
            tag: image_inspect_payload(tag)
            for tag in (
                options.backend_image,
                options.frontend_image,
                options.caddy_image,
            )
        }

        def inspect(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
            self.assertNotIn("{{json .}}", command)
            self.assertNotIn(".Config.Env", " ".join(command))
            return subprocess.CompletedProcess(
                command,
                0,
                stdout=json.dumps(payloads[command[-1]]),
                stderr="",
            )

        with mock.patch.object(transfer.subprocess, "run", side_effect=inspect):
            identities = transfer.inspect_candidate_images(options, SOURCE_REVISION)

        self.assertEqual(set(identities), set(payloads))
        self.assertEqual(len({identity.image_id for identity in identities.values()}), 3)

    def test_skip_build_image_inspection_rejects_missing_or_mismatched_revision(self) -> None:
        options = transfer.TransferOptions(
            host="203.0.113.10",
            source_revision=SOURCE_REVISION,
            skip_build=True,
        )
        bad_payload = image_inspect_payload(options.backend_image, "f" * 40)
        with mock.patch.object(
            transfer.subprocess,
            "run",
            return_value=subprocess.CompletedProcess(
                ["docker", "image", "inspect"],
                0,
                stdout=json.dumps(bad_payload),
                stderr="",
            ),
        ):
            with self.assertRaisesRegex(ValueError, "revision label"):
                transfer.inspect_candidate_images(options, SOURCE_REVISION)

        bad_payload["sourceRevision"] = None
        with mock.patch.object(
            transfer.subprocess,
            "run",
            return_value=subprocess.CompletedProcess(
                ["docker", "image", "inspect"],
                0,
                stdout=json.dumps(bad_payload),
                stderr="",
            ),
        ):
            with self.assertRaisesRegex(ValueError, "revision label"):
                transfer.inspect_candidate_images(options, SOURCE_REVISION)

    def test_saved_archive_is_bound_to_inspected_image_ids_and_tags(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp) / "images.tar"
            identities = {
                "smallkhoj-backend:local-release": transfer.ImageIdentity(
                    image_id=f"sha256:{'a' * 64}",
                    os="linux",
                    architecture="amd64",
                    source_revision=SOURCE_REVISION,
                ),
                "smallkhoj-frontend:local-release": transfer.ImageIdentity(
                    image_id=f"sha256:{'b' * 64}",
                    os="linux",
                    architecture="amd64",
                    source_revision=SOURCE_REVISION,
                ),
                "smallkhoj-caddy:local-release": transfer.ImageIdentity(
                    image_id=f"sha256:{'c' * 64}",
                    os="linux",
                    architecture="amd64",
                    source_revision=SOURCE_REVISION,
                ),
            }
            manifest_bytes = json.dumps(
                [
                    {
                        "Config": f"{identity.image_id.removeprefix('sha256:')}.json",
                        "RepoTags": [tag],
                        "Layers": [],
                    }
                    for tag, identity in identities.items()
                ]
            ).encode()
            with tarfile.open(archive, "w") as bundle:
                info = tarfile.TarInfo("manifest.json")
                info.size = len(manifest_bytes)
                bundle.addfile(info, io.BytesIO(manifest_bytes))

            transfer.validate_saved_image_archive(archive, identities)

            tampered = dict(identities)
            tampered["smallkhoj-backend:local-release"] = transfer.ImageIdentity(
                image_id=f"sha256:{'d' * 64}",
                os="linux",
                architecture="amd64",
                source_revision=SOURCE_REVISION,
            )
            with self.assertRaisesRegex(ValueError, "archive image identities"):
                transfer.validate_saved_image_archive(archive, tampered)

    def test_saved_oci_archive_is_bound_to_inspected_image_ids_and_tags(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp) / "images.tar"
            identities = {
                "smallkhoj-backend:local-release": transfer.ImageIdentity(
                    image_id=f"sha256:{'a' * 64}",
                    os="linux",
                    architecture="amd64",
                    source_revision=SOURCE_REVISION,
                ),
                "smallkhoj-frontend:local-release": transfer.ImageIdentity(
                    image_id=f"sha256:{'b' * 64}",
                    os="linux",
                    architecture="amd64",
                    source_revision=SOURCE_REVISION,
                ),
                "smallkhoj-caddy:local-release": transfer.ImageIdentity(
                    image_id=f"sha256:{'c' * 64}",
                    os="linux",
                    architecture="amd64",
                    source_revision=SOURCE_REVISION,
                ),
            }
            manifest_bytes = json.dumps(
                [
                    {
                        "Config": f"blobs/sha256/{identity.image_id.removeprefix('sha256:')}",
                        "RepoTags": [tag],
                        "Layers": [],
                    }
                    for tag, identity in identities.items()
                ]
            ).encode()
            with tarfile.open(archive, "w") as bundle:
                info = tarfile.TarInfo("manifest.json")
                info.size = len(manifest_bytes)
                bundle.addfile(info, io.BytesIO(manifest_bytes))

            transfer.validate_saved_image_archive(archive, identities)

            malformed = json.loads(manifest_bytes)
            malformed[0]["Config"] = "blobs/sha256/not-a-digest"
            malformed_bytes = json.dumps(malformed).encode()
            with tarfile.open(archive, "w") as bundle:
                info = tarfile.TarInfo("manifest.json")
                info.size = len(malformed_bytes)
                bundle.addfile(info, io.BytesIO(malformed_bytes))

            with self.assertRaisesRegex(ValueError, "saved image archive identity"):
                transfer.validate_saved_image_archive(archive, identities)

    def test_daemon_release_artifacts_require_same_revision_and_checksums(self) -> None:
        def write_platform_release(
            artifact_dir: Path,
            platform: str,
            *,
            revision: str = SOURCE_REVISION,
            version: str = "0.2.7",
            npm_payload: bytes = b"candidate daemon package",
            include_npm: bool = True,
        ) -> None:
            package = artifact_dir / f"smallkhoj-smallkhoj-daemon-{version}.tgz"
            package.write_bytes(npm_payload)
            artifact = artifact_dir / f"smallkhoj-daemon-v{version}-{platform}.tar.gz"
            artifact.write_bytes(f"artifact {platform}".encode())
            files = {
                package.name: transfer.sha256_file(package),
                artifact.name: transfer.sha256_file(artifact),
            }
            manifest_payload = {
                "sourceRevision": revision,
                "version": version,
                "platform": platform,
                "files": files,
            }
            if include_npm:
                manifest_payload["npmPackage"] = str(package)
            (artifact_dir / f"smallkhoj-daemon-v{version}-{platform}.manifest.json").write_text(
                json.dumps(manifest_payload),
                encoding="utf-8",
            )

        with tempfile.TemporaryDirectory() as tmp:
            artifact_dir = Path(tmp)
            write_platform_release(artifact_dir, "darwin-arm64")
            write_platform_release(artifact_dir, "win32-x64")

            transfer.validate_daemon_release_artifacts(
                artifact_dir,
                SOURCE_REVISION,
            )

        with tempfile.TemporaryDirectory() as tmp:
            artifact_dir = Path(tmp)
            write_platform_release(artifact_dir, "darwin-arm64")
            write_platform_release(artifact_dir, "win32-x64")
            (artifact_dir / "smallkhoj-daemon-v0.2.7-win32-x64.tar.gz").write_bytes(b"tampered")

            with self.assertRaisesRegex(ValueError, "checksum"):
                transfer.validate_daemon_release_artifacts(
                    artifact_dir,
                    SOURCE_REVISION,
                )

        with tempfile.TemporaryDirectory() as tmp:
            artifact_dir = Path(tmp)
            write_platform_release(artifact_dir, "darwin-arm64")
            write_platform_release(artifact_dir, "win32-x64", revision="f" * 40)

            with self.assertRaisesRegex(ValueError, "source revision"):
                transfer.validate_daemon_release_artifacts(
                    artifact_dir,
                    SOURCE_REVISION,
                )

        with tempfile.TemporaryDirectory() as tmp:
            artifact_dir = Path(tmp)
            write_platform_release(artifact_dir, "darwin-arm64")
            manifest = artifact_dir / "smallkhoj-daemon-v0.2.7-darwin-arm64.manifest.json"
            duplicate = artifact_dir / "smallkhoj-daemon-v0.2.7-darwin-arm64-copy.manifest.json"
            duplicate.write_text(manifest.read_text(encoding="utf-8"), encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "duplicate manifests for platform"):
                transfer.validate_daemon_release_artifacts(
                    artifact_dir,
                    SOURCE_REVISION,
                )

        with tempfile.TemporaryDirectory() as tmp:
            artifact_dir = Path(tmp)
            # The win32 manifest records "package two" while the darwin write
            # (processed first, matching the on-disk payload) records
            # "package one": the two manifests disagree on the shared tgz.
            write_platform_release(artifact_dir, "win32-x64", npm_payload=b"package two")
            write_platform_release(artifact_dir, "darwin-arm64", npm_payload=b"package one")

            with self.assertRaisesRegex(ValueError, "disagree on checksum"):
                transfer.validate_daemon_release_artifacts(
                    artifact_dir,
                    SOURCE_REVISION,
                )

        with tempfile.TemporaryDirectory() as tmp:
            artifact_dir = Path(tmp)
            write_platform_release(artifact_dir, "darwin-arm64")
            write_platform_release(artifact_dir, "win32-x64")
            (artifact_dir / "stale-artifact.tar.gz").write_bytes(b"stale")

            with self.assertRaisesRegex(ValueError, "unverified files"):
                transfer.validate_daemon_release_artifacts(
                    artifact_dir,
                    SOURCE_REVISION,
                )

        with tempfile.TemporaryDirectory() as tmp:
            artifact_dir = Path(tmp)
            write_platform_release(artifact_dir, "darwin-arm64", include_npm=False)
            write_platform_release(artifact_dir, "win32-x64", include_npm=False)

            with self.assertRaisesRegex(ValueError, "npm release artifact"):
                transfer.validate_daemon_release_artifacts(
                    artifact_dir,
                    SOURCE_REVISION,
                )

    def test_dirty_real_transfer_fails_before_any_plan_command(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            head, tree = init_git_repo(root)
            report = root / "capacity.json"
            write_capacity_report(report, tree=tree)
            subprocess.run(["git", "add", "capacity.json"], cwd=root, check=True)
            subprocess.run(
                ["git", "commit", "-q", "-m", "capacity report"],
                cwd=root,
                check=True,
            )
            head = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=root,
                check=True,
                capture_output=True,
                text=True,
            ).stdout.strip()
            (root / "tracked.txt").write_text("dirty\n", encoding="utf-8")
            options = transfer.TransferOptions(
                host="203.0.113.10",
                source_revision=head,
            )

            with mock.patch.object(transfer.subprocess, "run", wraps=subprocess.run) as run:
                with self.assertRaisesRegex(ValueError, "worktree must be clean"):
                    transfer.execute_transfer(
                        options,
                        capacity_report=report,
                        root=root,
                    )

            self.assertFalse(
                any(
                    call.args[0][0] in {"docker", "ssh", "scp"}
                    for call in run.call_args_list
                )
            )

    def test_execute_transfer_persists_and_emits_post_squash_release_evidence(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            root = workspace / "repo"
            root.mkdir()
            tested_head, tested_tree = init_git_repo(root)
            subprocess.run(
                ["git", "commit", "-q", "--allow-empty", "-m", "squash merge"],
                cwd=root,
                check=True,
            )
            merge_head = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=root,
                check=True,
                capture_output=True,
                text=True,
            ).stdout.strip()
            merge_tree = subprocess.run(
                ["git", "rev-parse", "HEAD^{tree}"],
                cwd=root,
                check=True,
                capture_output=True,
                text=True,
            ).stdout.strip()
            self.assertNotEqual(tested_head, merge_head)
            self.assertEqual(tested_tree, merge_tree)
            write_daemon_artifacts(root, merge_head)

            report = workspace / "formal-capacity.json"
            write_capacity_report(
                report,
                head=tested_head,
                tree=tested_tree,
            )
            archive = workspace / "images.tar"
            release_evidence = workspace / "release-evidence.json"
            options = transfer.TransferOptions(
                host="203.0.113.10",
                source_revision=merge_head,
                output_archive=archive,
                skip_build=True,
                platform="linux/amd64",
            )
            identities = {
                tag: transfer.ImageIdentity(
                    image_id=image_inspect_payload(tag, merge_head)["id"],
                    os="linux",
                    architecture="amd64",
                    source_revision=merge_head,
                )
                for tag in transfer.image_tags(options)
            }

            def run_step(step: transfer.PlanStep, **_: object) -> int:
                if step.label == "save-image-archive":
                    manifest_bytes = json.dumps(
                        [
                            {
                                "Config": (
                                    identity.image_id.removeprefix("sha256:")
                                    + ".json"
                                ),
                                "RepoTags": [tag],
                                "Layers": [],
                            }
                            for tag, identity in identities.items()
                        ]
                    ).encode()
                    with tarfile.open(archive, "w") as bundle:
                        info = tarfile.TarInfo("manifest.json")
                        info.size = len(manifest_bytes)
                        bundle.addfile(info, io.BytesIO(manifest_bytes))
                return 0

            with (
                mock.patch.object(
                    transfer,
                    "stored_capacity_report_failures",
                    return_value=[],
                ),
                mock.patch.object(
                    transfer,
                    "inspect_candidate_images",
                    return_value=identities,
                ),
                mock.patch.object(transfer, "run_step", side_effect=run_step),
                mock.patch("builtins.print") as output,
            ):
                result = transfer.execute_transfer(
                    options,
                    capacity_report=report,
                    root=root,
                    release_evidence=release_evidence,
                )

            self.assertEqual(result, 0)
            payload = json.loads(release_evidence.read_text(encoding="utf-8"))
            self.assertEqual(payload["schemaVersion"], 1)
            self.assertEqual(payload["status"], "transferred")
            self.assertEqual(
                payload["testedCandidate"],
                {"head": tested_head, "tree": tested_tree},
            )
            self.assertEqual(
                payload["mergeCandidate"],
                {"head": merge_head, "tree": merge_tree},
            )
            self.assertEqual(
                payload["capacityReport"],
                {
                    "path": str(report.resolve()),
                    "sha256": transfer.sha256_file(report),
                    "profileId": "formal-300-500-30-v1",
                },
            )
            self.assertEqual(
                payload["images"],
                [
                    {
                        "tag": tag,
                        "id": identities[tag].image_id,
                        "revisionLabel": merge_head,
                        "platform": "linux/amd64",
                    }
                    for tag in sorted(identities)
                ],
            )
            self.assertEqual(
                payload["archive"],
                {
                    "path": str(archive.resolve()),
                    "sha256": transfer.sha256_file(archive),
                },
            )

            emitted = json.loads(output.call_args.args[0])
            self.assertEqual(
                emitted,
                {
                    "event": "production-image-transfer-release-evidence",
                    "path": str(release_evidence.resolve()),
                    "sha256": transfer.sha256_file(release_evidence),
                    "evidence": payload,
                },
            )

    def test_release_runbook_commands_require_formal_capacity_evidence(self) -> None:
        root = Path(__file__).resolve().parents[2]
        runbook = (
            root / "docs" / "initial-release-production-deployment.md"
        ).read_text(encoding="utf-8")
        deployment_contract = (
            root
            / ".trellis"
            / "spec"
            / "backend"
            / "deployment-environment-contracts.md"
        ).read_text(encoding="utf-8")

        for source in (runbook, deployment_contract):
            command_blocks = [
                block
                for block in re.findall(r"```bash\n(.*?)```", source, re.DOTALL)
                if "scripts/production_image_transfer.py" in block
            ]
            self.assertTrue(command_blocks)
            for block in command_blocks:
                self.assertIn("--capacity-report", block)

        for required_explanation in (
            "NON_FORMAL_CAPACITY_PROFILE",
            "ACCEPTANCE_SUMMARY_MISMATCH",
            "stale capacity report",
            "release-evidence.json",
        ):
            self.assertIn(required_explanation, runbook)

    def test_json_dry_run_is_runnable_without_capacity_report_or_secret_value(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            head, _ = init_git_repo(root)
            old_cwd = Path.cwd()
            old_secret = os.environ.get("PUBLIC_API_KEY")
            os.environ["PUBLIC_API_KEY"] = "must-not-appear-in-plan"
            try:
                os.chdir(root)
                with mock.patch("builtins.print") as output:
                    result = transfer.main(
                        [
                            "--host",
                            "203.0.113.10",
                            "--source-revision",
                            head,
                            "--json",
                        ]
                    )
            finally:
                os.chdir(old_cwd)
                if old_secret is None:
                    os.environ.pop("PUBLIC_API_KEY", None)
                else:
                    os.environ["PUBLIC_API_KEY"] = old_secret

            self.assertEqual(result, 0)
            rendered = "\n".join(str(call.args[0]) for call in output.call_args_list)
            self.assertNotIn("must-not-appear-in-plan", rendered)

    def test_real_transfer_requires_exactly_one_formal_or_task_scoped_gate(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            head, _ = init_git_repo(root)
            old_cwd = Path.cwd()
            try:
                os.chdir(root)
                with mock.patch("builtins.print") as output:
                    missing = transfer.main([
                        "--host", "203.0.113.10", "--source-revision", head,
                    ])
                    missing_task_id = transfer.main([
                        "--host", "203.0.113.10", "--source-revision", head,
                        "--task-scoped",
                    ])
                    conflicting = transfer.main([
                        "--host", "203.0.113.10", "--source-revision", head,
                        "--task-scoped", "--task-id", "task-id",
                        "--capacity-report", "capacity.json",
                    ])
            finally:
                os.chdir(old_cwd)

            self.assertEqual((missing, missing_task_id, conflicting), (2, 2, 2))
            rendered = "\n".join(str(call.args[0]) for call in output.call_args_list)
            self.assertIn("--capacity-report", rendered)
            self.assertIn("--task-scoped requires --task-id", rendered)
            self.assertIn("not both", rendered)


if __name__ == "__main__":
    unittest.main()
