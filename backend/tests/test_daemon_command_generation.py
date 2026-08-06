import json
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

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


@pytest.fixture(autouse=True)
def configured_daemon_release_version(monkeypatch):
    """Tests choose their candidate explicitly; production never uses this fixture."""

    monkeypatch.setattr(public_api.settings, "daemon_release_version", DAEMON_PACKAGE_VERSION)


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


def test_connect_command_fails_closed_without_release_selection(monkeypatch):
    monkeypatch.setattr(public_api.settings, "daemon_release_version", "")
    monkeypatch.setattr(public_api.settings, "minimum_daemon_version", "0.0.1")

    with pytest.raises(HTTPException) as error:
        public_api._computer_connect_command("sk_connect_test", "https://smallkhoj.example.com")

    assert error.value.status_code == 503
    assert "DAEMON_RELEASE_VERSION" in str(error.value.detail)


def test_daemon_install_metadata_is_domain_aware():
    metadata = public_api._daemon_install_metadata("https://smallkhoj.example.com")

    assert metadata["downloadBaseUrl"] == "https://smallkhoj.example.com/downloads/smallkhoj-daemon"
    assert metadata["installCommand"] == (
        "curl -fsSL https://smallkhoj.example.com/downloads/smallkhoj-daemon/install.sh "
        "| SMALLKHOJ_DAEMON_DOWNLOAD_BASE_URL=https://smallkhoj.example.com/downloads/smallkhoj-daemon bash "
        '&& export PATH="$HOME/.smallkhoj/bin:$PATH"'
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


def test_platform_preview_is_structured_and_ticket_free():
    payload = public_api._platform_command_payload(
        "https://smallkhoj.example.com",
        name="Windows O'Brien",
        server_label="Team Server",
    )

    assert set(payload) == {"windows", "unix"}
    assert payload["windows"]["shell"] == "powershell"
    assert payload["unix"]["shell"] == "bash"
    assert payload["windows"]["connect"]["command"] is None
    assert payload["unix"]["connect"]["command"] is None
    assert payload["windows"]["setup"]["command"] == (
        "aura setup --name 'Windows O''Brien' --server-url 'https://smallkhoj.example.com'"
    )
    assert "sk_connect_" not in repr(payload)


def test_platform_action_contains_fresh_connect_commands_for_both_shells():
    token = "sk_connect_test"
    payload = public_api._platform_command_payload(
        "https://smallkhoj.example.com",
        name="my-computer",
        connect_token=token,
        server_label="Team Server",
    )

    windows = payload["windows"]
    unix = payload["unix"]
    assert windows["connect"]["command"].startswith("aura --server-url 'https://smallkhoj.example.com'")
    assert "--api-key 'sk_connect_test'" in windows["connect"]["command"]
    assert unix["connect"]["command"].startswith("npx -y --package ")
    assert "--api-key sk_connect_test" in unix["connect"]["command"]


def test_powershell_quote_doubles_embedded_single_quotes():
    assert public_api._powershell_quote("a'b") == "'a''b'"


def test_windows_release_metadata_fails_closed_without_published_manifest(monkeypatch):
    monkeypatch.setattr(public_api.settings, "daemon_release_version", "0.2.6")
    metadata = public_api._release_artifact_metadata(
        "https://smallkhoj.example.com",
        public_api.DAEMON_WINDOWS_PLATFORM,
    )

    assert metadata["available"] is False
    assert metadata["platform"] == "win32-x64"
    assert metadata["artifactUrl"].endswith("smallkhoj-daemon-v0.2.6-win32-x64.zip")


@pytest.mark.asyncio
async def test_connect_preview_never_persists_or_returns_ticket(monkeypatch):
    server = SimpleNamespace(id=uuid.uuid4(), name="Team Server")

    async def resolve_context(_db, _request):
        return SimpleNamespace(server=server, membership=object())

    monkeypatch.setattr(public_api, "_resolve_active_server_context", resolve_context)
    monkeypatch.setattr(public_api, "require_admin_role", lambda _membership: None)

    class PreviewDb:
        def add(self, _item):
            raise AssertionError("preview must not add a ConnectTicket")

        async def commit(self):
            raise AssertionError("preview must not commit")

    class PreviewRequest:
        async def json(self):
            return {"name": "preview-computer", "serverUrl": "https://smallkhoj.example.com"}

    response = await public_api.preview_computer_connect_commands(
        PreviewRequest(),
        _auth=None,
        db=PreviewDb(),
    )

    assert response["ticket"] is None
    assert response["expiresAt"] is None
    assert response["name"] == "preview-computer"
    assert response["platforms"]["windows"]["connect"]["command"] is None
