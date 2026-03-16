from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, Integer, String, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class DownloadRecord(Base):
    __tablename__ = "download_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    source_url: Mapped[str] = mapped_column(Text, nullable=False)
    raw_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    platform: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    account_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("platform_accounts.id", ondelete="SET NULL"), nullable=True)
    title: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    published_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    media_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    album_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("albums.id", ondelete="SET NULL"), nullable=True)
    downloaded_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")  # pending/completed/failed
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
