"""M4 — Character library: folder-scan import + CRUD."""
import json
import os

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models.character import Character
from schemas.character import (
    CharacterUpdate, CharacterOut,
    FolderScanRequest, FolderScanResult, FolderImportRequest,
)

router = APIRouter()

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def _scan_images(folder: str) -> list[str]:
    """Return absolute paths of image files in a folder (non-recursive)."""
    try:
        return sorted(
            os.path.join(folder, f)
            for f in os.listdir(folder)
            if os.path.splitext(f)[1].lower() in IMAGE_EXTS
        )
    except PermissionError:
        return []


# ------------------------------------------------------------------ #
# CRUD                                                                  #
# ------------------------------------------------------------------ #

@router.get("", response_model=list[CharacterOut])
def list_characters(db: Session = Depends(get_db)):
    return db.query(Character).order_by(Character.created_at.desc()).all()


@router.get("/{character_id}", response_model=CharacterOut)
def get_character(character_id: int, db: Session = Depends(get_db)):
    char = db.get(Character, character_id)
    if not char:
        raise HTTPException(status_code=404, detail="Character not found")
    return char


@router.patch("/{character_id}", response_model=CharacterOut)
def update_character(
    character_id: int, body: CharacterUpdate, db: Session = Depends(get_db)
):
    char = db.get(Character, character_id)
    if not char:
        raise HTTPException(status_code=404, detail="Character not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(char, field, value)
    db.commit()
    db.refresh(char)
    return char


@router.delete("/{character_id}", status_code=204)
def delete_character(character_id: int, db: Session = Depends(get_db)):
    char = db.get(Character, character_id)
    if not char:
        raise HTTPException(status_code=404, detail="Character not found")
    db.delete(char)
    db.commit()


# ------------------------------------------------------------------ #
# Folder scan & import                                                  #
# ------------------------------------------------------------------ #

@router.post("/scan", response_model=list[FolderScanResult])
def scan_folder(body: FolderScanRequest, db: Session = Depends(get_db)):
    """List subfolders of `path`, with photo counts and import status."""
    root = body.path.strip()
    if not os.path.isdir(root):
        raise HTTPException(status_code=400, detail=f"目录不存在：{root}")

    # Existing source_folders for quick lookup
    existing = {
        r[0] for r in db.query(Character.source_folder).filter(
            Character.source_folder.isnot(None)
        ).all()
    }

    results: list[FolderScanResult] = []
    try:
        entries = sorted(os.scandir(root), key=lambda e: e.name)
    except PermissionError:
        raise HTTPException(status_code=403, detail="无权限读取该目录")

    for entry in entries:
        if not entry.is_dir():
            continue
        photos = _scan_images(entry.path)
        results.append(FolderScanResult(
            folder_name=entry.name,
            folder_path=entry.path,
            photo_count=len(photos),
            already_imported=entry.path in existing,
        ))

    return results


@router.post("/import", response_model=list[CharacterOut], status_code=201)
async def import_folders(body: FolderImportRequest, db: Session = Depends(get_db)):
    """Create Character records from selected folders, trigger preprocessing."""
    created: list[Character] = []

    for item in body.items:
        folder = item.folder_path.strip()
        if not os.path.isdir(folder):
            continue  # Skip invalid folders silently

        photos = _scan_images(folder)
        char = Character(
            name=item.name.strip() or os.path.basename(folder),
            source_folder=folder,
            reference_photos=json.dumps(photos),
        )
        db.add(char)
        db.flush()  # get char.id before commit
        created.append(char)

    db.commit()
    for c in created:
        db.refresh(c)

    return created


