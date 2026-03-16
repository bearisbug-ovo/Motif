"""Album CRUD endpoints."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from datetime import datetime

from database import get_db
from models.album import Album
from models.media import Media
from models.person import Person
from models.tag import Tag, album_tags

router = APIRouter()


class AlbumCreate(BaseModel):
    name: str
    person_id: Optional[str] = None
    is_generated_album: bool = False


class AlbumUpdate(BaseModel):
    name: Optional[str] = None
    cover_media_id: Optional[str] = None
    person_id: Optional[str] = None
    tag_ids: Optional[list[str]] = None


def _album_or_404(aid: str, db: Session) -> Album:
    a = db.get(Album, aid)
    if not a:
        raise HTTPException(status_code=404, detail="Album not found")
    return a


def _album_dict(a: Album, db: Session) -> dict:
    media_count = db.execute(
        select(func.count(Media.id)).where(Media.album_id == a.id, Media.is_deleted == False)
    ).scalar() or 0

    # Resolve cover file path
    cover_file_path = None
    if a.cover_media_id:
        cm = db.get(Media, a.cover_media_id)
        if cm and not cm.is_deleted:
            cover_file_path = cm.file_path
    if not cover_file_path:
        first = db.execute(
            select(Media.file_path)
            .where(Media.album_id == a.id, Media.is_deleted == False, Media.media_type == "image")
            .order_by(Media.sort_order.asc())
            .limit(1)
        ).scalar()
        cover_file_path = first

    # Tags
    tag_rows = db.execute(
        select(Tag).join(album_tags, album_tags.c.tag_id == Tag.id)
        .where(album_tags.c.album_id == a.id)
        .order_by(Tag.sort_order)
    ).scalars().all()

    return {
        "id": a.id,
        "person_id": a.person_id,
        "name": a.name,
        "cover_media_id": a.cover_media_id,
        "cover_file_path": cover_file_path,
        "is_generated_album": a.is_generated_album,
        "avg_rating": a.avg_rating,
        "rated_count": a.rated_count,
        "media_count": media_count,
        "tags": [{"id": t.id, "name": t.name} for t in tag_rows],
        "created_at": a.created_at.isoformat() + "Z",
        "updated_at": a.updated_at.isoformat() + "Z",
    }


@router.get("")
def list_albums(
    person_id: Optional[str] = None,
    sort: str = Query("created_at", regex="^(created_at|avg_rating|name)$"),
    sort_dir: str = Query("desc", regex="^(asc|desc)$"),
    filter_rating: Optional[str] = Query(None),
    tag_ids: Optional[str] = Query(None, description="comma-separated tag IDs (intersection filter)"),
    db: Session = Depends(get_db),
):
    from sqlalchemy import asc as sa_asc, desc as sa_desc

    q = select(Album)
    if person_id:
        q = q.where(Album.person_id == person_id)

    if tag_ids:
        tid_list = [t.strip() for t in tag_ids.split(",") if t.strip()]
        for tid in tid_list:
            q = q.where(
                Album.id.in_(
                    select(album_tags.c.album_id).where(album_tags.c.tag_id == tid)
                )
            )

    if filter_rating:
        try:
            op, val = filter_rating.split(":", 1)
            val_int = int(val)
        except ValueError:
            raise HTTPException(status_code=400, detail="filter_rating format: op:value")
        if op == "eq":
            q = q.where(Album.avg_rating == val_int)
        elif op == "gte":
            q = q.where(Album.avg_rating >= val_int)
        elif op == "lte":
            q = q.where(Album.avg_rating <= val_int)

    direction = sa_asc if sort_dir == "asc" else sa_desc
    if sort == "avg_rating":
        col = direction(Album.avg_rating)
        col = col.nullslast() if sort_dir == "desc" else col.nullsfirst()
        q = q.order_by(col, Album.created_at.desc())
    elif sort == "name":
        q = q.order_by(direction(Album.name))
    else:
        q = q.order_by(direction(Album.created_at))

    albums = db.execute(q).scalars().all()
    return [_album_dict(a, db) for a in albums]


@router.get("/{aid}")
def get_album(aid: str, db: Session = Depends(get_db)):
    return _album_dict(_album_or_404(aid, db), db)


@router.post("", status_code=201)
def create_album(body: AlbumCreate, db: Session = Depends(get_db)):
    if body.person_id:
        if not db.get(Person, body.person_id):
            raise HTTPException(status_code=404, detail="Person not found")
    a = Album(name=body.name, person_id=body.person_id, is_generated_album=body.is_generated_album)
    db.add(a)
    db.commit()
    db.refresh(a)
    return _album_dict(a, db)


@router.patch("/{aid}")
def update_album(aid: str, body: AlbumUpdate, db: Session = Depends(get_db)):
    a = _album_or_404(aid, db)
    old_person_id = a.person_id
    if body.name is not None:
        a.name = body.name
    if body.cover_media_id is not None:
        a.cover_media_id = body.cover_media_id
    if body.person_id is not None:
        if body.person_id and not db.get(Person, body.person_id):
            raise HTTPException(status_code=404, detail="Person not found")
        a.person_id = body.person_id or None
        # Cascade: update all media in this album to new person_id
        media_items = db.execute(
            select(Media).where(Media.album_id == aid, Media.is_deleted == False)
        ).scalars().all()
        for m in media_items:
            m.person_id = a.person_id
    if body.tag_ids is not None:
        db.execute(album_tags.delete().where(album_tags.c.album_id == aid))
        for tid in body.tag_ids:
            tag = db.get(Tag, tid)
            if tag:
                db.execute(album_tags.insert().values(album_id=aid, tag_id=tid))
    a.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(a)
    # Recalc ratings for old and new person
    if body.person_id is not None and old_person_id != a.person_id:
        from routers.media import _recalc_person_rating
        for pid in {old_person_id, a.person_id} - {None}:
            _recalc_person_rating(pid, db)
    return _album_dict(a, db)


@router.delete("/{aid}", status_code=204)
def delete_album(
    aid: str,
    mode: str = Query("album_only", regex="^(album_only|album_and_media|move_to_album)$"),
    target_album_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    a = _album_or_404(aid, db)
    person_id = a.person_id

    media_items = db.execute(
        select(Media).where(Media.album_id == aid, Media.is_deleted == False)
    ).scalars().all()

    if mode == "album_and_media":
        # Soft-delete all media into recycle bin
        now = datetime.utcnow()
        for m in media_items:
            m.is_deleted = True
            m.deleted_at = now
    elif mode == "move_to_album" and target_album_id:
        # Move media to another album
        target = db.get(Album, target_album_id)
        if not target:
            raise HTTPException(status_code=404, detail="Target album not found")
        for m in media_items:
            m.album_id = target_album_id
            if target.person_id:
                m.person_id = target.person_id
    else:
        # Detach media — become loose images under the person
        for m in media_items:
            m.album_id = None

    db.delete(a)
    db.commit()

    # Recalc person rating after changes
    if person_id:
        from routers.media import _recalc_person_rating
        _recalc_person_rating(person_id, db)
    # Recalc target album's person rating if moved
    if mode == "move_to_album" and target_album_id:
        target = db.get(Album, target_album_id)
        if target and target.person_id and target.person_id != person_id:
            from routers.media import _recalc_person_rating
            _recalc_person_rating(target.person_id, db)


@router.post("/cleanup-empty")
def cleanup_empty_albums(person_id: str | None = None, db: Session = Depends(get_db)):
    """Delete all albums that have zero non-deleted media."""
    # Find albums with no active media
    media_count_sq = (
        select(func.count(Media.id))
        .where(Media.album_id == Album.id, Media.is_deleted == False)
        .correlate(Album)
        .scalar_subquery()
    )
    query = select(Album).where(media_count_sq == 0)
    if person_id:
        query = query.where(Album.person_id == person_id)
    empty_albums = db.execute(query).scalars().all()

    if not empty_albums:
        return {"deleted_count": 0, "deleted_albums": []}

    deleted = []
    affected_person_ids = set()
    for a in empty_albums:
        deleted.append({"id": a.id, "name": a.name, "person_id": a.person_id})
        if a.person_id:
            affected_person_ids.add(a.person_id)
        db.delete(a)
    db.commit()

    return {"deleted_count": len(deleted), "deleted_albums": deleted}


# Nested route: GET /persons/{pid}/albums
@router.get("/by-person/{pid}")
def list_albums_by_person(
    pid: str,
    sort: str = Query("created_at", regex="^(created_at|avg_rating|name)$"),
    sort_dir: str = Query("desc", regex="^(asc|desc)$"),
    filter_rating: Optional[str] = Query(None),
    tag_ids: Optional[str] = Query(None, description="comma-separated tag IDs (intersection filter)"),
    db: Session = Depends(get_db),
):
    from sqlalchemy import asc as sa_asc, desc as sa_desc

    if not db.get(Person, pid):
        raise HTTPException(status_code=404, detail="Person not found")
    q = select(Album).where(Album.person_id == pid)

    if tag_ids:
        tid_list = [t.strip() for t in tag_ids.split(",") if t.strip()]
        for tid in tid_list:
            q = q.where(
                Album.id.in_(
                    select(album_tags.c.album_id).where(album_tags.c.tag_id == tid)
                )
            )

    if filter_rating:
        try:
            op, val = filter_rating.split(":", 1)
            val_int = int(val)
        except ValueError:
            raise HTTPException(status_code=400, detail="filter_rating format: op:value")
        if op == "eq":
            q = q.where(Album.avg_rating == val_int)
        elif op == "gte":
            q = q.where(Album.avg_rating >= val_int)
        elif op == "lte":
            q = q.where(Album.avg_rating <= val_int)

    direction = sa_asc if sort_dir == "asc" else sa_desc
    if sort == "avg_rating":
        col = direction(Album.avg_rating)
        col = col.nullslast() if sort_dir == "desc" else col.nullsfirst()
        q = q.order_by(col, Album.created_at.desc())
    elif sort == "name":
        q = q.order_by(direction(Album.name))
    else:
        q = q.order_by(direction(Album.created_at))
    albums = db.execute(q).scalars().all()
    return [_album_dict(a, db) for a in albums]
