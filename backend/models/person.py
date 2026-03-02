from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, List, Optional

from sqlalchemy import DateTime, Float, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base

if TYPE_CHECKING:
    from models.album import Album
    from models.media import Media


class Person(Base):
    __tablename__ = "persons"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    cover_media_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    avg_rating: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    rated_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    albums: Mapped[List["Album"]] = relationship("Album", back_populates="person", cascade="all, delete-orphan")
    media_items: Mapped[List["Media"]] = relationship("Media", back_populates="person", foreign_keys="Media.person_id")
