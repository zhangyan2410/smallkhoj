from main import app


def test_daemon_download_path_is_mounted():
    routes = {getattr(route, "path", "") for route in app.routes}

    assert "/downloads/smallkhoj-daemon" in routes
