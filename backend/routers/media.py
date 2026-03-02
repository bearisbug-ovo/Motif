"""Media CRUD, import, rating, soft-delete endpoints."""
from __future__ import annotations

import asyncio
import json
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from database import get_db
from models.album import Album
from models.media import Media
from models.person import Person

router = APIRouter()

# Track background import jobs: token -> {"total": n, "done": n, "errors": []}
_import_jobs: dict[str, dict] = {}

SUPPORTED_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tiff", ".tif", ".avif", ".mp4", ".mov", ".avi", ".mkv", ".webm"}


class ImportRequest(BaseModel):
    paths: List[str]
    person_id: Optional[str] = None
    album_id: Optional[str] = None


class MediaUpdate(BaseModel):
    rating: Optional[int] = None
    album_id: Optional[str] = None
    person_id: Optional[str] = None


class BatchUpdate(BaseModel):
    ids: List[str]
    rating: Optional[int] = None
    album_id: Optional[str] = None
    person_id: Optional[str] = None


def _media_dict(m: Media) -> dict:
    return {
        "id": m.id,
        "album_id": m.album_id,
        "person_id": m.person_id,
        "file_path": m.file_path,
        "media_type": m.media_type,
        "source_type": m.source_type,
        "parent_media_id": m.parent_media_id,
        "workflow_type": m.workflow_type,
        "upscale_status": m.upscale_status,
        "rating": m.rating,
        "sort_order": m.sort_order,
        "thumbnail_path": m.thumbnail_path,
        "width": m.width,
        "height": m.height,
        "file_size": m.file_size,
        "is_deleted": m.is_deleted,
        "deleted_at": m.deleted_at.isoformat() if m.deleted_at else None,
        "created_at": m.created_at.isoformat(),
        "updated_at": m.updated_at.isoformat(),
    }


def _resolve_paths(paths: List[str]) -> List[str]:
    """Expand dirs to individual files."""
    result = []
    for p in paths:
        if os.path.isdir(p):
            for root, _, files in os.walk(p):
                for f in files:
                    fp = os.path.join(root, f)
                    if Path(fp).suffix.lower() in SUPPORTED_EXTS:
                        result.append(fp)
        elif os.path.isfile(p) and Path(p).suffix.lower() in SUPPORTED_EXTS:
            result.append(p)
    return result


def _get_media_type(path: str) -> str:
    ext = Path(path).suffix.lower()
    return "video" if ext in {".mp4", ".mov", ".avi", ".mkv", ".webm"} else "image"


def _do_import(files: List[str], person_id: Optional[str], album_id: Optional[str], job_token: str) -> None:
    """Synchronous import performed in a thread pool."""
    from database import SessionLocal
    db = SessionLocal()
    try:
        # Enforce person_id consistency: if album has a person, use that
        effective_person_id = person_id
        if album_id:
            album = db.get(Album, album_id)
            if album and album.person_id:
                effective_person_id = album.person_id

        job = _import_jobs[job_token]
        for i, fp in enumerate(files):
            try:
                # Skip duplicates
                existing = db.execute(
                    select(Media).where(Media.file_path == fp, Media.is_deleted == False)
                ).scalar_one_or_none()
                if existing:
                    job["done"] += 1
                    continue

                stat = os.stat(fp)
                width, height = None, None
                if _get_media_type(fp) == "image":
                    try:
                        from PIL import Image as PILImage
                        with PILImage.open(fp) as img:
                            width, height = img.size
                    except Exception:
                        pass
                m = Media(
                    file_path=fp,
                    media_type=_get_media_type(fp),
                    source_type="local",
                    person_id=effective_person_id,
                    album_id=album_id,
                    sort_order=i,
                    file_size=stat.st_size,
                    width=width,
                    height=height,
                )
                db.add(m)
                db.commit()
            except Exception as e:
                job["errors"].append(str(e))
            job["done"] += 1
        job["status"] = "done"
        _update_ratings(person_id, album_id, db)
    finally:
        db.close()


def _update_ratings(person_id: Optional[str], album_id: Optional[str], db: Session) -> None:
    if album_id:
        _recalc_album_rating(album_id, db)
        a = db.get(Album, album_id)
        if a and a.person_id:
            _recalc_person_rating(a.person_id, db)
    elif person_id:
        _recalc_person_rating(person_id, db)


def _recalc_album_rating(album_id: str, db: Session) -> None:
    # Count all non-deleted images and sum of rated ones
    # Unrated items count as 2.5 in the average
    total_count = db.execute(
        select(func.count(Media.id))
        .where(Media.album_id == album_id, Media.is_deleted == False, Media.media_type == "image")
    ).scalar() or 0
    result = db.execute(
        select(func.sum(Media.rating), func.count(Media.rating))
        .where(Media.album_id == album_id, Media.is_deleted == False, Media.rating.isnot(None))
    ).first()
    rated_sum, rated_count = result
    a = db.get(Album, album_id)
    if a:
        if total_count > 0:
            unrated_count = total_count - (rated_count or 0)
            weighted_avg = ((rated_sum or 0) + unrated_count * 2.5) / total_count
            a.avg_rating = round(weighted_avg, 2)
        else:
            a.avg_rating = None
        a.rated_count = rated_count or 0
        db.commit()


def _recalc_person_rating(person_id: str, db: Session) -> None:
    # Count all non-deleted images and sum of rated ones
    # Unrated items count as 2.5 in the average
    total_count = db.execute(
        select(func.count(Media.id))
        .where(Media.person_id == person_id, Media.is_deleted == False, Media.media_type == "image")
    ).scalar() or 0
    result = db.execute(
        select(func.sum(Media.rating), func.count(Media.rating))
        .where(Media.person_id == person_id, Media.is_deleted == False, Media.rating.isnot(None))
    ).first()
    rated_sum, rated_count = result
    p = db.get(Person, person_id)
    if p:
        if total_count > 0:
            unrated_count = total_count - (rated_count or 0)
            weighted_avg = ((rated_sum or 0) + unrated_count * 2.5) / total_count
            p.avg_rating = round(weighted_avg, 2)
        else:
            p.avg_rating = None
        p.rated_count = rated_count or 0
        db.commit()


@router.post("/import")
async def import_media(body: ImportRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    if body.person_id and not db.get(Person, body.person_id):
        raise HTTPException(status_code=404, detail="Person not found")
    if body.album_id and not db.get(Album, body.album_id):
        raise HTTPException(status_code=404, detail="Album not found")

    files = _resolve_paths(body.paths)
    if not files:
        raise HTTPException(status_code=400, detail="No supported media files found in the given paths")

    token = str(uuid.uuid4())
    _import_jobs[token] = {"total": len(files), "done": 0, "errors": [], "status": "running"}

    if len(files) > 500:
        # Background for large batches
        background_tasks.add_task(_do_import, files, body.person_id, body.album_id, token)
        return {"token": token, "total": len(files), "mode": "background"}
    else:
        # Inline for small batches
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _do_import, files, body.person_id, body.album_id, token)
        job = _import_jobs[token]
        return {"token": token, "total": job["total"], "done": job["done"], "errors": job["errors"], "mode": "sync"}


@router.get("/import/{token}")
def get_import_status(token: str):
    job = _import_jobs.get(token)
    if not job:
        raise HTTPException(status_code=404, detail="Import job not found")
    return job


@router.post("/backfill-dimensions")
def backfill_dimensions(db: Session = Depends(get_db)):
    """Fill in missing width/height for existing image media."""
    from PIL import Image as PILImage
    updated = 0
    media_list = db.execute(
        select(Media).where(
            Media.is_deleted == False,
            Media.media_type == "image",
            Media.width.is_(None),
        )
    ).scalars().all()
    for m in media_list:
        try:
            if os.path.isfile(m.file_path):
                with PILImage.open(m.file_path) as img:
                    m.width, m.height = img.size
                    updated += 1
        except Exception:
            pass
    db.commit()
    return {"updated": updated, "total": len(media_list)}


@router.get("/album/{album_id}")
def list_album_media(
    album_id: str,
    sort: str = Query("sort_order", regex="^(sort_order|created_at|rating)$"),
    source_type: Optional[str] = Query(None),
    filter_rating: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    if not db.get(Album, album_id):
        raise HTTPException(status_code=404, detail="Album not found")
    q = select(Media).where(Media.album_id == album_id, Media.is_deleted == False)
    q = _apply_filters(q, source_type, filter_rating)
    q = _apply_sort(q, sort)
    return [_media_dict(m) for m in db.execute(q).scalars().all()]


@router.get("/person/{person_id}/loose")
def list_loose_media(
    person_id: str,
    sort: str = Query("created_at", regex="^(sort_order|created_at|rating)$"),
    source_type: Optional[str] = Query(None),
    filter_rating: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    if not db.get(Person, person_id):
        raise HTTPException(status_code=404, detail="Person not found")
    q = select(Media).where(Media.person_id == person_id, Media.album_id.is_(None), Media.is_deleted == False)
    q = _apply_filters(q, source_type, filter_rating)
    q = _apply_sort(q, sort)
    return [_media_dict(m) for m in db.execute(q).scalars().all()]


@router.get("/{mid}")
def get_media(mid: str, db: Session = Depends(get_db)):
    m = db.get(Media, mid)
    if not m or m.is_deleted:
        raise HTTPException(status_code=404, detail="Media not found")
    return _media_dict(m)


@router.patch("/batch")
def batch_update_media(body: BatchUpdate, db: Session = Depends(get_db)):
    updated = []
    for mid in body.ids:
        m = db.get(Media, mid)
        if not m or m.is_deleted:
            continue
        _apply_media_update(m, body, db)
        updated.append(mid)
    db.commit()
    # Recalc ratings for affected albums/persons
    _recalc_from_ids(body.ids, db)
    return {"updated": updated}


@router.patch("/{mid}")
def update_media(mid: str, body: MediaUpdate, db: Session = Depends(get_db)):
    m = db.get(Media, mid)
    if not m or m.is_deleted:
        raise HTTPException(status_code=404, detail="Media not found")
    old_album_id = m.album_id
    old_person_id = m.person_id
    _apply_media_update(m, body, db)
    db.commit()
    db.refresh(m)
    # Recalc old and new
    for aid in {old_album_id, m.album_id} - {None}:
        _recalc_album_rating(aid, db)
    for pid in {old_person_id, m.person_id} - {None}:
        _recalc_person_rating(pid, db)
    return _media_dict(m)


@router.delete("/{mid}", status_code=204)
def soft_delete_media(mid: str, db: Session = Depends(get_db)):
    m = db.get(Media, mid)
    if not m:
        raise HTTPException(status_code=404, detail="Media not found")
    _soft_delete_recursive(mid, db)
    db.commit()
    _update_ratings(m.person_id, m.album_id, db)


def _soft_delete_recursive(mid: str, db: Session, depth: int = 0) -> None:
    """Soft-delete a media and all its generation chain descendants."""
    if depth > 10:
        return
    m = db.get(Media, mid)
    if not m or m.is_deleted:
        return
    m.is_deleted = True
    m.deleted_at = datetime.utcnow()
    children = db.execute(
        select(Media).where(Media.parent_media_id == mid, Media.is_deleted == False)
    ).scalars().all()
    for child in children:
        _soft_delete_recursive(child.id, db, depth + 1)


@router.get("/{mid}/tree")
def get_generation_tree(mid: str, db: Session = Depends(get_db)):
    m = db.get(Media, mid)
    if not m:
        raise HTTPException(status_code=404, detail="Media not found")
    return {"root": _build_tree(mid, db, depth=0)}


def _build_tree(mid: str, db: Session, depth: int) -> dict:
    if depth > 10:
        return {}
    m = db.get(Media, mid)
    if not m:
        return {}
    children_q = select(Media).where(Media.parent_media_id == mid, Media.is_deleted == False)
    children = [_build_tree(c.id, db, depth + 1) for c in db.execute(children_q).scalars().all()]
    d = _media_dict(m)
    d["children"] = children
    return d


class ClearableMediaUpdate(BaseModel):
    """Used internally to distinguish 'rating: 0' (clear) from 'rating: null' (no change)."""
    rating: Optional[int] = None
    album_id: Optional[str] = None
    person_id: Optional[str] = None


def _apply_media_update(m: Media, body, db: Session) -> None:
    if body.rating is not None:
        if body.rating == 0:
            m.rating = None  # Clear rating
        elif 1 <= body.rating <= 5:
            m.rating = body.rating
        else:
            raise HTTPException(status_code=400, detail="rating must be 0 (clear) or 1-5")
    if body.album_id is not None:
        if body.album_id == "":
            m.album_id = None
        else:
            a = db.get(Album, body.album_id)
            if not a:
                raise HTTPException(status_code=404, detail="Album not found")
            m.album_id = body.album_id
            if a.person_id:
                m.person_id = a.person_id
    if body.person_id is not None:
        m.person_id = body.person_id if body.person_id else None


def _apply_filters(q, source_type: Optional[str], filter_rating: Optional[str]):
    if source_type:
        q = q.where(Media.source_type == source_type)
    if filter_rating:
        try:
            op, val = filter_rating.split(":", 1)
            val_int = int(val)
        except ValueError:
            raise HTTPException(status_code=400, detail="filter_rating format: op:value")
        if op == "eq":
            q = q.where(Media.rating == val_int)
        elif op == "gte":
            q = q.where(Media.rating >= val_int)
        elif op == "lte":
            q = q.where(Media.rating <= val_int)
    return q


def _apply_sort(q, sort: str):
    if sort == "rating":
        return q.order_by(Media.rating.desc().nullslast(), Media.created_at.desc())
    elif sort == "created_at":
        return q.order_by(Media.created_at.desc())
    else:
        return q.order_by(Media.sort_order.asc())


def _recalc_from_ids(ids: List[str], db: Session) -> None:
    album_ids = set()
    person_ids = set()
    for mid in ids:
        m = db.get(Media, mid)
        if m:
            if m.album_id:
                album_ids.add(m.album_id)
            if m.person_id:
                person_ids.add(m.person_id)
    for aid in album_ids:
        _recalc_album_rating(aid, db)
        a = db.get(Album, aid)
        if a and a.person_id:
            person_ids.add(a.person_id)
    for pid in person_ids:
        _recalc_person_rating(pid, db)
