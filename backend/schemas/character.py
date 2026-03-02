import json
from datetime import datetime
from pydantic import BaseModel, model_validator


class CharacterUpdate(BaseModel):
    name: str | None = None


class CharacterOut(BaseModel):
    id: int
    name: str
    source_folder: str | None
    reference_photos: list[str]
    face_crop_nobg: str | None
    created_at: datetime

    model_config = {"from_attributes": True}

    @model_validator(mode="before")
    @classmethod
    def parse_json_fields(cls, data):
        if hasattr(data, "__dict__"):
            raw = data.reference_photos
            data.__dict__["reference_photos"] = (
                json.loads(raw) if isinstance(raw, str) else raw or []
            )
        return data


# ── Folder scan / import ─────────────────────────────────────────────

class FolderScanRequest(BaseModel):
    path: str


class FolderScanResult(BaseModel):
    folder_name: str
    folder_path: str
    photo_count: int
    already_imported: bool  # True if source_folder already exists in DB


class FolderImportItem(BaseModel):
    folder_path: str
    name: str


class FolderImportRequest(BaseModel):
    items: list[FolderImportItem]
