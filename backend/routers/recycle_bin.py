"""Recycle bin endpoints."""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from config import get_settings
from database import get_db
from models.album import Album
from models.media import Media
from models.person import Person

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("")
def list_recycle_bin(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    sort: str = Query("deleted_at", regex="^(deleted_at|rating|file_path)$"),
    db: Session = Depends(get_db),
):
    total = db.execute(
        select(func.count(Media.id)).where(Media.is_deleted == True)
    ).scalar() or 0
    q = select(Media).where(Media.is_deleted == True)

    if sort == "rating":
        q = q.order_by(Media.rating.desc().nullslast(), Media.deleted_at.desc())
    elif sort == "file_path":
        q = q.order_by(Media.file_path.asc())
    else:
        q = q.order_by(Media.deleted_at.desc())

    items = db.execute(q.offset((page - 1) * page_size).limit(page_size)).scalars().all()

    settings = get_settings()
    retention_days = settings.recycle_bin_days

    # Build person and album name lookups
    person_ids = {m.person_id for m in items if m.person_id}
    album_ids = {m.album_id for m in items if m.album_id}
    person_names = {}
    album_names = {}
    if person_ids:
        for p in db.execute(select(Person).where(Person.id.in_(person_ids))).scalars():
            person_names[p.id] = p.name
    if album_ids:
        for a in db.execute(select(Album).where(Album.id.in_(album_ids))).scalars():
            album_names[a.id] = a.name

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [_media_dict(m, person_names, album_names, retention_days) for m in items],
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


def _media_dict(m: Media, person_names: dict = {}, album_names: dict = {}, retention_days: int = 30) -> dict:
    days_until_auto_delete = None
    if retention_days > 0 and m.deleted_at:
        remaining = retention_days - (datetime.utcnow() - m.deleted_at).days
        days_until_auto_delete = max(0, remaining)

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
        "person_name": person_names.get(m.person_id) if m.person_id else None,
        "album_name": album_names.get(m.album_id) if m.album_id else None,
        "days_until_auto_delete": days_until_auto_delete,
    }
