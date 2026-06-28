from services.cors_config import build_cors_origins, parse_cors_origins


def test_parse_cors_origins_trims_empty_values_and_duplicates():
    assert parse_cors_origins(
        " https://smallkhoj.example.com, ,https://smallkhoj.example.com,http://localhost:3000 "
    ) == ["https://smallkhoj.example.com", "http://localhost:3000"]


def test_parse_cors_origins_rejects_wildcard_for_credentialed_cors():
    assert parse_cors_origins("*, https://smallkhoj.example.com") == ["https://smallkhoj.example.com"]


def test_build_cors_origins_keeps_localhost_defaults():
    assert build_cors_origins("") == [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]


def test_build_cors_origins_appends_configured_production_origins():
    assert build_cors_origins("https://smallkhoj.example.com") == [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://smallkhoj.example.com",
    ]
