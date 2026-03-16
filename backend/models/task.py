from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    workflow_type: Mapped[str] = mapped_column(String(50), nullable=False)
    params: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")  # pending | running | completed | failed | cancelled
    queue_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    execution_mode: Mapped[str] = mapped_column(String(20), nullable=False, default="queued")  # immediate | queued
    result_media_ids: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON array
    result_outputs: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON dict of outputs (text + image paths)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    # Batch fields — tasks created together in one batch call
    batch_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)

    # Chain fields — tasks linked as A→B execute atomically
    chain_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    chain_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    chain_source_param: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)


class QueueConfig(Base):
    __tablename__ = "queue_config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    start_mode: Mapped[str] = mapped_column(String(20), nullable=False, default="manual")  # manual | auto | cron | delay
    cron_expression: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    delay_minutes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    is_paused: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
