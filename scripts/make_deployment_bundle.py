#!/usr/bin/env python3
"""Create a no-secret deployment bundle for the initial release."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import subprocess
import tarfile
from datetime import datetime, timezone
from pathlib import Path


INCLUDED_FILES = (
    "docker-compose.prod.yml",
    "deploy/caddy/Dockerfile",
    "deploy/caddy/Caddyfile",
    "docs/initial-release-production-deployment.md",
    "scripts/create_prod_env_template.py",
    "scripts/initial_release_deploy_preflight.py",
    "scripts/lighthouse_host_probe.py",
    "scripts/post_deploy_smoke.py",
    "scripts/remote_deploy_evidence.py",
)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def current_git_commit(root: Path) -> str | None:
    try:
        completed = subprocess.run(
            ["git", "rev-parse", "--short=12", "HEAD"],
            cwd=root,
            check=False,
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if completed.returncode != 0:
        return None
    return completed.stdout.strip() or None


def validate_archive_path(relative_path: str) -> None:
    path = Path(relative_path)
    if path.is_absolute() or ".." in path.parts:
        raise ValueError(f"Bundle path must be relative and safe: {relative_path}")
    if path.name.startswith(".env"):
        raise ValueError(f"Refusing to bundle env file: {relative_path}")
    for part in path.parts:
        if part in {".git", "node_modules", ".next", "__pycache__", ".trellis"}:
            raise ValueError(f"Refusing to bundle excluded path: {relative_path}")


def add_bytes(tar: tarfile.TarFile, *, prefix: str, relative_path: str, data: bytes) -> dict:
    validate_archive_path(relative_path)
    archive_name = f"{prefix.strip('/')}/{relative_path}"
    validate_archive_path(archive_name)
    info = tarfile.TarInfo(archive_name)
    info.size = len(data)
    info.mtime = int(datetime.now(timezone.utc).timestamp())
    tar.addfile(info, fileobj=io.BytesIO(data))
    return {
        "path": relative_path,
        "size": len(data),
        "sha256": sha256_bytes(data),
    }


def read_required_file(root: Path, relative_path: str) -> bytes:
    validate_archive_path(relative_path)
    path = root / relative_path
    if not path.is_file():
        raise FileNotFoundError(f"Required bundle file missing: {relative_path}")
    if path.is_symlink():
        raise ValueError(f"Refusing to bundle symlink: {relative_path}")
    return path.read_bytes()


def make_readme(prefix: str) -> bytes:
    text = f"""# SmallKhoj Initial Release Deployment Bundle

This bundle contains only the files needed for the first Lighthouse deployment probe and production smoke path. It intentionally does not include `.env.prod`, git metadata, app source trees, build artifacts, databases, logs, or secrets.

## Suggested Server Flow

Unpack:

```bash
tar -xzf smallkhoj-deploy-bundle.tar.gz
cd {prefix}
```

Probe the host before mutating it:

```bash
python3 scripts/lighthouse_host_probe.py --json
```

After creating `.env.prod` on the server, run the deployment preflight:

```bash
python3 scripts/initial_release_deploy_preflight.py --env-file .env.prod --runtime --json
```

Pull and start the core stack:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml pull
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d db backend frontend caddy
```

Smoke the public URL:

```bash
python3 scripts/post_deploy_smoke.py --base-url https://smallkhoj.example.com --json
```

For IP-only HTTP smoke before DNS/HTTPS is ready:

```bash
python3 scripts/post_deploy_smoke.py --base-url http://<server-ip> --allow-http --json
```

See `docs/initial-release-production-deployment.md` for the full runbook.
"""
    return text.encode("utf-8")


def create_manifest(*, files: list[dict], git_commit: str | None) -> bytes:
    payload = {
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "gitCommit": git_commit,
        "files": files,
    }
    return json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True).encode("utf-8") + b"\n"


def create_bundle(*, root: Path, output: Path, prefix: str = "smallkhoj-deploy") -> Path:
    root = root.resolve()
    output = output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)

    file_entries: list[dict] = []
    with tarfile.open(output, "w:gz") as tar:
        for relative_path in INCLUDED_FILES:
            data = read_required_file(root, relative_path)
            file_entries.append(add_bytes(tar, prefix=prefix, relative_path=relative_path, data=data))

        readme = make_readme(prefix)
        file_entries.append(add_bytes(tar, prefix=prefix, relative_path="README.deploy-bundle.md", data=readme))

        manifest = create_manifest(files=sorted(file_entries, key=lambda item: item["path"]), git_commit=current_git_commit(root))
        add_bytes(tar, prefix=prefix, relative_path="manifest.json", data=manifest)

    return output


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Create a no-secret SmallKhoj initial-release deployment bundle.")
    parser.add_argument("--root", default=".", help="Repository root. Defaults to current directory.")
    parser.add_argument("--output", required=True, help="Output .tar.gz path.")
    parser.add_argument("--prefix", default="smallkhoj-deploy", help="Top-level directory name inside the tarball.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    output = create_bundle(root=Path(args.root), output=Path(args.output), prefix=args.prefix)
    print(str(output))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
