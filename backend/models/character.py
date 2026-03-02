from datetime import datetime
from sqlalchemy import String, Text, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from database import Base


class Character(Base):
    __tablename__ = "characters"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    # Source folder path (from scan-import; None for manually created)
    source_folder: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    # JSON array of filepath strings (absolute paths for native, relative for uploads)
    reference_photos: Mapped[str] = mapped_column(Text, default="[]")
    # Path to face_crop_nobg image (Inspyrenet processed, white background)
    face_crop_nobg: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow
    )
