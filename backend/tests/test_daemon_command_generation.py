from routers import public_api


def test_connect_command_uses_installed_daemon_command_not_repo_path():
    command = public_api._computer_connect_command("sk_connect_test", "https://smallkhoj.example.com")

    assert command == "smallkhoj-daemon connect --token sk_connect_test --server https://smallkhoj.example.com"
    assert "/smallkhoj-daemon" not in command
    assert "agent/daemon/aaa-daemon" not in command


def test_reconnect_command_uses_installed_daemon_command_not_repo_path():
    command = public_api._computer_connection_command("sk_machine_test", "https://smallkhoj.example.com")

    assert command == "smallkhoj-daemon start --machine-token sk_machine_test --server https://smallkhoj.example.com"
    assert "/smallkhoj-daemon" not in command
    assert "agent/daemon/aaa-daemon" not in command
