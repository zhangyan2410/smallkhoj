import json
from pathlib import Path

from routers import public_api

DAEMON_PACKAGE_VERSION = json.loads(
    (
        Path(__file__).resolve().parents[2]
        / "agent"
        / "daemon"
        / "aaa-daemon"
        / "package.json"
    ).read_text(encoding="utf-8")
)["version"]


def test_connect_command_uses_hosted_npm_tarball_by_default_not_repo_path():
    command = public_api._computer_connect_command(
        "sk_connect_test",
        "https://smallkhoj.example.com",
        "张岩 Server",
    )

    assert command == (
        f"npx -y --package https://smallkhoj.example.com/downloads/smallkhoj-daemon/smallkhoj-smallkhoj-daemon-{DAEMON_PACKAGE_VERSION}.tgz "
        "aura --server-url https://smallkhoj.example.com --api-key sk_connect_test # 张岩 Server"
    )
    assert "agent/daemon/aaa-daemon" not in command
    assert "/Users/" not in command
    assert "Path(__file__)" not in command
    assert "localhost" not in command


def test_connect_command_can_use_configured_npm_package(monkeypatch):
    monkeypatch.setattr(public_api.settings, "daemon_npx_package", "@smallkhoj/smallkhoj-daemon@latest")

    command = public_api._computer_connect_command(
        "sk_connect_test",
        "https://smallkhoj.example.com",
        "张岩 Server",
    )

    assert command == (
        "npx -y --package @smallkhoj/smallkhoj-daemon@latest "
        "aura --server-url https://smallkhoj.example.com --api-key sk_connect_test # 张岩 Server"
    )


def test_connect_command_can_advertise_newer_daemon_without_raising_minimum(monkeypatch):
    advertised_version = "0.3.0"
    monkeypatch.setattr(public_api.settings, "minimum_daemon_version", "0.2.0")
    monkeypatch.setattr(public_api.settings, "daemon_release_version", advertised_version)

    command = public_api._computer_connect_command(
        "sk_connect_test",
        "https://smallkhoj.example.com",
        "张岩 Server",
    )

    assert f"smallkhoj-smallkhoj-daemon-{advertised_version}.tgz" in command
    assert "aura --server-url https://smallkhoj.example.com" in command


def test_daemon_install_metadata_is_domain_aware():
    metadata = public_api._daemon_install_metadata("https://smallkhoj.example.com")

    assert metadata["downloadBaseUrl"] == "https://smallkhoj.example.com/downloads/smallkhoj-daemon"
    assert metadata["installCommand"] == (
        "curl -fsSL https://smallkhoj.example.com/downloads/smallkhoj-daemon/install.sh "
        "| SMALLKHOJ_DAEMON_DOWNLOAD_BASE_URL=https://smallkhoj.example.com/downloads/smallkhoj-daemon bash"
    )
    assert metadata["commandName"] == "aura"
    assert "localhost" not in metadata["installCommand"]


def test_reconnect_command_uses_hosted_npm_tarball_by_default_not_repo_path():
    command = public_api._computer_connection_command(
        "sk_machine_test",
        "https://smallkhoj.example.com",
        "张岩 Server",
    )

    assert command == (
        f"npx -y --package https://smallkhoj.example.com/downloads/smallkhoj-daemon/smallkhoj-smallkhoj-daemon-{DAEMON_PACKAGE_VERSION}.tgz "
        "aura --server-url https://smallkhoj.example.com --api-key sk_machine_test # 张岩 Server"
    )
    assert "agent/daemon/aaa-daemon" not in command
    assert "/Users/" not in command
    assert "Path(__file__)" not in command
    assert "localhost" not in command


def test_command_server_comment_is_single_line():
    command = public_api._computer_connect_command(
        "sk_connect_test",
        "https://smallkhoj.example.com",
        "  A\n\tServer  ",
    )

    assert command.endswith("# A Server")
    assert "\n" not in command
