from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, List, Optional

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base

if TYPE_CHECKING:
    from models.media import Media
    from models.person import Person


class Album(Base):
    __tablename__ = "albums"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    person_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("persons.id", ondelete="CASCADE"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(300), nullable=False)
    cover_media_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    is_generated_album: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    source_face_media_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    avg_rating: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    rated_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    person: Mapped[Optional["Person"]] = relationship("Person", back_populates="albums")
    media_items: Mapped[List["Media"]] = relationship("Media", back_populates="album", cascade="all, delete-orphan")
