DEFAULT_CORS_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]


def parse_cors_origins(value: str) -> list[str]:
    origins: list[str] = []
    seen: set[str] = set()
    for item in value.split(","):
        origin = item.strip().rstrip("/")
        if not origin or origin == "*" or origin in seen:
            continue
        origins.append(origin)
        seen.add(origin)
    return origins


def build_cors_origins(configured_origins: str) -> list[str]:
    origins = list(DEFAULT_CORS_ORIGINS)
    seen = set(origins)
    for origin in parse_cors_origins(configured_origins):
        if origin not in seen:
            origins.append(origin)
            seen.add(origin)
    return origins
