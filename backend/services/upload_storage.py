"""Bounded local upload staging and database/filesystem compensation."""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from dataclasses import dataclass
from pathlib import Path

from fastapi import HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings

logger = logging.getLogger(__name__)


def _size_label(max_bytes: int) -> str:
    mib = 1024 * 1024
    if max_bytes >= mib and max_bytes % mib == 0:
        return f"{max_bytes // mib} MB"
    return f"{max_bytes} byte"


@dataclass
class StagedUpload:
    staging_path: Path
    final_path: Path
    size: int
    promoted: bool = False

    def promote(self) -> None:
        """Atomically expose the complete blob at its final local path."""

        os.replace(self.staging_path, self.final_path)
        self.promoted = True

    def cleanup(self) -> None:
        """Remove either staging or promoted state without masking the caller error."""

        for path in (self.staging_path, self.final_path):
            try:
                path.unlink(missing_ok=True)
            except OSError:
                logger.exception("failed to remove upload residue", extra={"path": str(path)})


async def stage_upload(
    upload: UploadFile,
    *,
    final_path: Path,
    max_bytes: int,
    empty_detail: str,
    chunk_bytes: int | None = None,
) -> StagedUpload:
    """Read bounded chunks into a same-directory staging file.

    Starlette has already parsed/spooled the multipart part before this helper
    runs. This is therefore the application read/durable-storage boundary, not
    a claim of network-ingress rejection.
    """

    read_size = chunk_bytes or settings.upload_read_chunk_bytes
    if max_bytes < 1 or read_size < 1:
        raise ValueError("upload byte limits must be positive")

    final_path.parent.mkdir(parents=True, exist_ok=True)
    staging_path = final_path.with_name(
        f".{final_path.name}.{uuid.uuid4().hex}.uploading"
    )
    total = 0
    handle = staging_path.open("xb")
    try:
        while True:
            chunk = await upload.read(read_size)
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                raise HTTPException(
                    413,
                    f"File exceeds {_size_label(max_bytes)} limit",
                )
            await asyncio.to_thread(handle.write, chunk)

        if total == 0:
            raise HTTPException(400, empty_detail)
        await asyncio.to_thread(handle.flush)
        await asyncio.to_thread(os.fsync, handle.fileno())
    except BaseException:
        handle.close()
        staging_path.unlink(missing_ok=True)
        raise
    else:
        handle.close()

    return StagedUpload(
        staging_path=staging_path,
        final_path=final_path,
        size=total,
    )


async def rollback_and_cleanup_upload(
    db: AsyncSession,
    staged: StagedUpload,
) -> None:
    """Best-effort bounded rollback followed by unconditional blob cleanup."""

    try:
        await asyncio.wait_for(
            db.rollback(),
            timeout=settings.upload_cleanup_timeout_seconds,
        )
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.exception("upload transaction rollback failed")
    finally:
        staged.cleanup()


async def close_upload(upload: UploadFile) -> None:
    """Close the parser-owned upload handle on every route terminal path."""

    try:
        await upload.close()
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.exception("failed to close upload handle")
