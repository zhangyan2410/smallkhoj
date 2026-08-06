from pathlib import Path

from config import _discover_daemon_release_version

PROJECT_DIR = Path(__file__).resolve().parents[1].parent


def test_production_compose_requires_explicit_daemon_versions() -> None:
    source = (PROJECT_DIR / "docker-compose.prod.yml").read_text(encoding="utf-8")

    assert "MINIMUM_DAEMON_VERSION: ${MINIMUM_DAEMON_VERSION:?" in source
    assert "DAEMON_RELEASE_VERSION: ${DAEMON_RELEASE_VERSION:?" in source
    assert "DAEMON_RELEASE_VERSION:-" not in source


def test_post_deploy_smoke_has_no_current_version_literal() -> None:
    source = (PROJECT_DIR / "scripts" / "post_deploy_smoke.py").read_text(encoding="utf-8")

    assert "DEFAULT_DAEMON_PACKAGE_VERSION" not in source
    assert "0.2.1" not in source


def test_backend_does_not_advertise_source_version_without_a_downloadable_artifact(tmp_path: Path) -> None:
    package_json = tmp_path / "agent" / "daemon" / "aaa-daemon" / "package.json"
    package_json.parent.mkdir(parents=True)
    package_json.write_text('{"version": "9.9.9"}\n', encoding="utf-8")

    assert _discover_daemon_release_version(tmp_path) == ""


def test_backend_discovers_only_a_manifested_npm_artifact(tmp_path: Path) -> None:
    artifact_dir = tmp_path / "release-artifacts" / "smallkhoj-daemon"
    artifact_dir.mkdir(parents=True)
    package_name = "smallkhoj-smallkhoj-daemon-9.9.9.tgz"
    (artifact_dir / package_name).write_bytes(b"package")
    (artifact_dir / "daemon.manifest.json").write_text(
        '{"version": "9.9.9", "npmPackage": "' + package_name + '"}\n',
        encoding="utf-8",
    )

    assert _discover_daemon_release_version(tmp_path) == "9.9.9"
