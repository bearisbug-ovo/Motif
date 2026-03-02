"""Recycle bin endpoints."""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from database import get_db
from models.media import Media

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("")
def list_recycle_bin(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    total = db.execute(
        select(func.count(Media.id)).where(Media.is_deleted == True)
    ).scalar() or 0
    q = select(Media).where(Media.is_deleted == True).order_by(Media.deleted_at.desc())
    items = db.execute(q.offset((page - 1) * page_size).limit(page_size)).scalars().all()
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [_media_dict(m) for m in items],
    }


@router.post("/{mid}/restore", status_code=200)
def restore_media(mid: str, db: Session = Depends(get_db)):
    m = db.get(Media, mid)
    if not m or not m.is_deleted:
        raise HTTPException(status_code=404, detail="Deleted media not found")
    m.is_deleted = False
    m.deleted_at = None
    db.commit()
    return {"id": mid, "status": "restored"}


@router.delete("/{mid}", status_code=204)
def permanent_delete(mid: str, db: Session = Depends(get_db)):
    m = db.get(Media, mid)
    if not m or not m.is_deleted:
        raise HTTPException(status_code=404, detail="Deleted media not found")
    # Only delete physical file for generated/screenshot content (not local originals)
    if m.source_type in ("generated", "screenshot") and m.file_path and os.path.isfile(m.file_path):
        try:
            os.remove(m.file_path)
        except OSError:
            pass
    db.delete(m)
    db.commit()


@router.delete("", status_code=204)
def empty_recycle_bin(db: Session = Depends(get_db)):
    items = db.execute(select(Media).where(Media.is_deleted == True)).scalars().all()
    for m in items:
        if m.source_type in ("generated", "screenshot") and m.file_path and os.path.isfile(m.file_path):
            try:
                os.remove(m.file_path)
            except OSError:
                pass
        db.delete(m)
    db.commit()


def auto_cleanup_expired(db: Session, retention_days: int) -> int:
    """Permanently delete recycle bin items older than retention_days. Returns count deleted."""
    if retention_days <= 0:
        return 0
    cutoff = datetime.utcnow() - timedelta(days=retention_days)
    expired = db.execute(
        select(Media).where(Media.is_deleted == True, Media.deleted_at < cutoff)
    ).scalars().all()
    count = 0
    for m in expired:
        if m.source_type in ("generated", "screenshot") and m.file_path and os.path.isfile(m.file_path):
            try:
                os.remove(m.file_path)
            except OSError:
                pass
        db.delete(m)
        count += 1
    if count:
        db.commit()
        logger.info(f"Recycle bin auto-cleanup: permanently deleted {count} items older than {retention_days} days")
    return count


def _media_dict(m: Media) -> dict:
    return {
        "id": m.id,
        "album_id": m.album_id,
        "person_id": m.person_id,
        "file_path": m.file_path,
        "media_type": m.media_type,
        "source_type": m.source_type,
        "rating": m.rating,
        "thumbnail_path": m.thumbnail_path,
        "is_deleted": m.is_deleted,
        "deleted_at": m.deleted_at.isoformat() if m.deleted_at else None,
        "created_at": m.created_at.isoformat(),
    }
