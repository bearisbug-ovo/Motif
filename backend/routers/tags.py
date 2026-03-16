"""Tag CRUD endpoints."""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from database import get_db
from models.tag import Tag, person_tags, album_tags

router = APIRouter()


class TagCreate(BaseModel):
    name: str


class TagUpdate(BaseModel):
    name: Optional[str] = None


class TagMerge(BaseModel):
    target_id: str


class TagReorder(BaseModel):
    tag_ids: List[str]


def _tag_dict(t: Tag, db: Session) -> dict:
    person_count = db.execute(
        select(func.count()).select_from(person_tags).where(person_tags.c.tag_id == t.id)
    ).scalar() or 0
    album_count = db.execute(
        select(func.count()).select_from(album_tags).where(album_tags.c.tag_id == t.id)
    ).scalar() or 0
    return {
        "id": t.id,
        "name": t.name,
        "color": t.color,
        "sort_order": t.sort_order,
        "person_count": person_count,
        "album_count": album_count,
        "created_at": t.created_at.isoformat() + "Z",
    }


@router.get("")
def list_tags(db: Session = Depends(get_db)):
    tags = db.execute(select(Tag).order_by(Tag.sort_order, Tag.created_at)).scalars().all()
    return [_tag_dict(t, db) for t in tags]


@router.post("", status_code=201)
def create_tag(body: TagCreate, db: Session = Depends(get_db)):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Tag name cannot be empty")
    existing = db.execute(select(Tag).where(Tag.name == name)).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="Tag already exists")
    max_order = db.execute(select(func.max(Tag.sort_order))).scalar() or 0
    t = Tag(name=name, sort_order=max_order + 1)
    db.add(t)
    db.commit()
    db.refresh(t)
    return _tag_dict(t, db)


@router.patch("/{tag_id}")
def update_tag(tag_id: str, body: TagUpdate, db: Session = Depends(get_db)):
    t = db.get(Tag, tag_id)
    if not t:
        raise HTTPException(status_code=404, detail="Tag not found")
    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Tag name cannot be empty")
        dup = db.execute(select(Tag).where(Tag.name == name, Tag.id != tag_id)).scalar_one_or_none()
        if dup:
            raise HTTPException(status_code=409, detail="Tag name already exists")
        t.name = name
    db.commit()
    db.refresh(t)
    return _tag_dict(t, db)


@router.delete("/{tag_id}", status_code=204)
def delete_tag(tag_id: str, db: Session = Depends(get_db)):
    t = db.get(Tag, tag_id)
    if not t:
        raise HTTPException(status_code=404, detail="Tag not found")
    db.delete(t)
    db.commit()


@router.post("/{tag_id}/merge")
def merge_tag(tag_id: str, body: TagMerge, db: Session = Depends(get_db)):
    if tag_id == body.target_id:
        raise HTTPException(status_code=400, detail="Cannot merge tag into itself")
    source = db.get(Tag, tag_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source tag not found")
    target = db.get(Tag, body.target_id)
    if not target:
        raise HTTPException(status_code=404, detail="Target tag not found")

    # Move person associations (skip duplicates)
    existing_person_ids = set(
        r[0] for r in db.execute(
            select(person_tags.c.person_id).where(person_tags.c.tag_id == body.target_id)
        ).fetchall()
    )
    source_person_ids = [
        r[0] for r in db.execute(
            select(person_tags.c.person_id).where(person_tags.c.tag_id == tag_id)
        ).fetchall()
    ]
    for pid in source_person_ids:
        if pid not in existing_person_ids:
            db.execute(person_tags.insert().values(person_id=pid, tag_id=body.target_id))

    # Move album associations (skip duplicates)
    existing_album_ids = set(
        r[0] for r in db.execute(
            select(album_tags.c.album_id).where(album_tags.c.tag_id == body.target_id)
        ).fetchall()
    )
    source_album_ids = [
        r[0] for r in db.execute(
            select(album_tags.c.album_id).where(album_tags.c.tag_id == tag_id)
        ).fetchall()
    ]
    for aid in source_album_ids:
        if aid not in existing_album_ids:
            db.execute(album_tags.insert().values(album_id=aid, tag_id=body.target_id))

    db.delete(source)
    db.commit()
    db.refresh(target)
    return _tag_dict(target, db)


@router.patch("/reorder")
def reorder_tags(body: TagReorder, db: Session = Depends(get_db)):
    for i, tid in enumerate(body.tag_ids):
        t = db.get(Tag, tid)
        if t:
            t.sort_order = i
    db.commit()
    tags = db.execute(select(Tag).order_by(Tag.sort_order, Tag.created_at)).scalars().all()
    return [_tag_dict(t, db) for t in tags]
