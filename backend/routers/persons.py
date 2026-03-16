"""Person CRUD endpoints."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from database import get_db
from models.person import Person
from models.album import Album
from models.media import Media
from models.platform_account import PlatformAccount
from models.tag import Tag, person_tags

router = APIRouter()


class PersonCreate(BaseModel):
    name: str


class PersonUpdate(BaseModel):
    name: Optional[str] = None
    cover_media_id: Optional[str] = None
    tag_ids: Optional[list[str]] = None


def _person_or_404(pid: str, db: Session) -> Person:
    p = db.get(Person, pid)
    if not p:
        raise HTTPException(status_code=404, detail="Person not found")
    return p


def _recalc_person_rating(person_id: str, db: Session) -> None:
    """Recalc avg_rating: unrated items count as 2.5."""
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


@router.get("")
def list_persons(
    sort: str = Query("created_at", regex="^(created_at|avg_rating|name)$"),
    sort_dir: str = Query("desc", regex="^(asc|desc)$"),
    filter_rating: Optional[str] = Query(None, description="e.g. gte:4"),
    tag_ids: Optional[str] = Query(None, description="comma-separated tag IDs (intersection filter)"),
    db: Session = Depends(get_db),
):
    from sqlalchemy import asc as sa_asc, desc as sa_desc

    q = select(Person)

    # Tag intersection filter: person must have ALL specified tags
    if tag_ids:
        tid_list = [t.strip() for t in tag_ids.split(",") if t.strip()]
        for tid in tid_list:
            q = q.where(
                Person.id.in_(
                    select(person_tags.c.person_id).where(person_tags.c.tag_id == tid)
                )
            )

    if filter_rating:
        try:
            op, val = filter_rating.split(":", 1)
            val_int = int(val)
        except ValueError:
            raise HTTPException(status_code=400, detail="filter_rating format: op:value (e.g. gte:4)")
        if op == "eq":
            q = q.where(Person.avg_rating == val_int)
        elif op == "gte":
            q = q.where(Person.avg_rating >= val_int)
        elif op == "lte":
            q = q.where(Person.avg_rating <= val_int)
        else:
            raise HTTPException(status_code=400, detail="op must be eq/gte/lte")

    direction = sa_asc if sort_dir == "asc" else sa_desc
    if sort == "avg_rating":
        col = direction(Person.avg_rating)
        col = col.nullslast() if sort_dir == "desc" else col.nullsfirst()
        q = q.order_by(col, Person.created_at.desc())
    elif sort == "name":
        q = q.order_by(direction(Person.name))
    else:
        q = q.order_by(direction(Person.created_at))

    persons = db.execute(q).scalars().all()
    return [_person_dict(p, db) for p in persons]


@router.get("/{pid}")
def get_person(pid: str, db: Session = Depends(get_db)):
    p = _person_or_404(pid, db)
    return _person_dict(p, db)


@router.post("", status_code=201)
def create_person(body: PersonCreate, db: Session = Depends(get_db)):
    p = Person(name=body.name)
    db.add(p)
    db.commit()
    db.refresh(p)
    return _person_dict(p, db)


@router.patch("/{pid}")
def update_person(pid: str, body: PersonUpdate, db: Session = Depends(get_db)):
    p = _person_or_404(pid, db)
    if body.name is not None:
        p.name = body.name
    if body.cover_media_id is not None:
        p.cover_media_id = body.cover_media_id
    if body.tag_ids is not None:
        # Full replace: clear existing tags, set new ones
        db.execute(person_tags.delete().where(person_tags.c.person_id == pid))
        for tid in body.tag_ids:
            tag = db.get(Tag, tid)
            if tag:
                db.execute(person_tags.insert().values(person_id=pid, tag_id=tid))
    db.commit()
    db.refresh(p)
    return _person_dict(p, db)


@router.delete("/{pid}", status_code=204)
def delete_person(
    pid: str,
    mode: str = Query("person_only", regex="^(person_only|person_and_albums|all)$"),
    db: Session = Depends(get_db),
):
    p = _person_or_404(pid, db)

    if mode == "person_only":
        # Detach albums and media
        albums = db.execute(select(Album).where(Album.person_id == pid)).scalars().all()
        for a in albums:
            a.person_id = None
        media = db.execute(select(Media).where(Media.person_id == pid)).scalars().all()
        for m in media:
            m.person_id = None
        db.delete(p)
    elif mode == "person_and_albums":
        # Delete albums but keep media (detached)
        for a in list(p.albums):
            for m in list(a.media_items):
                m.album_id = None
                m.person_id = None
            db.delete(a)
        media = db.execute(select(Media).where(Media.person_id == pid)).scalars().all()
        for m in media:
            m.person_id = None
        db.delete(p)
    else:  # all — cascade delete person → albums → media (soft-delete media)
        from datetime import datetime
        for a in list(p.albums):
            for m in list(a.media_items):
                m.is_deleted = True
                m.deleted_at = datetime.utcnow()
        loose = db.execute(select(Media).where(Media.person_id == pid, Media.album_id.is_(None))).scalars().all()
        for m in loose:
            m.is_deleted = True
            m.deleted_at = datetime.utcnow()
        db.delete(p)

    db.commit()


def _person_dict(p: Person, db: Session) -> dict:
    # Count media
    media_count = db.execute(
        select(func.count(Media.id)).where(Media.person_id == p.id, Media.is_deleted == False)
    ).scalar() or 0
    album_count = db.execute(
        select(func.count(Album.id)).where(Album.person_id == p.id)
    ).scalar() or 0

    # Resolve cover file path
    cover_file_path = None
    if p.cover_media_id:
        cm = db.get(Media, p.cover_media_id)
        if cm and not cm.is_deleted:
            cover_file_path = cm.file_path
    if not cover_file_path:
        # Fallback: first non-deleted media for this person
        first = db.execute(
            select(Media.file_path)
            .where(Media.person_id == p.id, Media.is_deleted == False, Media.media_type == "image")
            .order_by(Media.created_at.asc())
            .limit(1)
        ).scalar()
        cover_file_path = first

    # Platform accounts linked to this person
    accounts = db.execute(
        select(PlatformAccount).where(PlatformAccount.person_id == p.id)
    ).scalars().all()

    # Tags
    tag_rows = db.execute(
        select(Tag).join(person_tags, person_tags.c.tag_id == Tag.id)
        .where(person_tags.c.person_id == p.id)
        .order_by(Tag.sort_order)
    ).scalars().all()

    return {
        "id": p.id,
        "name": p.name,
        "cover_media_id": p.cover_media_id,
        "cover_file_path": cover_file_path,
        "avg_rating": p.avg_rating,
        "rated_count": p.rated_count,
        "media_count": media_count,
        "album_count": album_count,
        "accounts": [
            {
                "id": a.id,
                "platform": a.platform,
                "username": a.username,
                "display_name": a.display_name,
            }
            for a in accounts
        ],
        "tags": [{"id": t.id, "name": t.name} for t in tag_rows],
        "created_at": p.created_at.isoformat() + "Z",
        "updated_at": p.updated_at.isoformat() + "Z",
    }
