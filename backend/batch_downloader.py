"""In-memory batch download job manager.

Manages scan-account and batch-download jobs with progress tracking.
Jobs are ephemeral (in-memory) — individual downloads create persistent
DownloadRecord entries in the database.
"""
from __future__ import annotations

import asyncio
import logging
import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

logger = logging.getLogger("motif.batch")

# Regex to extract XHS note_id from any URL format
_XHS_NOTE_ID_RE = re.compile(r'/(?:explore|discovery/item)/([a-f0-9]+)')


def _extract_xhs_note_id(url: str) -> str | None:
    """Extract note_id from any XHS URL format (explore, discovery/item, with query params)."""
    m = _XHS_NOTE_ID_RE.search(url)
    return m.group(1) if m else None

# ── Job state ─────────────────────────────────────────────────────────────────


@dataclass
class BatchJob:
    id: str
    platform: str
    username: str
    display_name: str
    status: str = "scanning"  # scanning / scan_complete / downloading / completed / failed / cancelled

    # Scan results
    notes: list[dict] = field(default_factory=list)  # NotePreview as dicts
    scan_error: Optional[str] = None

    # Download config (set at confirm time)
    person_id: Optional[str] = None
    album_mode: str = "per_note"  # per_note / single / loose

    # Download progress
    total_notes: int = 0
    skipped_notes: int = 0  # Already downloaded (dedup)
    completed_notes: int = 0
    failed_notes: int = 0
    total_media: int = 0
    downloaded_media: int = 0

    created_at: datetime = field(default_factory=datetime.now)

    # Internal: asyncio task reference
    _task: Optional[asyncio.Task] = field(default=None, repr=False)


# In-memory job storage
_jobs: dict[str, BatchJob] = {}


def get_job(job_id: str) -> Optional[BatchJob]:
    return _jobs.get(job_id)


def create_scan_job(platform: str, username: str, display_name: str) -> BatchJob:
    job = BatchJob(
        id=uuid.uuid4().hex[:12],
        platform=platform,
        username=username,
        display_name=display_name,
    )
    _jobs[job.id] = job
    return job


def cancel_job(job_id: str) -> bool:
    job = _jobs.get(job_id)
    if not job:
        return False
    job.status = "cancelled"
    if job._task and not job._task.done():
        job._task.cancel()
    return True


async def run_scan(job: BatchJob, db_factory=None) -> None:
    """Background task: scan all notes from an account."""
    from scrapers import SCRAPERS

    scraper = None
    for s in SCRAPERS:
        if s.platform == job.platform:
            scraper = s
            break

    if not scraper:
        job.status = "failed"
        job.scan_error = f"平台 {job.platform} 不支持账号扫描"
        return

    try:
        result = await scraper.list_user_notes(job.username)
        if job.status == "cancelled":
            return

        all_notes = [
            {
                "note_id": n.note_id,
                "url": n.url,
                "title": n.title,
                "media_count": n.media_count,
                "cover_url": n.cover_url,
                "published_at": n.published_at.isoformat() if n.published_at else None,
                "note_type": n.note_type,
                "image_urls": n.image_urls,
            }
            for n in result.notes
        ]

        # Dedup: filter out notes whose media still exists
        # A note is considered "already downloaded" only if:
        #   1. A completed DownloadRecord exists for its note_id, AND
        #   2. The record's album still exists (album_id not NULL) OR
        #      there is at least one non-deleted media in that album
        # This allows re-downloading notes whose albums have been deleted.
        # NOTE: We match by note_id (extracted from URL) rather than full URL,
        # because the same note can have different URL formats:
        #   /explore/{id}  vs  /discovery/item/{id}?share_params...
        already_downloaded_note_ids: set[str] = set()
        if db_factory and all_notes:
            from models.download_record import DownloadRecord
            from models.album import Album
            db = next(db_factory())
            try:
                # Get all completed XHS records and extract note_ids
                existing = db.query(DownloadRecord).filter(
                    DownloadRecord.platform == "xiaohongshu",
                    DownloadRecord.status == "completed",
                ).all()
                for rec in existing:
                    rec_note_id = _extract_xhs_note_id(rec.source_url)
                    if not rec_note_id:
                        continue
                    if rec.album_id:
                        album = db.get(Album, rec.album_id)
                        if album:
                            already_downloaded_note_ids.add(rec_note_id)
                    elif rec.media_count > 0:
                        already_downloaded_note_ids.add(rec_note_id)
            finally:
                db.close()

        new_notes = [n for n in all_notes if n.get("note_id", "") not in already_downloaded_note_ids]
        skipped = len(all_notes) - len(new_notes)

        job.notes = new_notes
        job.skipped_notes = skipped
        job.display_name = result.display_name or job.display_name
        job.total_notes = len(new_notes)
        job.total_media = sum(n.get("media_count", 0) for n in new_notes)
        job.status = "scan_complete"
        logger.info("Scan complete for %s: %d notes (%d skipped), %d media",
                     job.display_name, len(all_notes), skipped, job.total_media)
    except asyncio.CancelledError:
        job.status = "cancelled"
    except Exception as e:
        import traceback
        print(f"[SCAN ERROR] {type(e).__name__}: {e}")
        traceback.print_exc()
        logger.exception("Scan failed for %s", job.username)
        job.status = "failed"
        job.scan_error = str(e)


async def run_batch_download(job: BatchJob, db_factory) -> None:
    """Background task: download all notes sequentially."""
    import httpx
    from config import get_settings
    from models.album import Album
    from models.media import Media
    from models.download_record import DownloadRecord
    from models.platform_account import PlatformAccount
    from scrapers import SCRAPERS

    scraper = None
    for s in SCRAPERS:
        if s.platform == job.platform:
            scraper = s
            break

    if not scraper:
        job.status = "failed"
        return

    settings = get_settings()
    download_dir = settings.downloads_dir(job.platform)
    download_dir.mkdir(parents=True, exist_ok=True)

    notes_to_download = job.notes
    job.status = "downloading"

    for note_data in notes_to_download:
        if job.status == "cancelled":
            break

        note_url = note_data["url"]
        note_title = note_data.get("title", "")
        # Use pre-collected image URLs from scan phase (avoids re-parsing each note)
        image_urls = note_data.get("image_urls", [])

        db = next(db_factory())
        try:
            # If no pre-collected URLs, fall back to parsing (for single-note or legacy)
            if not image_urls:
                print(f"[BATCH] No pre-collected URLs, parsing note: {note_url}")
                result = await scraper.parse(note_url)
                image_urls = [item.url for item in result.media_items]
                print(f"[BATCH] Parsed: {len(image_urls)} media items")

            if not image_urls:
                print(f"[BATCH] Note has no media items, skipping: {note_url}")
                logger.warning("Note %s has no media items, skipping", note_url)
                job.failed_notes += 1
                db.close()
                continue

            print(f"[BATCH] Downloading {len(image_urls)} images for: {note_title[:30]}")

            # Download media files first, create album only if something succeeds
            downloaded_files: list[dict] = []
            async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
                for i, img_url in enumerate(image_urls):
                    try:
                        resp = await client.get(img_url, headers={
                            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                            "Referer": note_url,
                        })
                        resp.raise_for_status()

                        ext = _guess_ext(img_url, resp.headers.get("content-type", ""), "image")
                        filename = f"{uuid.uuid4().hex[:12]}_{i:03d}{ext}"
                        filepath = download_dir / filename

                        with open(str(filepath), "wb") as f:
                            f.write(resp.content)

                        width, height = None, None
                        try:
                            from PIL import Image as PILImage
                            with PILImage.open(str(filepath)) as img:
                                width, height = img.size
                        except Exception:
                            pass

                        downloaded_files.append({
                            "file_path": str(filepath),
                            "media_type": "image",
                            "file_size": len(resp.content),
                            "width": width,
                            "height": height,
                        })
                        job.downloaded_media += 1
                    except Exception as e:
                        logger.warning("Failed to download %s: %s", img_url, e)

            # Create album only if we have downloaded files
            album_id = None
            if downloaded_files and job.album_mode == "per_note":
                album = Album(
                    name=note_title or "下载图集",
                    person_id=job.person_id,
                )
                db.add(album)
                db.flush()
                album_id = album.id

            # Create Media records
            for f_info in downloaded_files:
                media = Media(
                    file_path=f_info["file_path"],
                    media_type=f_info["media_type"],
                    source_type="local",
                    person_id=job.person_id,
                    album_id=album_id,
                    file_size=f_info["file_size"],
                    width=f_info["width"],
                    height=f_info["height"],
                )
                db.add(media)

            note_downloaded = len(downloaded_files)

            # Parse published_at from note_data
            note_published_at = None
            if note_data.get("published_at"):
                try:
                    from datetime import datetime as _dt
                    note_published_at = _dt.fromisoformat(note_data["published_at"])
                except Exception:
                    pass

            # Create download record (use canonical URL for dedup)
            record = DownloadRecord(
                source_url=note_url,
                platform=job.platform,
                title=note_title,
                published_at=note_published_at,
                media_count=note_downloaded,
                album_id=album_id,
                status="completed" if note_downloaded > 0 else "failed",
            )
            # Link account
            acct = db.query(PlatformAccount).filter(
                PlatformAccount.platform == job.platform,
                PlatformAccount.username == job.username,
            ).first()
            if acct:
                record.account_id = acct.id
            db.add(record)

            db.commit()
            job.completed_notes += 1
            logger.info("Downloaded note %d/%d: %s (%d media)",
                         job.completed_notes, job.total_notes, note_title[:30], note_downloaded)

        except asyncio.CancelledError:
            db.rollback()
            job.status = "cancelled"
            return
        except Exception as e:
            db.rollback()
            import traceback
            print(f"[DOWNLOAD ERROR] Note {note_url}: {type(e).__name__}: {e}")
            traceback.print_exc()
            logger.warning("Failed to process note %s: %s", note_url, e)
            job.failed_notes += 1
            job.scan_error = f"最近失败: {type(e).__name__}: {e}"
        finally:
            db.close()

        # Rate limit between notes
        if job.status != "cancelled":
            await asyncio.sleep(1.0)

    if job.status != "cancelled":
        job.status = "completed"
        logger.info("Batch download complete: %d/%d notes, %d media",
                     job.completed_notes, job.total_notes, job.downloaded_media)


def _guess_ext(url: str, content_type: str, item_type: str) -> str:
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
    from urllib.parse import urlparse
    path = urlparse(url).path
    for ext in [".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".mov"]:
        if path.lower().endswith(ext):
            return ext
    return ".jpg" if item_type == "image" else ".mp4"
