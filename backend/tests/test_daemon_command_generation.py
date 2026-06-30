from routers import public_api


def test_connect_command_uses_hosted_npm_tarball_by_default_not_repo_path():
    command = public_api._computer_connect_command(
        "sk_connect_test",
        "https://smallkhoj.example.com",
        "张岩 Server",
    )

    assert command == (
        "npx -y https://smallkhoj.example.com/downloads/smallkhoj-daemon/smallkhoj-smallkhoj-daemon-0.2.0.tgz "
        "--server-url https://smallkhoj.example.com --api-key sk_connect_test # 张岩 Server"
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
        "npx -y @smallkhoj/smallkhoj-daemon@latest "
        "--server-url https://smallkhoj.example.com --api-key sk_connect_test # 张岩 Server"
    )


def test_daemon_install_metadata_is_domain_aware():
    metadata = public_api._daemon_install_metadata("https://smallkhoj.example.com")

    assert metadata["downloadBaseUrl"] == "https://smallkhoj.example.com/downloads/smallkhoj-daemon"
    assert metadata["installCommand"] == (
        "curl -fsSL https://smallkhoj.example.com/downloads/smallkhoj-daemon/install.sh "
        "| SMALLKHOJ_DAEMON_DOWNLOAD_BASE_URL=https://smallkhoj.example.com/downloads/smallkhoj-daemon bash"
    )
    assert metadata["commandName"] == "smallkhoj-daemon"
    assert "localhost" not in metadata["installCommand"]


def test_reconnect_command_uses_hosted_npm_tarball_by_default_not_repo_path():
    command = public_api._computer_connection_command(
        "sk_machine_test",
        "https://smallkhoj.example.com",
        "张岩 Server",
    )

    assert command == (
        "npx -y https://smallkhoj.example.com/downloads/smallkhoj-daemon/smallkhoj-smallkhoj-daemon-0.2.0.tgz "
        "--server-url https://smallkhoj.example.com --api-key sk_machine_test # 张岩 Server"
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
