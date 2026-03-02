from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base

if TYPE_CHECKING:
    from models.album import Album
    from models.person import Person


class Media(Base):
    __tablename__ = "media"
    __table_args__ = (
        Index("ix_media_person_deleted", "person_id", "is_deleted"),
        Index("ix_media_album_sort", "album_id", "sort_order"),
        Index("ix_media_rating", "rating"),
        Index("ix_media_deleted_at", "is_deleted", "deleted_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    album_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("albums.id", ondelete="CASCADE"), nullable=True, index=True)
    person_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("persons.id", ondelete="SET NULL"), nullable=True)
    file_path: Mapped[str] = mapped_column(String(2000), nullable=False)
    media_type: Mapped[str] = mapped_column(String(10), nullable=False, default="image")  # image | video
    source_type: Mapped[str] = mapped_column(String(20), nullable=False, default="local")  # local | generated | screenshot
    parent_media_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    workflow_type: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    generation_params: Mapped[Optional[str]] = mapped_column(String(5000), nullable=True)  # JSON
    upscale_status: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # pending | running | done | failed | skipped
    rating: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # 1-5
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    thumbnail_path: Mapped[Optional[str]] = mapped_column(String(2000), nullable=True)
    width: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    height: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    file_size: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    deleted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    album: Mapped[Optional["Album"]] = relationship("Album", back_populates="media_items")
    person: Mapped[Optional["Person"]] = relationship("Person", back_populates="media_items", foreign_keys=[person_id])
