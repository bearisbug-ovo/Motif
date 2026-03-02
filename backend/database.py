"""Database engine setup with SQLite WAL mode."""
from __future__ import annotations

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from config import get_settings


def _get_engine():
    settings = get_settings()
    db_path = settings.db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    url = f"sqlite:///{db_path}"
    eng = create_engine(url, connect_args={"check_same_thread": False})

    @event.listens_for(eng, "connect")
    def set_sqlite_pragma(dbapi_conn, _connection_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    return eng


engine = _get_engine()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
