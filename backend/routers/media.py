"""Media CRUD, import, rating, soft-delete endpoints."""
from __future__ import annotations

import asyncio
import json
import os
import subprocess
import uuid
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from config import get_settings

from database import get_db
from models.album import Album
from models.media import Media
from models.person import Person

router = APIRouter()

# Track background import jobs: token -> {"total": n, "done": n, "errors": []}
_import_jobs: dict[str, dict] = {}

SUPPORTED_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tiff", ".tif", ".avif", ".mp4", ".mov", ".avi", ".mkv", ".webm"}


class ScanRequest(BaseModel):
    paths: List[str]
    recursive: bool = True


class ImportRequest(BaseModel):
    paths: List[str]
    person_id: Optional[str] = None
    album_id: Optional[str] = None
    recursive: bool = True  # False = only direct files in directory, no subdirs


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
    # Parse generation_params JSON safely
    gen_params = None
    if m.generation_params:
        try:
            gen_params = json.loads(m.generation_params)
        except (json.JSONDecodeError, TypeError):
            gen_params = None
    return {
        "id": m.id,
        "album_id": m.album_id,
        "person_id": m.person_id,
        "file_path": m.file_path,
        "media_type": m.media_type,
        "source_type": m.source_type,
        "parent_media_id": m.parent_media_id,
        "workflow_type": m.workflow_type,
        "generation_params": gen_params,
        "video_timestamp": m.video_timestamp,
        "rating": m.rating,
        "sort_order": m.sort_order,
        "thumbnail_path": m.thumbnail_path,
        "width": m.width,
        "height": m.height,
        "file_size": m.file_size,
        "playback_position": m.playback_position,
        "is_deleted": m.is_deleted,
        "deleted_at": m.deleted_at.isoformat() + "Z" if m.deleted_at else None,
        "created_at": m.created_at.isoformat() + "Z",
        "updated_at": m.updated_at.isoformat() + "Z",
    }


def _resolve_paths(paths: List[str], recursive: bool = True) -> List[str]:
    """Expand dirs to individual files.  When recursive=False, only direct children are included."""
    result = []
    for p in paths:
        if os.path.isdir(p):
            if recursive:
                for root, _, files in os.walk(p):
                    for f in files:
                        fp = os.path.join(root, f)
                        if Path(fp).suffix.lower() in SUPPORTED_EXTS:
                            result.append(fp)
            else:
                for f in os.listdir(p):
                    fp = os.path.join(p, f)
                    if os.path.isfile(fp) and Path(fp).suffix.lower() in SUPPORTED_EXTS:
                        result.append(fp)
        elif os.path.isfile(p) and Path(p).suffix.lower() in SUPPORTED_EXTS:
            result.append(p)
    return result


class ListFilesRequest(BaseModel):
    paths: List[str]
    recursive: bool = True


@router.post("/list-files")
def list_files(body: ListFilesRequest, db: Session = Depends(get_db)):
    """Resolve directories / file paths to individual media files."""
    files = _resolve_paths(body.paths, body.recursive)
    # Batch check which files already exist in DB
    existing_set: set[str] = set()
    chunk_size = 900
    for i in range(0, len(files), chunk_size):
        chunk = files[i:i + chunk_size]
        rows = db.execute(
            select(Media.file_path).where(Media.file_path.in_(chunk), Media.is_deleted == False)
        ).scalars().all()
        existing_set.update(rows)
    return {"files": [{"path": fp, "name": os.path.basename(fp), "media_type": _get_media_type(fp), "existing": fp in existing_set} for fp in files]}


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
            if job.get("cancelled"):
                job["status"] = "cancelled"
                break
            try:
                # Skip duplicates (active records)
                existing = db.execute(
                    select(Media).where(Media.file_path == fp, Media.is_deleted == False)
                ).scalar_one_or_none()
                if existing:
                    job["skipped"] += 1
                    job["done"] += 1
                    continue

                # Restore from recycle bin if soft-deleted record exists
                deleted = db.execute(
                    select(Media).where(Media.file_path == fp, Media.is_deleted == True)
                ).scalar_one_or_none()
                if deleted:
                    deleted.is_deleted = False
                    deleted.deleted_at = None
                    deleted.person_id = effective_person_id
                    deleted.album_id = album_id
                    db.commit()
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


@router.post("/scan")
def scan_paths(body: ScanRequest, db: Session = Depends(get_db)):
    """Scan paths and return total media file count + already-imported count per path.

    Each path can be a directory or a file.  For directories, files are resolved
    using the ``recursive`` flag.  Results are returned per-path so the frontend
    can display per-subfolder stats.  A summary entry with ``path="_total"`` is
    appended when multiple paths are provided.
    """
    results = []
    grand_total = 0
    grand_existing = 0
    for p in body.paths:
        files = _resolve_paths([p], recursive=body.recursive)
        total = len(files)
        if total == 0:
            results.append({"path": p, "total": 0, "existing": 0})
            continue
        # Batch query: count files that already exist in DB (chunk to avoid
        # SQLite variable limit of 999)
        existing = 0
        chunk_size = 900
        for i in range(0, len(files), chunk_size):
            chunk = files[i:i + chunk_size]
            existing += db.execute(
                select(func.count()).select_from(Media)
                .where(Media.file_path.in_(chunk), Media.is_deleted == False)
            ).scalar() or 0
        results.append({"path": p, "total": total, "existing": existing})
        grand_total += total
        grand_existing += existing
    if len(body.paths) > 1:
        results.append({"path": "_total", "total": grand_total, "existing": grand_existing})
    return {"results": results}


@router.post("/import")
async def import_media(body: ImportRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    if body.person_id and not db.get(Person, body.person_id):
        raise HTTPException(status_code=404, detail="Person not found")
    if body.album_id and not db.get(Album, body.album_id):
        raise HTTPException(status_code=404, detail="Album not found")

    files = _resolve_paths(body.paths, recursive=body.recursive)
    if not files:
        raise HTTPException(status_code=400, detail="No supported media files found in the given paths")

    token = str(uuid.uuid4())
    _import_jobs[token] = {"total": len(files), "done": 0, "skipped": 0, "errors": [], "status": "running", "cancelled": False}

    if len(files) > 500:
        # Background for large batches
        background_tasks.add_task(_do_import, files, body.person_id, body.album_id, token)
        return {"token": token, "total": len(files), "mode": "background"}
    else:
        # Inline for small batches
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _do_import, files, body.person_id, body.album_id, token)
        job = _import_jobs[token]
        return {"token": token, "total": job["total"], "done": job["done"], "skipped": job["skipped"], "errors": job["errors"], "mode": "sync"}


@router.get("/import/{token}")
def get_import_status(token: str):
    job = _import_jobs.get(token)
    if not job:
        raise HTTPException(status_code=404, detail="Import job not found")
    return job


@router.post("/import/{token}/cancel")
def cancel_import(token: str):
    job = _import_jobs.get(token)
    if not job:
        raise HTTPException(status_code=404, detail="Import job not found")
    job["cancelled"] = True
    return {"status": "cancelling"}


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
    sort_dir: str = Query("desc", regex="^(asc|desc)$"),
    source_type: Optional[str] = Query(None),
    filter_rating: Optional[str] = Query(None),
    media_type: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    if not db.get(Album, album_id):
        raise HTTPException(status_code=404, detail="Album not found")
    q = select(Media).where(Media.album_id == album_id, Media.is_deleted == False)
    q = _apply_filters(q, source_type, filter_rating, media_type)
    q = _apply_sort(q, sort, sort_dir)
    items = [_media_dict(m) for m in db.execute(q).scalars().all()]
    return _reorder_with_children(items) if not source_type else items


@router.get("/person/{person_id}/loose")
def list_loose_media(
    person_id: str,
    sort: str = Query("created_at", regex="^(sort_order|created_at|rating)$"),
    sort_dir: str = Query("desc", regex="^(asc|desc)$"),
    source_type: Optional[str] = Query(None),
    filter_rating: Optional[str] = Query(None),
    media_type: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    if not db.get(Person, person_id):
        raise HTTPException(status_code=404, detail="Person not found")
    q = select(Media).where(Media.person_id == person_id, Media.album_id.is_(None), Media.is_deleted == False)
    q = _apply_filters(q, source_type, filter_rating, media_type)
    q = _apply_sort(q, sort, sort_dir)
    items = [_media_dict(m) for m in db.execute(q).scalars().all()]
    return _reorder_with_children(items) if not source_type else items


@router.get("/uncategorized")
def list_uncategorized_media(
    sort: str = Query("created_at", regex="^(sort_order|created_at|rating)$"),
    sort_dir: str = Query("desc", regex="^(asc|desc)$"),
    source_type: Optional[str] = Query(None),
    filter_rating: Optional[str] = Query(None),
    media_type: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """List media not associated with any person."""
    q = select(Media).where(Media.person_id.is_(None), Media.is_deleted == False)
    q = _apply_filters(q, source_type, filter_rating, media_type)
    q = _apply_sort(q, sort, sort_dir)
    items = [_media_dict(m) for m in db.execute(q).scalars().all()]
    return _reorder_with_children(items) if not source_type else items


@router.get("/uncategorized/count")
def count_uncategorized_media(db: Session = Depends(get_db)):
    """Return the count of media not associated with any person."""
    count = db.execute(
        select(func.count(Media.id)).where(Media.person_id.is_(None), Media.is_deleted == False)
    ).scalar() or 0
    return {"count": count}


@router.get("/explore")
def explore_media(
    person_id: Optional[str] = Query(None),
    album_id: Optional[str] = Query(None),
    filter_rating: Optional[str] = Query(None),
    source_type: Optional[str] = Query(None),
    media_type: Optional[str] = Query(None),
    limit: Optional[int] = Query(None, ge=1, le=500),
    db: Session = Depends(get_db),
):
    """Return media matching scope.  When *limit* is given the result is a
    random sample of at most *limit* items (uses SQLite ``RANDOM()``).
    Without *limit* all matching rows are returned (used by cleanup, etc.)."""
    q = select(Media).where(Media.is_deleted == False)
    if album_id:
        q = q.where(Media.album_id == album_id)
    elif person_id:
        q = q.where(Media.person_id == person_id)
    q = _apply_filters(q, source_type, filter_rating, media_type)
    if limit:
        q = q.order_by(func.random()).limit(limit)
    items = db.execute(q).scalars().all()
    return [_media_dict(m) for m in items]


class CheckFilesRequest(BaseModel):
    ids: List[str]


@router.post("/check-files")
def check_files(body: CheckFilesRequest, db: Session = Depends(get_db)):
    """Check which media files are missing on disk."""
    missing = []
    items = db.execute(
        select(Media).where(Media.id.in_(body.ids))
    ).scalars().all()
    for m in items:
        if not os.path.exists(m.file_path):
            missing.append(m.id)
    return {"missing": missing}


class ByIdsRequest(BaseModel):
    ids: List[str]


@router.post("/by-ids")
def get_media_by_ids(body: ByIdsRequest, db: Session = Depends(get_db)):
    """Batch fetch media items by their IDs."""
    if not body.ids:
        return []
    items = db.execute(
        select(Media).where(Media.id.in_(body.ids))
    ).scalars().all()
    return [_media_dict(m) for m in items]


@router.post("/fix-ownership")
def fix_ownership_constraints(db: Session = Depends(get_db)):
    """Fix media where person_id doesn't match album.person_id.

    This can happen with old face_swap results. Affected media will have their
    album_id cleared (becoming loose items under their person).
    """
    fixed = []
    media_with_album = db.execute(
        select(Media).where(
            Media.album_id.isnot(None),
            Media.is_deleted == False,
        )
    ).scalars().all()

    for m in media_with_album:
        album = db.get(Album, m.album_id)
        if not album:
            fixed.append({"id": m.id, "reason": "album_deleted", "old_album_id": m.album_id})
            m.album_id = None
        elif album.person_id and m.person_id and album.person_id != m.person_id:
            fixed.append({
                "id": m.id,
                "reason": "person_mismatch",
                "media_person_id": m.person_id,
                "album_person_id": album.person_id,
                "old_album_id": m.album_id,
            })
            m.album_id = None

    if fixed:
        db.commit()

    return {"fixed_count": len(fixed), "fixed": fixed}


@router.get("/{mid}/nav-context")
def get_nav_context(
    mid: str,
    sort: str = Query("sort_order", regex="^(sort_order|created_at|rating)$"),
    sort_dir: str = Query("asc", regex="^(asc|desc)$"),
    source_type: Optional[str] = Query(None),
    filter_rating: Optional[str] = Query(None),
    media_type: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """Return navigation context for LightBox dual-axis navigation."""
    m = db.get(Media, mid)
    if not m or m.is_deleted:
        raise HTTPException(status_code=404, detail="Media not found")

    album_id = m.album_id
    person_id = m.person_id

    # Local items in the current scope, respecting the caller's sort/filter
    local_items = []
    if album_id:
        q = select(Media).where(
            Media.album_id == album_id,
            Media.is_deleted == False,
        )
        # Default source_type to "local" if not explicitly provided
        q = _apply_filters(q, source_type or "local", filter_rating, media_type)
        q = _apply_sort(q, sort, sort_dir)
        local_items = [_media_dict(x) for x in db.execute(q).scalars().all()]
    elif person_id:
        # Loose items for this person
        q = select(Media).where(
            Media.person_id == person_id,
            Media.album_id.is_(None),
            Media.is_deleted == False,
        )
        q = _apply_filters(q, source_type or "local", filter_rating, media_type)
        q = _apply_sort(q, sort if sort != "sort_order" else "created_at", sort_dir)
        local_items = [_media_dict(x) for x in db.execute(q).scalars().all()]

    # Album order for this person
    album_order = []
    if person_id:
        q = select(Album.id).where(Album.person_id == person_id).order_by(Album.created_at.desc())
        album_order = [row[0] for row in db.execute(q).all()]

    # Person order
    q = select(Person.id).order_by(Person.created_at.desc())
    person_order = [row[0] for row in db.execute(q).all()]

    return {
        "album_id": album_id,
        "person_id": person_id,
        "local_items": local_items,
        "album_order": album_order,
        "person_order": person_order,
    }


@router.get("/{mid}")
def get_media(mid: str, db: Session = Depends(get_db)):
    m = db.get(Media, mid)
    if not m or m.is_deleted:
        raise HTTPException(status_code=404, detail="Media not found")
    return _media_dict(m)


@router.patch("/batch")
def batch_update_media(body: BatchUpdate, db: Session = Depends(get_db)):
    updated = []
    old_person_ids = set()
    old_album_ids = set()
    for mid in body.ids:
        m = db.get(Media, mid)
        if not m or m.is_deleted:
            continue
        if m.person_id:
            old_person_ids.add(m.person_id)
        if m.album_id:
            old_album_ids.add(m.album_id)
        _apply_media_update(m, body, db)
        updated.append(mid)
    db.commit()
    # Recalc ratings for affected albums/persons (new)
    _recalc_from_ids(body.ids, db)
    # Also recalc old albums/persons that lost media
    for aid in old_album_ids:
        _recalc_album_rating(aid, db)
    for pid in old_person_ids:
        _recalc_person_rating(pid, db)
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


@router.patch("/{mid}/progress", status_code=204)
def save_playback_progress(mid: str, position: float = Query(...), db: Session = Depends(get_db)):
    """Lightweight endpoint to save video playback position."""
    m = db.get(Media, mid)
    if not m or m.is_deleted:
        raise HTTPException(status_code=404, detail="Media not found")
    m.playback_position = position if position > 0 else None
    db.commit()


@router.get("/{mid}/descendants-count")
def get_descendants_count(mid: str, db: Session = Depends(get_db)):
    """Return the number of non-deleted descendants of a media item."""
    m = db.get(Media, mid)
    if not m:
        raise HTTPException(status_code=404, detail="Media not found")
    count = _count_descendants(mid, db)
    return {"count": count}


def _count_descendants(mid: str, db: Session, depth: int = 0) -> int:
    if depth > 10:
        return 0
    children = db.execute(
        select(Media).where(Media.parent_media_id == mid, Media.is_deleted == False)
    ).scalars().all()
    total = len(children)
    for child in children:
        total += _count_descendants(child.id, db, depth + 1)
    return total


@router.delete("/{mid}", status_code=204)
def soft_delete_media(
    mid: str,
    mode: str = Query("cascade", regex="^(cascade|reparent)$"),
    db: Session = Depends(get_db),
):
    """Soft-delete a media item.

    mode=cascade: also delete all descendants (default).
    mode=reparent: reparent children to this item's parent, then delete only this item.
    """
    m = db.get(Media, mid)
    if not m:
        raise HTTPException(status_code=404, detail="Media not found")
    if mode == "reparent":
        _soft_delete_reparent(mid, db)
    else:
        _soft_delete_recursive(mid, db)
    db.commit()
    _update_ratings(m.person_id, m.album_id, db)


def _soft_delete_reparent(mid: str, db: Session) -> None:
    """Soft-delete a single media item and reparent its children to its parent."""
    m = db.get(Media, mid)
    if not m or m.is_deleted:
        return
    new_parent = m.parent_media_id  # may be None (root)
    # Reparent children
    children = db.execute(
        select(Media).where(Media.parent_media_id == mid, Media.is_deleted == False)
    ).scalars().all()
    for child in children:
        child.parent_media_id = new_parent
        child.updated_at = datetime.utcnow()
    # Now soft-delete the item itself
    m.is_deleted = True
    m.deleted_at = datetime.utcnow()
    _handle_screenshot_thumbnail(m, db)


def _soft_delete_recursive(mid: str, db: Session, depth: int = 0) -> None:
    """Soft-delete a media and all its generation chain descendants."""
    if depth > 10:
        return
    m = db.get(Media, mid)
    if not m or m.is_deleted:
        return
    m.is_deleted = True
    m.deleted_at = datetime.utcnow()
    _handle_screenshot_thumbnail(m, db)
    children = db.execute(
        select(Media).where(Media.parent_media_id == mid, Media.is_deleted == False)
    ).scalars().all()
    for child in children:
        _soft_delete_recursive(child.id, db, depth + 1)


def _handle_screenshot_thumbnail(m: Media, db: Session) -> None:
    """If this is a screenshot used as a video's thumbnail, update the parent."""
    if m.source_type == "screenshot" and m.parent_media_id:
        parent = db.get(Media, m.parent_media_id)
        if parent and parent.media_type == "video" and parent.thumbnail_path == m.file_path:
            next_screenshot = db.execute(
                select(Media).where(
                    Media.parent_media_id == parent.id,
                    Media.source_type == "screenshot",
                    Media.is_deleted == False,
                    Media.id != m.id,
                ).order_by(Media.created_at.asc())
            ).scalars().first()
            parent.thumbnail_path = next_screenshot.file_path if next_screenshot else None
            parent.updated_at = datetime.utcnow()


@router.post("/{mid}/detach")
def detach_media(mid: str, db: Session = Depends(get_db)):
    """Detach media from its generation chain.

    The detached media becomes a local item (source_type='local').
    Its descendants (children, grandchildren, ...) stay attached to it,
    forming a new independent generation tree.
    """
    m = db.get(Media, mid)
    if not m or m.is_deleted:
        raise HTTPException(status_code=404, detail="Media not found")
    m.parent_media_id = None
    m.workflow_type = None
    m.generation_params = None
    m.source_type = "local"
    m.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(m)
    return _media_dict(m)


@router.get("/{mid}/tree")
def get_generation_tree(mid: str, db: Session = Depends(get_db)):
    m = db.get(Media, mid)
    if not m:
        raise HTTPException(status_code=404, detail="Media not found")
    # Walk up to find the true root of the generation chain
    root = m
    depth = 0
    while root.parent_media_id and depth < 10:
        parent = db.get(Media, root.parent_media_id)
        if not parent:
            break
        root = parent
        depth += 1
    return {"root": _build_tree(root.id, db, depth=0)}


@router.post("/{mid}/upload-mask")
async def upload_mask(mid: str, file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Save an RGBA PNG mask for inpainting. Returns the mask file path."""
    m = db.get(Media, mid)
    if not m or m.is_deleted:
        raise HTTPException(status_code=404, detail="Media not found")
    settings = get_settings()
    masks_dir = settings.masks_dir()
    masks_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{mid}_{uuid.uuid4().hex[:8]}.png"
    mask_path = masks_dir / filename
    data = await file.read()
    mask_path.write_bytes(data)
    return {"mask_path": str(mask_path)}


@router.post("/{mid}/show-in-explorer", status_code=204)
def show_in_explorer(mid: str, db: Session = Depends(get_db)):
    m = db.get(Media, mid)
    if not m:
        raise HTTPException(status_code=404, detail="Media not found")
    path = m.file_path
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="File not found on disk")
    subprocess.Popen(["explorer", "/select,", os.path.normpath(path)])


@router.post("/{mid}/screenshot")
async def capture_screenshot(
    mid: str,
    file: UploadFile = File(...),
    timestamp: Optional[float] = Form(None),
    db: Session = Depends(get_db),
):
    """Save a video frame screenshot as a new Media record."""
    m = db.get(Media, mid)
    if not m:
        raise HTTPException(status_code=404, detail="Media not found")
    settings = get_settings()
    out_dir = settings.generated_dir("screenshot")
    out_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}.png"
    out_path = out_dir / filename
    data = await file.read()
    out_path.write_bytes(data)
    new_media = Media(
        id=uuid.uuid4().hex,
        person_id=m.person_id,
        album_id=m.album_id,
        file_path=str(out_path),
        media_type="image",
        source_type="screenshot",
        parent_media_id=m.id,
        video_timestamp=timestamp,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(new_media)
    # Auto-set video thumbnail to first screenshot
    if m.media_type == "video" and not m.thumbnail_path:
        m.thumbnail_path = str(out_path)
        m.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(new_media)
    return _media_dict(new_media)


class BatchDeleteRequest(BaseModel):
    ids: List[str]
    mode: str = "cascade"  # cascade | reparent


@router.post("/batch-delete", status_code=200)
def batch_delete(body: BatchDeleteRequest, db: Session = Depends(get_db)):
    deleted = []
    person_ids = set()
    album_ids = set()
    delete_fn = _soft_delete_reparent if body.mode == "reparent" else _soft_delete_recursive
    for mid in body.ids:
        m = db.get(Media, mid)
        if m and not m.is_deleted:
            if m.person_id:
                person_ids.add(m.person_id)
            if m.album_id:
                album_ids.add(m.album_id)
            delete_fn(m.id, db)
            deleted.append(mid)
    db.commit()
    for pid in person_ids:
        _update_ratings(pid, None, db)
    for aid in album_ids:
        _update_ratings(None, aid, db)
    return {"deleted": deleted}


@router.post("/batch-detach")
def batch_detach(body: BatchDeleteRequest, db: Session = Depends(get_db)):
    """Batch detach media from their generation chains."""
    detached = []
    for mid in body.ids:
        m = db.get(Media, mid)
        if m and not m.is_deleted and m.parent_media_id:
            m.parent_media_id = None
            m.workflow_type = None
            m.generation_params = None
            m.source_type = "local"
            m.updated_at = datetime.utcnow()
            detached.append(mid)
    if detached:
        db.commit()
    return {"detached": detached}


class RelocateRequest(BaseModel):
    new_path: str


@router.patch("/{mid}/relocate")
def relocate_media(mid: str, body: RelocateRequest, db: Session = Depends(get_db)):
    m = db.get(Media, mid)
    if not m:
        raise HTTPException(status_code=404, detail="Media not found")
    if not os.path.exists(body.new_path):
        raise HTTPException(status_code=400, detail="New path does not exist")
    m.file_path = body.new_path
    m.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(m)
    return _media_dict(m)


class BatchRelocateRequest(BaseModel):
    old_prefix: str
    new_prefix: str
    scope: Optional[str] = None  # person_id or album_id


@router.post("/batch-relocate")
def batch_relocate(body: BatchRelocateRequest, db: Session = Depends(get_db)):
    q = select(Media).where(Media.is_deleted == False, Media.file_path.startswith(body.old_prefix))
    if body.scope:
        q = q.where((Media.person_id == body.scope) | (Media.album_id == body.scope))
    items = db.execute(q).scalars().all()
    updated = 0
    for m in items:
        new_path = body.new_prefix + m.file_path[len(body.old_prefix):]
        if os.path.exists(new_path):
            m.file_path = new_path
            m.updated_at = datetime.utcnow()
            updated += 1
    db.commit()
    return {"updated": updated}


@router.post("/upload-files")
async def upload_files(
    files: List[UploadFile] = File(...),
    person_id: Optional[str] = Form(None),
    album_id: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    """Save uploaded files to AppData/imports/upload/ and create Media records.
    Used by mobile browsers where tkinter file picker is unavailable."""
    if person_id and not db.get(Person, person_id):
        raise HTTPException(status_code=404, detail="Person not found")
    if album_id and not db.get(Album, album_id):
        raise HTTPException(status_code=404, detail="Album not found")

    # Enforce person_id consistency
    effective_person_id = person_id or None
    if album_id:
        album = db.get(Album, album_id)
        if album and album.person_id:
            effective_person_id = album.person_id

    settings = get_settings()
    out_dir = settings.imports_dir("upload")
    out_dir.mkdir(parents=True, exist_ok=True)

    media_ids = []
    for i, f in enumerate(files):
        ext = Path(f.filename or "file").suffix.lower()
        if ext not in SUPPORTED_EXTS:
            continue
        filename = f"{uuid.uuid4().hex}{ext}"
        out_path = out_dir / filename
        data = await f.read()
        out_path.write_bytes(data)

        media_type = "video" if ext in {".mp4", ".mov", ".avi", ".mkv", ".webm"} else "image"
        width, height = None, None
        if media_type == "image":
            try:
                from PIL import Image as PILImage
                with PILImage.open(str(out_path)) as img:
                    width, height = img.size
            except Exception:
                pass

        m = Media(
            id=uuid.uuid4().hex,
            person_id=effective_person_id,
            album_id=album_id or None,
            file_path=str(out_path),
            media_type=media_type,
            source_type="local",
            sort_order=i,
            file_size=len(data),
            width=width,
            height=height,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        db.add(m)
        media_ids.append(m.id)

    db.commit()

    # Update ratings
    _update_ratings(effective_person_id, album_id or None, db)

    return {"imported": len(media_ids), "media_ids": media_ids}


@router.post("/import-clipboard")
async def import_clipboard(
    file: UploadFile = File(...),
    person_id: Optional[str] = Form(None),
    album_id: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    """Save clipboard image to AppData/imports/clipboard/ and create Media record."""
    settings = get_settings()
    out_dir = settings.imports_dir("clipboard")
    out_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}.png"
    out_path = out_dir / filename
    data = await file.read()
    out_path.write_bytes(data)
    new_media = Media(
        id=uuid.uuid4().hex,
        person_id=person_id or None,
        album_id=album_id or None,
        file_path=str(out_path),
        media_type="image",
        source_type="screenshot",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(new_media)
    db.commit()
    db.refresh(new_media)
    return _media_dict(new_media)


def _build_tree(mid: str, db: Session, depth: int) -> dict:
    if depth > 10:
        return {}
    m = db.get(Media, mid)
    if not m:
        return {}
    children_q = select(Media).where(
        Media.parent_media_id == mid, Media.is_deleted == False
    ).order_by(Media.created_at.asc())
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


def _apply_filters(q, source_type: Optional[str], filter_rating: Optional[str], media_type: Optional[str] = None):
    if source_type:
        q = q.where(Media.source_type == source_type)
    if media_type:
        q = q.where(Media.media_type == media_type)
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


def _apply_sort(q, sort: str, sort_dir: str = "desc"):
    from sqlalchemy import asc as sa_asc, desc as sa_desc
    direction = sa_asc if sort_dir == "asc" else sa_desc
    if sort == "rating":
        col = direction(Media.rating)
        col = col.nullslast() if sort_dir == "desc" else col.nullsfirst()
        return q.order_by(col, Media.created_at.desc())
    elif sort == "created_at":
        return q.order_by(direction(Media.created_at))
    else:
        return q.order_by(direction(Media.sort_order))


def _reorder_with_children(items: list) -> list:
    """Reorder a flat media list so that children follow their parent in DFS order.

    Root items (no parent_media_id, or parent not in list) keep their original
    relative order.  Children of the same parent are sorted by created_at asc.
    """
    id_set = {item["id"] for item in items}
    children_map: dict[str, list] = {}
    roots: list = []

    for item in items:
        pid = item.get("parent_media_id")
        if pid and pid in id_set:
            children_map.setdefault(pid, []).append(item)
        else:
            roots.append(item)

    # Sort children by created_at so siblings are chronological
    for pid in children_map:
        children_map[pid].sort(key=lambda x: x.get("created_at", ""))

    result: list = []

    def _dfs(item: dict) -> None:
        result.append(item)
        for child in children_map.get(item["id"], []):
            _dfs(child)

    for root in roots:
        _dfs(root)

    return result


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


# ── Crop & Trim endpoints ─────────────────────────────────────────────


@router.post("/{mid}/crop")
async def crop_media(
    mid: str,
    file: UploadFile = File(...),
    overwrite: bool = Form(False),
    person_id: Optional[str] = Form(None),
    album_id: Optional[str] = Form(None),
    link_parent: bool = Form(True),
    db: Session = Depends(get_db),
):
    """Crop an image. overwrite=False creates new Media; overwrite=True replaces original."""
    m = db.get(Media, mid)
    if not m or m.is_deleted:
        raise HTTPException(status_code=404, detail="Media not found")
    if m.media_type != "image":
        raise HTTPException(status_code=400, detail="Only images can be cropped")

    settings = get_settings()
    out_dir = settings.generated_dir("crop")
    out_dir.mkdir(parents=True, exist_ok=True)
    ext = Path(m.file_path).suffix.lower() or ".png"
    filename = f"{uuid.uuid4().hex}{ext}"
    out_path = out_dir / filename
    data = await file.read()
    out_path.write_bytes(data)

    # Get dimensions of cropped image
    width, height, file_size = None, None, len(data)
    try:
        from PIL import Image as PILImage
        with PILImage.open(out_path) as img:
            width, height = img.size
    except Exception:
        pass

    if overwrite:
        # Save original path in generation_params
        gen_params = {}
        if m.generation_params:
            try:
                gen_params = json.loads(m.generation_params)
            except (json.JSONDecodeError, TypeError):
                pass
        gen_params["original_path"] = m.file_path
        m.file_path = str(out_path)
        m.width = width
        m.height = height
        m.file_size = file_size
        m.generation_params = json.dumps(gen_params)
        m.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(m)
        _update_ratings(m.person_id, m.album_id, db)
        return _media_dict(m)
    else:
        final_person_id = person_id or m.person_id
        final_album_id = album_id or m.album_id
        new_media = Media(
            id=uuid.uuid4().hex,
            person_id=final_person_id,
            album_id=final_album_id,
            file_path=str(out_path),
            media_type="image",
            source_type="screenshot",
            parent_media_id=m.id if link_parent else None,
            workflow_type="crop",
            width=width,
            height=height,
            file_size=file_size,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        db.add(new_media)
        db.commit()
        db.refresh(new_media)
        _update_ratings(new_media.person_id, new_media.album_id, db)
        return _media_dict(new_media)


@router.post("/{mid}/upload-crop")
async def upload_crop(mid: str, file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Save a temporary cropped image for workflow input. Returns the crop file path."""
    m = db.get(Media, mid)
    if not m or m.is_deleted:
        raise HTTPException(status_code=404, detail="Media not found")
    settings = get_settings()
    crops_dir = settings.crops_cache_dir()
    crops_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{mid}_{uuid.uuid4().hex[:8]}.png"
    crop_path = crops_dir / filename
    data = await file.read()
    crop_path.write_bytes(data)
    return {"crop_path": str(crop_path)}


class TrimRequest(BaseModel):
    start: float
    end: float
    precise: bool = False
    person_id: Optional[str] = None
    album_id: Optional[str] = None
    link_parent: bool = True


@router.post("/{mid}/trim")
def trim_video(mid: str, body: TrimRequest, db: Session = Depends(get_db)):
    """Trim a video segment. precise=True re-encodes for frame-accurate cuts."""
    m = db.get(Media, mid)
    if not m or m.is_deleted:
        raise HTTPException(status_code=404, detail="Media not found")
    if m.media_type != "video":
        raise HTTPException(status_code=400, detail="Only videos can be trimmed")
    if body.start >= body.end:
        raise HTTPException(status_code=400, detail="start must be less than end")
    if not os.path.exists(m.file_path):
        raise HTTPException(status_code=404, detail="Source file not found on disk")

    settings = get_settings()
    out_dir = settings.generated_dir("trim")
    out_dir.mkdir(parents=True, exist_ok=True)
    ext = Path(m.file_path).suffix.lower() or ".mp4"
    filename = f"{uuid.uuid4().hex}{ext}"
    out_path = out_dir / filename

    ffmpeg = settings.ffmpeg_path()
    if body.precise:
        cmd = [ffmpeg, "-i", m.file_path, "-ss", str(body.start), "-to", str(body.end),
               "-c:v", "libx264", "-c:a", "aac", "-y", str(out_path)]
    else:
        cmd = [ffmpeg, "-ss", str(body.start), "-to", str(body.end),
               "-i", m.file_path, "-c", "copy", "-y", str(out_path)]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if result.returncode != 0:
            raise HTTPException(status_code=500, detail=f"ffmpeg error: {result.stderr[-500:]}")
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="ffmpeg timed out")

    file_size = out_path.stat().st_size if out_path.exists() else None

    final_person_id = body.person_id or m.person_id
    final_album_id = body.album_id or m.album_id
    new_media = Media(
        id=uuid.uuid4().hex,
        person_id=final_person_id,
        album_id=final_album_id,
        file_path=str(out_path),
        media_type="video",
        source_type="screenshot",
        parent_media_id=m.id if body.link_parent else None,
        workflow_type="trim",
        generation_params=json.dumps({"start": body.start, "end": body.end, "precise": body.precise}),
        file_size=file_size,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(new_media)
    db.commit()
    db.refresh(new_media)
    return _media_dict(new_media)
