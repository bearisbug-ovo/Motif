from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


@dataclass
class MediaItem:
    url: str
    type: str  # "image" or "video"
    thumb_url: Optional[str] = None


@dataclass
class ScraperResult:
    platform: str
    source_url: str
    username: str
    display_name: str
    title: str
    published_at: Optional[datetime]
    media_items: list[MediaItem] = field(default_factory=list)
    # Platform-specific extra data (e.g. sec_uid for Douyin)
    extra: dict = field(default_factory=dict)

    @property
    def media_count(self) -> int:
        return len(self.media_items)


@dataclass
class NotePreview:
    """Lightweight preview of a single note/post from an account scan."""
    note_id: str
    url: str
    title: str
    media_count: int = 0
    cover_url: Optional[str] = None
    published_at: Optional[datetime] = None
    note_type: str = "image"  # "image" or "video"
    # Full-res image URLs collected during scan (avoids needing to re-parse each note)
    image_urls: list[str] = field(default_factory=list)


@dataclass
class AccountScanResult:
    """Result of scanning an account for all notes."""
    platform: str
    username: str
    display_name: str
    notes: list[NotePreview] = field(default_factory=list)
    has_more: bool = False
    cursor: Optional[str] = None

    @property
    def total_notes(self) -> int:
        return len(self.notes)

    @property
    def total_media(self) -> int:
        return sum(n.media_count for n in self.notes)


class BaseScraper(ABC):
    platform: str

    @abstractmethod
    def extract_url(self, text: str) -> Optional[str]:
        """Extract a URL this scraper can handle from raw text. Returns None if no match."""
        ...

    @abstractmethod
    async def parse(self, url: str) -> ScraperResult:
        """Parse the URL and return structured metadata + media list."""
        ...

    async def list_user_notes(
        self, user_id: str, cursor: Optional[str] = None
    ) -> AccountScanResult:
        """List notes from a user account. Override in subclass to support."""
        raise NotImplementedError(f"{self.platform} 暂不支持账号扫描")
