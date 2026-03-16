"""Download (web scraper) endpoints."""
from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime
from typing import List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from config import get_settings
from database import get_db
from models.album import Album
from models.download_record import DownloadRecord
from models.media import Media
from models.person import Person
from models.platform_account import PlatformAccount

router = APIRouter()
logger = logging.getLogger("motif.downloads")


# ── Schemas ──────────────────────────────────────────────────────────────────

class ParseRequest(BaseModel):
    raw_text: str


class MediaItemPreview(BaseModel):
    url: str
    type: str  # "image" or "video"
    thumb_url: Optional[str] = None


class ExistingAccount(BaseModel):
    id: str
    person_id: Optional[str] = None
    person_name: Optional[str] = None


class ExistingDownload(BaseModel):
    record_id: str
    album_id: Optional[str] = None
    media_count: int
    downloaded_at: datetime


class ParseResponse(BaseModel):
    platform: str
    source_url: str
    username: str
    display_name: str
    title: str
    published_at: Optional[datetime] = None
    media_items: List[MediaItemPreview]
    media_count: int
    existing_account: Optional[ExistingAccount] = None
    existing_download: Optional[ExistingDownload] = None
    extra: Optional[dict] = None  # Platform-specific data (e.g. sec_uid)


class ConfirmRequest(BaseModel):
    platform: str
    source_url: str
    username: str
    display_name: str
    title: str
    published_at: Optional[datetime] = None
    media_items: List[MediaItemPreview]
    person_id: Optional[str] = None
    create_person_name: Optional[str] = None
    album_mode: str = "new"  # "new" | "existing" | "loose"
    album_name: Optional[str] = None
    existing_album_id: Optional[str] = None
    remember_account: bool = False


class ConfirmResponse(BaseModel):
    album_id: Optional[str] = None
    person_id: Optional[str] = None
    media_count: int
    record_id: str


class RecordResponse(BaseModel):
    id: str
    source_url: str
    platform: str
    title: Optional[str] = None
    published_at: Optional[datetime] = None
    media_count: int
    album_id: Optional[str] = None
    downloaded_at: datetime
    status: str
    error_message: Optional[str] = None
    account_username: Optional[str] = None


class AccountResponse(BaseModel):
    id: str
    platform: str
    username: str
    display_name: Optional[str] = None
    person_id: Optional[str] = None
    person_name: Optional[str] = None
    created_at: datetime


class AccountUpdate(BaseModel):
    person_id: Optional[str] = None


# ── Parse endpoint ───────────────────────────────────────────────────────────

@router.post("/parse", response_model=ParseResponse)
async def parse_url(body: ParseRequest, db: Session = Depends(get_db)):
    """Extract link from raw text, scrape metadata, return preview."""
    from scrapers import get_scraper

    text = body.raw_text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="请输入链接或分享文本")

    scraper = get_scraper(text)
    if not scraper:
        raise HTTPException(status_code=400, detail="无法识别链接，当前支持：小红书、抖音")

    url = scraper.extract_url(text)
    try:
        result = await scraper.parse(url)
    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        print(f"[SCRAPER ERROR] {type(e).__name__}: {e}")
        print(tb)
        detail = str(e) or type(e).__name__
        raise HTTPException(status_code=422, detail=f"解析失败：{detail}")

    # Check if we already know this account
    existing_account = None
    if result.username:
        acct = db.query(PlatformAccount).filter(
            PlatformAccount.platform == result.platform,
            PlatformAccount.username == result.username,
        ).first()
        if acct:
            person_name = None
            if acct.person_id:
                person = db.query(Person).filter(Person.id == acct.person_id).first()
                person_name = person.name if person else None
            existing_account = ExistingAccount(
                id=acct.id,
                person_id=acct.person_id,
                person_name=person_name,
            )

    # Check if this URL was already downloaded (match by canonical URL or note_id)
    existing_download = None
    existing_record = db.query(DownloadRecord).filter(
        DownloadRecord.source_url == result.source_url,
        DownloadRecord.status == "completed",
    ).order_by(DownloadRecord.downloaded_at.desc()).first()
    # Fallback: for XHS, also match by note_id in case old records have non-canonical URLs
    if not existing_record and result.platform == "xiaohongshu":
        import re as _re
        _m = _re.search(r'/explore/([a-f0-9]+)', result.source_url)
        if _m:
            _note_id = _m.group(1)
            all_xhs_completed = db.query(DownloadRecord).filter(
                DownloadRecord.platform == "xiaohongshu",
                DownloadRecord.status == "completed",
            ).all()
            for _rec in all_xhs_completed:
                if _note_id in _rec.source_url:
                    existing_record = _rec
                    break
    if existing_record:
        existing_download = ExistingDownload(
            record_id=existing_record.id,
            album_id=existing_record.album_id,
            media_count=existing_record.media_count,
            downloaded_at=existing_record.downloaded_at,
        )

    return ParseResponse(
        platform=result.platform,
        source_url=result.source_url,
        username=result.username,
        display_name=result.display_name,
        title=result.title,
        published_at=result.published_at,
        media_items=[
            MediaItemPreview(url=m.url, type=m.type, thumb_url=m.thumb_url)
            for m in result.media_items
        ],
        media_count=result.media_count,
        existing_account=existing_account,
        existing_download=existing_download,
        extra=result.extra if result.extra else None,
    )


# ── Confirm download ────────────────────────────────────────────────────────

@router.post("/confirm", response_model=ConfirmResponse)
async def confirm_download(body: ConfirmRequest, db: Session = Depends(get_db)):
    """Download all media, create DB records, return album_id."""
    settings = get_settings()
    download_dir = settings.downloads_dir(body.platform)
    download_dir.mkdir(parents=True, exist_ok=True)

    # Resolve person
    person_id = body.person_id
    if not person_id and body.create_person_name:
        person = Person(name=body.create_person_name.strip())
        db.add(person)
        db.flush()
        person_id = person.id

    # Download media files first
    downloaded_files = []
    errors = []
    async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
        for i, item in enumerate(body.media_items):
            try:
                resp = await client.get(item.url, headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    "Referer": body.source_url,
                })
                resp.raise_for_status()

                # Determine extension from content-type or URL
                ext = _guess_ext(item.url, resp.headers.get("content-type", ""), item.type)
                filename = f"{uuid.uuid4().hex[:12]}_{i:03d}{ext}"
                filepath = download_dir / filename

                with open(str(filepath), "wb") as f:
                    f.write(resp.content)

                media_type = "video" if item.type == "video" else "image"
                file_size = len(resp.content)
                width, height = None, None
                if media_type == "image":
                    try:
                        from PIL import Image as PILImage
                        with PILImage.open(str(filepath)) as img:
                            width, height = img.size
                    except Exception:
                        pass
                downloaded_files.append({
                    "file_path": str(filepath),
                    "media_type": media_type,
                    "file_size": file_size,
                    "width": width,
                    "height": height,
                })
            except Exception as e:
                logger.warning("Failed to download %s: %s", item.url, e)
                errors.append(str(e))

    # Create album only if we have downloaded files
    album_id = None
    if body.album_mode == "existing" and body.existing_album_id:
        album_id = body.existing_album_id
    elif body.album_mode == "new" and downloaded_files:
        album_name = body.album_name or body.title or "下载图集"
        album = Album(name=album_name, person_id=person_id)
        db.add(album)
        db.flush()
        album_id = album.id

    # Create Media records
    downloaded = len(downloaded_files)
    for f_info in downloaded_files:
        media = Media(
            file_path=f_info["file_path"],
            media_type=f_info["media_type"],
            source_type="local",
            person_id=person_id,
            album_id=album_id,
            file_size=f_info["file_size"],
            width=f_info["width"],
            height=f_info["height"],
        )
        db.add(media)

    # Remember account association
    if body.remember_account and body.username:
        existing = db.query(PlatformAccount).filter(
            PlatformAccount.platform == body.platform,
            PlatformAccount.username == body.username,
        ).first()
        if existing:
            if person_id:
                existing.person_id = person_id
                existing.display_name = body.display_name
        else:
            db.add(PlatformAccount(
                platform=body.platform,
                username=body.username,
                display_name=body.display_name,
                person_id=person_id,
            ))

    # Create download record (use canonical source_url for consistent dedup)
    canonical_source_url = body.source_url
    if body.platform == "xiaohongshu":
        import re as _re
        _m = _re.search(r'/(?:explore|discovery/item)/([a-f0-9]+)', body.source_url)
        if _m:
            canonical_source_url = f"https://www.xiaohongshu.com/explore/{_m.group(1)}"
    status = "completed" if downloaded > 0 else "failed"
    error_msg = "; ".join(errors) if errors else None
    record = DownloadRecord(
        source_url=canonical_source_url,
        platform=body.platform,
        title=body.title,
        published_at=body.published_at,
        media_count=downloaded,
        album_id=album_id,
        status=status,
        error_message=error_msg,
    )
    # Link account if exists
    acct = db.query(PlatformAccount).filter(
        PlatformAccount.platform == body.platform,
        PlatformAccount.username == body.username,
    ).first()
    if acct:
        record.account_id = acct.id
    db.add(record)

    db.commit()

    return ConfirmResponse(
        album_id=album_id,
        person_id=person_id,
        media_count=downloaded,
        record_id=record.id,
    )


def _guess_ext(url: str, content_type: str, item_type: str) -> str:
    """Guess file extension from URL/content-type."""
    ct_map = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/gif": ".gif",
        "video/mp4": ".mp4",
    }
    for ct, ext in ct_map.items():
        if ct in content_type:
            return ext
    # Try URL path
    from urllib.parse import urlparse
    path = urlparse(url).path
    for ext in [".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".mov"]:
        if path.lower().endswith(ext):
            return ext
    return ".jpg" if item_type == "image" else ".mp4"


# ── Records ──────────────────────────────────────────────────────────────────

@router.get("/records", response_model=List[RecordResponse])
def list_records(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    platform: Optional[str] = None,
    db: Session = Depends(get_db),
):
    q = db.query(DownloadRecord)
    if platform:
        q = q.filter(DownloadRecord.platform == platform)
    q = q.order_by(DownloadRecord.downloaded_at.desc())
    records = q.offset((page - 1) * page_size).limit(page_size).all()

    results = []
    for r in records:
        acct_username = None
        if r.account_id:
            acct = db.query(PlatformAccount).filter(PlatformAccount.id == r.account_id).first()
            acct_username = acct.username if acct else None
        results.append(RecordResponse(
            id=r.id,
            source_url=r.source_url,
            platform=r.platform,
            title=r.title,
            published_at=r.published_at,
            media_count=r.media_count,
            album_id=r.album_id,
            downloaded_at=r.downloaded_at,
            status=r.status,
            error_message=r.error_message,
            account_username=acct_username,
        ))
    return results


@router.post("/records/{record_id}/retry")
async def retry_record(record_id: str, db: Session = Depends(get_db)):
    record = db.query(DownloadRecord).filter(DownloadRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="记录不存在")
    if record.status != "failed":
        raise HTTPException(status_code=400, detail="只能重试失败的记录")

    # Re-parse and re-download
    from scrapers import get_scraper
    scraper = get_scraper(record.source_url)
    if not scraper:
        raise HTTPException(status_code=400, detail="无法识别链接平台")

    try:
        result = await scraper.parse(record.source_url)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"重新解析失败：{e}")

    # Download into same album if exists
    settings = get_settings()
    download_dir = settings.downloads_dir(record.platform)
    download_dir.mkdir(parents=True, exist_ok=True)

    downloaded = 0
    async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
        for i, item in enumerate(result.media_items):
            try:
                resp = await client.get(item.url, headers={
                    "User-Agent": "Mozilla/5.0",
                    "Referer": record.source_url,
                })
                resp.raise_for_status()
                ext = _guess_ext(item.url, resp.headers.get("content-type", ""), item.type)
                filename = f"{uuid.uuid4().hex[:12]}_{i:03d}{ext}"
                filepath = download_dir / filename

                with open(str(filepath), "wb") as f:
                    f.write(resp.content)

                # Determine person_id from album if available
                person_id = None
                if record.album_id:
                    album = db.query(Album).filter(Album.id == record.album_id).first()
                    if album:
                        person_id = album.person_id

                m_type = "video" if item.type == "video" else "image"
                m_size = len(resp.content)
                m_w, m_h = None, None
                if m_type == "image":
                    try:
                        from PIL import Image as PILImage
                        with PILImage.open(str(filepath)) as img:
                            m_w, m_h = img.size
                    except Exception:
                        pass
                media = Media(
                    file_path=str(filepath),
                    media_type=m_type,
                    source_type="local",
                    person_id=person_id,
                    album_id=record.album_id,
                    file_size=m_size,
                    width=m_w,
                    height=m_h,
                )
                db.add(media)
                downloaded += 1
            except Exception as e:
                logger.warning("Retry download failed %s: %s", item.url, e)

    if downloaded > 0:
        record.status = "completed"
        record.media_count = downloaded
        record.error_message = None
    else:
        record.error_message = "重试下载失败：所有图片均下载失败"

    db.commit()
    return {"status": record.status, "media_count": downloaded}


# ── Download info for media ──────────────────────────────────────────────────

class DownloadInfoResponse(BaseModel):
    source_url: str
    platform: str
    title: Optional[str] = None
    published_at: Optional[datetime] = None
    display_name: Optional[str] = None
    username: Optional[str] = None
    downloaded_at: datetime


@router.get("/info-by-album/{album_id}", response_model=Optional[DownloadInfoResponse])
def get_download_info_by_album(album_id: str, db: Session = Depends(get_db)):
    """Get download record info for media in a given album."""
    record = db.query(DownloadRecord).filter(
        DownloadRecord.album_id == album_id,
        DownloadRecord.status == "completed",
    ).order_by(DownloadRecord.downloaded_at.desc()).first()
    if not record:
        return None
    username = None
    display_name = None
    if record.account_id:
        acct = db.query(PlatformAccount).filter(PlatformAccount.id == record.account_id).first()
        if acct:
            username = acct.username
            display_name = acct.display_name
    return DownloadInfoResponse(
        source_url=record.source_url,
        platform=record.platform,
        title=record.title,
        published_at=record.published_at,
        display_name=display_name,
        username=username,
        downloaded_at=record.downloaded_at,
    )


# ── Platform accounts ────────────────────────────────────────────────────────

@router.get("/platform-accounts", response_model=List[AccountResponse])
def list_accounts(db: Session = Depends(get_db)):
    accounts = db.query(PlatformAccount).order_by(PlatformAccount.created_at.desc()).all()
    results = []
    for a in accounts:
        person_name = None
        if a.person_id:
            person = db.query(Person).filter(Person.id == a.person_id).first()
            person_name = person.name if person else None
        results.append(AccountResponse(
            id=a.id,
            platform=a.platform,
            username=a.username,
            display_name=a.display_name,
            person_id=a.person_id,
            person_name=person_name,
            created_at=a.created_at,
        ))
    return results


@router.patch("/platform-accounts/{account_id}")
def update_account(account_id: str, body: AccountUpdate, db: Session = Depends(get_db)):
    acct = db.query(PlatformAccount).filter(PlatformAccount.id == account_id).first()
    if not acct:
        raise HTTPException(status_code=404, detail="账号不存在")
    acct.person_id = body.person_id
    db.commit()
    return {"status": "ok"}


@router.delete("/platform-accounts/{account_id}")
def delete_account(account_id: str, db: Session = Depends(get_db)):
    acct = db.query(PlatformAccount).filter(PlatformAccount.id == account_id).first()
    if not acct:
        raise HTTPException(status_code=404, detail="账号不存在")
    db.delete(acct)
    db.commit()
    return {"status": "ok"}


# ── Account scan & batch download ────────────────────────────────────────────

class ScanAccountRequest(BaseModel):
    platform: str
    username: str  # sec_user_id for douyin, user_id for xhs
    display_name: Optional[str] = None


class ScanJobResponse(BaseModel):
    job_id: str
    status: str
    platform: str
    username: str
    display_name: str
    total_notes: int
    skipped_notes: int = 0
    total_media: int
    completed_notes: int
    failed_notes: int
    downloaded_media: int
    notes: Optional[List[dict]] = None
    error: Optional[str] = None


@router.post("/scan-account")
async def scan_account(body: ScanAccountRequest):
    """Start scanning an account for all notes. Returns job_id for polling."""
    import asyncio
    from batch_downloader import create_scan_job, run_scan

    job = create_scan_job(body.platform, body.username, body.display_name or "")
    task = asyncio.create_task(run_scan(job, db_factory=get_db))
    job._task = task

    return {"job_id": job.id}


@router.get("/scan-jobs/{job_id}", response_model=ScanJobResponse)
def get_scan_job(job_id: str):
    """Poll scan/download job status."""
    from batch_downloader import get_job

    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="任务不存在")

    # Only include notes list when scan is complete (not during download)
    notes = job.notes if job.status == "scan_complete" else None

    return ScanJobResponse(
        job_id=job.id,
        status=job.status,
        platform=job.platform,
        username=job.username,
        display_name=job.display_name,
        total_notes=job.total_notes,
        skipped_notes=job.skipped_notes,
        total_media=job.total_media,
        completed_notes=job.completed_notes,
        failed_notes=job.failed_notes,
        downloaded_media=job.downloaded_media,
        notes=notes,
        error=job.scan_error,
    )


class BatchConfirmRequest(BaseModel):
    job_id: str
    person_id: Optional[str] = None
    create_person_name: Optional[str] = None
    album_mode: str = "per_note"  # per_note / loose
    remember_account: bool = True


@router.post("/batch-confirm")
async def batch_confirm(body: BatchConfirmRequest, db: Session = Depends(get_db)):
    """Confirm batch download after scan completes."""
    import asyncio
    from batch_downloader import get_job, run_batch_download

    job = get_job(body.job_id)
    if not job:
        raise HTTPException(status_code=404, detail="任务不存在")
    if job.status != "scan_complete":
        raise HTTPException(status_code=400, detail=f"任务状态不正确：{job.status}")

    # Resolve person
    person_id = body.person_id
    if not person_id and body.create_person_name:
        person = Person(name=body.create_person_name.strip())
        db.add(person)
        db.flush()
        person_id = person.id

    # Remember account
    if body.remember_account and job.username:
        existing = db.query(PlatformAccount).filter(
            PlatformAccount.platform == job.platform,
            PlatformAccount.username == job.username,
        ).first()
        if existing:
            if person_id:
                existing.person_id = person_id
                existing.display_name = job.display_name
        else:
            db.add(PlatformAccount(
                platform=job.platform,
                username=job.username,
                display_name=job.display_name,
                person_id=person_id,
            ))

    db.commit()

    # Configure job for download
    job.person_id = person_id
    job.album_mode = body.album_mode

    # Start download in background
    task = asyncio.create_task(run_batch_download(job, get_db))
    job._task = task

    return {"job_id": job.id, "status": "downloading"}


@router.post("/scan-jobs/{job_id}/cancel")
def cancel_scan_job(job_id: str):
    """Cancel an in-progress scan or download."""
    from batch_downloader import cancel_job
    if cancel_job(job_id):
        return {"status": "cancelled"}
    raise HTTPException(status_code=404, detail="任务不存在")
