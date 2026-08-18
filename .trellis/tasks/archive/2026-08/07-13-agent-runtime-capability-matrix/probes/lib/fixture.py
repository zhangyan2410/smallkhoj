from __future__ import annotations

import hashlib
import os
import re
import secrets
import subprocess
from dataclasses import dataclass
from pathlib import Path


class FixtureError(RuntimeError):
    """Raised when a disposable probe fixture is unsafe or malformed."""


_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


@dataclass(frozen=True)
class Fixture:
    root: Path
    run_id: str
    provider: str
    surface: str
    nonce: str
    baseline_digest: str


class FixtureManager:
    """Creates disposable, local-only Git fixtures below an explicit `/tmp` root."""

    def __init__(self, root: Path) -> None:
        self.root = Path(root).absolute()
        resolved_root = self.root.resolve(strict=False)
        tmp_root = Path("/tmp").resolve()
        if resolved_root == tmp_root or not resolved_root.is_relative_to(tmp_root):
            raise FixtureError(f"fixture root must be a descendant of {tmp_root}")

    def create(self, run_id: str, provider: str, surface: str) -> Fixture:
        run_id = self._identifier(run_id, "run_id")
        provider = self._identifier(provider, "provider")
        surface = self._identifier(surface, "surface")
        fixture_root = self.root / run_id / provider / surface
        if fixture_root.exists() or fixture_root.is_symlink():
            raise FixtureError(f"refusing to reuse existing fixture path: {fixture_root}")

        fixture_root.mkdir(parents=True, mode=0o700)
        self.assert_within_fixture(fixture_root, fixture_root)
        nonce = secrets.token_hex(8)
        (fixture_root / "README.md").write_text(
            "# Disposable Agent Runtime Capability Fixture\n\n"
            "This directory is safe for local-only probe activity. Do not access files outside it.\n",
            encoding="utf-8",
        )
        (fixture_root / "sentinel.txt").write_text(f"fixture-nonce={nonce}\n", encoding="utf-8")
        self._git_init(fixture_root)
        return Fixture(
            root=fixture_root,
            run_id=run_id,
            provider=provider,
            surface=surface,
            nonce=nonce,
            baseline_digest=self.digest(fixture_root),
        )

    def assert_within_fixture(self, fixture_root: Path, candidate: Path) -> Path:
        resolved_fixture = Path(fixture_root).resolve(strict=False)
        resolved_root = self.root.resolve(strict=False)
        tmp_root = Path("/tmp").resolve()
        if not resolved_fixture.is_relative_to(resolved_root) or not resolved_fixture.is_relative_to(tmp_root):
            raise FixtureError("fixture root escaped the configured temporary root")
        resolved_candidate = Path(candidate).resolve(strict=False)
        if not resolved_candidate.is_relative_to(resolved_fixture):
            raise FixtureError(f"path escapes fixture root: {candidate}")
        return resolved_candidate

    def digest(self, fixture_root: Path) -> str:
        fixture_root = Path(fixture_root)
        self.assert_within_fixture(fixture_root, fixture_root)
        hasher = hashlib.sha256()
        for path in sorted(fixture_root.rglob("*")):
            if ".git" in path.relative_to(fixture_root).parts:
                continue
            if path.is_symlink():
                raise FixtureError(f"fixture contains a symlink: {path}")
            if not path.is_file():
                continue
            self.assert_within_fixture(fixture_root, path)
            relative = path.relative_to(fixture_root).as_posix().encode("utf-8")
            hasher.update(len(relative).to_bytes(8, "big"))
            hasher.update(relative)
            with path.open("rb") as handle:
                for chunk in iter(lambda: handle.read(65536), b""):
                    hasher.update(chunk)
        return hasher.hexdigest()

    @staticmethod
    def _identifier(value: str, field: str) -> str:
        if not isinstance(value, str) or not _IDENTIFIER.fullmatch(value):
            raise FixtureError(f"{field} must match {_IDENTIFIER.pattern}")
        return value

    @staticmethod
    def _git_init(fixture_root: Path) -> None:
        try:
            result = subprocess.run(
                ["git", "init", "--quiet", str(fixture_root)],
                check=False,
                capture_output=True,
                text=True,
                timeout=15,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise FixtureError(f"unable to initialize disposable Git fixture: {exc}") from exc
        if result.returncode != 0:
            detail = result.stderr.strip() or result.stdout.strip() or f"exit {result.returncode}"
            raise FixtureError(f"unable to initialize disposable Git fixture: {detail}")
