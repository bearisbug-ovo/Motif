"""Workspace CRUD endpoints (persistent collection, max 100 items)."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from database import get_db
from models.workspace import WorkspaceItem
from models.media import Media

router = APIRouter()

MAX_WORKSPACE_ITEMS = 100


class WorkspaceAdd(BaseModel):
    media_id: str


class WorkspaceBatchAdd(BaseModel):
    media_ids: List[str]


class WorkspaceReorder(BaseModel):
    item_ids: List[str]  # Ordered list of workspace item IDs


# ── Helpers ───────────────────────────────────────────────────────────────────

def _item_dict(wi: WorkspaceItem, media: Media | None = None) -> dict:
    d = {
        "id": wi.id,
        "media_id": wi.media_id,
        "sort_order": wi.sort_order,
        "created_at": wi.created_at.isoformat() + "Z",
    }
    if media:
        d["media"] = {
            "id": media.id,
            "file_path": media.file_path,
            "media_type": media.media_type,
            "source_type": media.source_type,
            "person_id": media.person_id,
            "album_id": media.album_id,
            "rating": media.rating,
            "width": media.width,
            "height": media.height,
        }
    return d


def _current_count(db: Session) -> int:
    return db.execute(select(func.count(WorkspaceItem.id))).scalar() or 0


def _next_sort_order(db: Session) -> int:
    max_order = db.execute(select(func.max(WorkspaceItem.sort_order))).scalar()
    return (max_order or 0) + 1


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("")
def list_workspace(db: Session = Depends(get_db)):
    items = db.execute(
        select(WorkspaceItem).order_by(WorkspaceItem.sort_order.asc())
    ).scalars().all()
    result = []
    for wi in items:
        media = db.get(Media, wi.media_id)
        if media and not media.is_deleted:
            result.append(_item_dict(wi, media))
        else:
            # Clean up orphaned workspace items
            db.delete(wi)
    db.commit()
    return result


@router.post("")
def add_to_workspace(body: WorkspaceAdd, db: Session = Depends(get_db)):
    media = db.get(Media, body.media_id)
    if not media or media.is_deleted:
        raise HTTPException(status_code=404, detail="Media not found")

    # Check duplicate
    existing = db.execute(
        select(WorkspaceItem).where(WorkspaceItem.media_id == body.media_id)
    ).scalar_one_or_none()
    if existing:
        return _item_dict(existing, media)

    # Check capacity
    if _current_count(db) >= MAX_WORKSPACE_ITEMS:
        raise HTTPException(status_code=400, detail=f"Workspace full ({MAX_WORKSPACE_ITEMS} items max)")

    wi = WorkspaceItem(
        id=str(uuid.uuid4()),
        media_id=body.media_id,
        sort_order=_next_sort_order(db),
        created_at=datetime.utcnow(),
    )
    db.add(wi)
    db.commit()
    db.refresh(wi)
    return _item_dict(wi, media)


@router.post("/batch")
def batch_add_to_workspace(body: WorkspaceBatchAdd, db: Session = Depends(get_db)):
    current = _current_count(db)
    added = []
    skipped = 0

    for mid in body.media_ids:
        if current + len(added) >= MAX_WORKSPACE_ITEMS:
            break

        media = db.get(Media, mid)
        if not media or media.is_deleted:
            skipped += 1
            continue

        existing = db.execute(
            select(WorkspaceItem).where(WorkspaceItem.media_id == mid)
        ).scalar_one_or_none()
        if existing:
            skipped += 1
            continue

        wi = WorkspaceItem(
            id=str(uuid.uuid4()),
            media_id=mid,
            sort_order=_next_sort_order(db),
            created_at=datetime.utcnow(),
        )
        db.add(wi)
        added.append(wi.id)

    db.commit()
    return {"added": len(added), "skipped": skipped, "total": _current_count(db)}


@router.delete("/{item_id}", status_code=204)
def remove_from_workspace(item_id: str, db: Session = Depends(get_db)):
    wi = db.get(WorkspaceItem, item_id)
    if not wi:
        raise HTTPException(status_code=404, detail="Workspace item not found")
    db.delete(wi)
    db.commit()


@router.delete("")
def clear_workspace(db: Session = Depends(get_db)):
    items = db.execute(select(WorkspaceItem)).scalars().all()
    count = len(items)
    for wi in items:
        db.delete(wi)
    db.commit()
    return {"deleted": count}


@router.patch("/reorder")
def reorder_workspace(body: WorkspaceReorder, db: Session = Depends(get_db)):
    for i, item_id in enumerate(body.item_ids):
        wi = db.get(WorkspaceItem, item_id)
        if wi:
            wi.sort_order = i
    db.commit()
    return {"ok": True}
