"""SQLAlchemy models.

Every user-owned record shares the same sync columns (SyncMixin):
  id          client-generated UUID (lets devices create records offline)
  user_id     owner
  created_at  / updated_at   epoch milliseconds (last-write-wins on updated_at)
  deleted     soft delete, so other devices learn about removals
  rev         per-user revision counter used as the sync cursor
"""
import time
from typing import List, Optional

from sqlalchemy import JSON, BigInteger, Boolean, Float, ForeignKey, Index, Integer, LargeBinary, String, Text
from sqlalchemy.orm import Mapped, declared_attr, mapped_column

from .db import Base


def now_ms() -> int:
    return int(time.time() * 1000)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(80))
    password_hash: Mapped[str] = mapped_column(String(255))
    lang: Mapped[str] = mapped_column(String(5), default="uz")
    tz: Mapped[str] = mapped_column(String(64), default="Asia/Tashkent")
    currency: Mapped[str] = mapped_column(String(8), default="UZS")
    monthly_budget: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    token_version: Mapped[int] = mapped_column(Integer, default=0)
    rev: Mapped[int] = mapped_column(BigInteger, default=0)
    created_at: Mapped[int] = mapped_column(BigInteger, default=now_ms)

    telegram_chat_id: Mapped[Optional[int]] = mapped_column(BigInteger, unique=True, nullable=True)
    telegram_username: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    telegram_link_code: Mapped[Optional[str]] = mapped_column(String(32), unique=True, nullable=True)
    telegram_link_expires: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    digest_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    digest_time: Mapped[str] = mapped_column(String(5), default="07:30")
    remind_minutes: Mapped[int] = mapped_column(Integer, default=60)
    last_digest_date: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)

    calendar_token: Mapped[str] = mapped_column(String(64), unique=True, index=True)

    # Look: profile picture and home background ("" = animated scene, "g:<preset>", "img:<image id>")
    avatar_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    background: Mapped[str] = mapped_column(String(80), default="")
    # Weather location (name shown on the home screen + coordinates for the forecast)
    city: Mapped[str] = mapped_column(String(80), default="")
    lat: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    lon: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Password reset through the linked Telegram bot: keyed hash of a 6-digit code, expiry, wrong guesses
    reset_code_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    reset_expires: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    reset_attempts: Mapped[int] = mapped_column(Integer, default=0)


class SyncMixin:
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    created_at: Mapped[int] = mapped_column(BigInteger, default=now_ms)
    updated_at: Mapped[int] = mapped_column(BigInteger, default=now_ms)
    deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    rev: Mapped[int] = mapped_column(BigInteger, default=0)

    @declared_attr
    def user_id(cls) -> Mapped[str]:
        return mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True)

    @declared_attr.directive
    def __table_args__(cls):
        return (Index(f"ix_{cls.__tablename__}_user_rev", "user_id", "rev"),)


class Category(SyncMixin, Base):
    __tablename__ = "categories"

    type: Mapped[str] = mapped_column(String(10))  # expense | income
    key: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)  # built-in category key
    name: Mapped[str] = mapped_column(String(60), default="")
    icon: Mapped[str] = mapped_column(String(16), default="")
    color: Mapped[str] = mapped_column(String(16), default="")
    monthly_limit: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    sort: Mapped[int] = mapped_column(Integer, default=0)


class Transaction(SyncMixin, Base):
    __tablename__ = "transactions"

    type: Mapped[str] = mapped_column(String(10))
    amount: Mapped[int] = mapped_column(BigInteger)
    category_id: Mapped[str] = mapped_column(String(64))
    date: Mapped[str] = mapped_column(String(10), index=True)
    note: Mapped[str] = mapped_column(String(500), default="")
    source: Mapped[str] = mapped_column(String(16), default="manual")


class Goal(SyncMixin, Base):
    __tablename__ = "goals"

    title: Mapped[str] = mapped_column(String(120))
    target: Mapped[int] = mapped_column(BigInteger)
    saved: Mapped[int] = mapped_column(BigInteger, default=0)
    deadline: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    icon: Mapped[str] = mapped_column(String(16), default="")
    color: Mapped[str] = mapped_column(String(16), default="")


class Book(SyncMixin, Base):
    __tablename__ = "books"

    title: Mapped[str] = mapped_column(String(200))
    author: Mapped[str] = mapped_column(String(120), default="")
    category: Mapped[str] = mapped_column(String(32), default="other")
    total_pages: Mapped[int] = mapped_column(Integer, default=0)
    read_pages: Mapped[int] = mapped_column(Integer, default=0)
    description: Mapped[str] = mapped_column(String(1000), default="")
    file_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    file_name: Mapped[str] = mapped_column(String(255), default="")
    file_size: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    cover_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    finished_at: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)


class Course(SyncMixin, Base):
    __tablename__ = "courses"

    name: Mapped[str] = mapped_column(String(120))
    teacher: Mapped[str] = mapped_column(String(120), default="")
    room: Mapped[str] = mapped_column(String(120), default="")
    description: Mapped[str] = mapped_column(String(1000), default="")
    color: Mapped[str] = mapped_column(String(16), default="indigo")
    notes: Mapped[str] = mapped_column(Text, default="")


class Task(SyncMixin, Base):
    __tablename__ = "tasks"

    course_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(300))
    kind: Mapped[str] = mapped_column(String(16), default="homework")
    due_date: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    due_time: Mapped[Optional[str]] = mapped_column(String(5), nullable=True)
    done: Mapped[bool] = mapped_column(Boolean, default=False)
    done_at: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    # Server-only: when the Telegram reminder was sent (not synced to clients).
    reminded_at: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)


class TimetableItem(SyncMixin, Base):
    __tablename__ = "timetable"

    title: Mapped[str] = mapped_column(String(120))
    weekday: Mapped[int] = mapped_column(Integer)  # 1 = Monday ... 7 = Sunday
    start: Mapped[str] = mapped_column(String(5))
    end: Mapped[str] = mapped_column(String(5))
    kind: Mapped[str] = mapped_column(String(16), default="lecture")
    location: Mapped[str] = mapped_column(String(120), default="")
    course_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)


class Project(SyncMixin, Base):
    __tablename__ = "projects"

    title: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(16), default="planned")
    deadline: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    tags: Mapped[List[str]] = mapped_column(JSON, default=list)
    link: Mapped[str] = mapped_column(String(500), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    subtasks: Mapped[list] = mapped_column(JSON, default=list)


class Note(SyncMixin, Base):
    __tablename__ = "notes"

    title: Mapped[str] = mapped_column(String(200), default="")
    content: Mapped[str] = mapped_column(Text, default="")
    color: Mapped[str] = mapped_column(String(16), default="amber")
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    tag: Mapped[str] = mapped_column(String(40), default="")


class Plan(SyncMixin, Base):
    """A to-do for a given day ("what I will do today")."""

    __tablename__ = "plans"

    title: Mapped[str] = mapped_column(String(300))
    date: Mapped[str] = mapped_column(String(10), index=True)
    time: Mapped[Optional[str]] = mapped_column(String(5), nullable=True)
    done: Mapped[bool] = mapped_column(Boolean, default=False)
    done_at: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)


class Challenge(SyncMixin, Base):
    """A habit challenge: N days from start_date, one check-in per day."""

    __tablename__ = "challenges"

    title: Mapped[str] = mapped_column(String(120))
    icon: Mapped[str] = mapped_column(String(16), default="🔥")
    color: Mapped[str] = mapped_column(String(16), default="indigo")
    days: Mapped[int] = mapped_column(Integer, default=30)
    start_date: Mapped[str] = mapped_column(String(10))
    goal: Mapped[str] = mapped_column(String(300), default="")
    checkins: Mapped[list] = mapped_column(JSON, default=list)
    stopped: Mapped[bool] = mapped_column(Boolean, default=False)


class Image(Base):
    """Small pictures (avatar, home background, book covers), resized on the device before upload."""

    __tablename__ = "images"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(16))
    mime: Mapped[str] = mapped_column(String(32))
    size: Mapped[int] = mapped_column(Integer)
    data: Mapped[bytes] = mapped_column(LargeBinary)
    created_at: Mapped[int] = mapped_column(BigInteger, default=now_ms)


class StoredFile(Base):
    """Metadata for uploaded PDFs (the bytes live in the storage backend)."""

    __tablename__ = "files"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    size: Mapped[int] = mapped_column(BigInteger)
    content_type: Mapped[str] = mapped_column(String(100), default="application/pdf")
    storage_key: Mapped[str] = mapped_column(String(300))
    created_at: Mapped[int] = mapped_column(BigInteger, default=now_ms)
