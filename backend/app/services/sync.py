"""Offline-first sync: clients push changes and pull everything newer than their cursor.

Conflict rule: last write wins by `updated_at` (client clock, clamped to server time).
Each accepted write gets the user's next revision number, so a pull with `rev > cursor`
never misses a change (the users row is locked while the counter is bumped).
"""
import logging
from typing import Any, Dict, List, Optional, Tuple, Type

from pydantic import BaseModel, ValidationError
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..models import (
    Book, Category, Challenge, Course, Goal, Image, Note, Plan, Project, StoredFile, Task, TimetableItem,
    Transaction, User, now_ms,
)
from ..schemas import (
    BookData, CategoryData, ChallengeData, ChangeIn, CourseData, GoalData, NoteData, PlanData, ProjectData,
    TaskData, TimetableData, TransactionData,
)
from .defaults import DEFAULT_CATEGORIES, FALLBACK_KEY, category_id

log = logging.getLogger("makon.sync")

REGISTRY: Dict[str, Tuple[Type, Type[BaseModel]]] = {
    "categories": (Category, CategoryData),
    "transactions": (Transaction, TransactionData),
    "goals": (Goal, GoalData),
    "books": (Book, BookData),
    "courses": (Course, CourseData),
    "tasks": (Task, TaskData),
    "timetable": (TimetableItem, TimetableData),
    "projects": (Project, ProjectData),
    "notes": (Note, NoteData),
    "plans": (Plan, PlanData),
    "challenges": (Challenge, ChallengeData),
}

SERVER_ONLY_FIELDS = {"reminded_at"}
MAX_FUTURE_MS = 5 * 60 * 1000


def data_fields(kind: str) -> List[str]:
    return list(REGISTRY[kind][1].model_fields.keys())


def serialize(kind: str, obj: Any) -> Dict[str, Any]:
    data = {f: getattr(obj, f) for f in data_fields(kind) if f not in SERVER_ONLY_FIELDS}
    return {
        "kind": kind,
        "id": obj.id,
        "created_at": obj.created_at,
        "updated_at": obj.updated_at,
        "deleted": bool(obj.deleted),
        "rev": obj.rev,
        "data": data if not obj.deleted else {},
    }


def bump_rev(db: Session, user_id: str) -> int:
    """Atomically increment the user's revision counter (row lock until commit)."""
    db.execute(update(User).where(User.id == user_id).values(rev=User.rev + 1))
    return int(db.execute(select(User.rev).where(User.id == user_id)).scalar_one())


def seed_default_categories(db: Session, user: User) -> None:
    rev = bump_rev(db, user.id)
    ts = now_ms()
    for i, cat in enumerate(DEFAULT_CATEGORIES):
        db.add(Category(
            id=category_id(user.id, cat["key"]), user_id=user.id, type=cat["type"], key=cat["key"], name="",
            icon=cat["icon"], color=cat["color"], monthly_limit=None, sort=i, created_at=ts, updated_at=ts,
            deleted=False, rev=rev,
        ))


def _cascade_delete(db: Session, user_id: str, kind: str, obj: Any, rev: int, ts: int, after_commit: List) -> None:
    if kind == "courses":
        tasks = db.scalars(select(Task).where(Task.user_id == user_id, Task.course_id == obj.id, Task.deleted.is_(False)))
        for t in tasks:
            t.deleted, t.updated_at, t.rev = True, ts, rev
        items = db.scalars(select(TimetableItem).where(TimetableItem.user_id == user_id, TimetableItem.course_id == obj.id))
        for it in items:
            it.course_id, it.updated_at, it.rev = None, ts, rev
    elif kind == "books" and (obj.file_id or obj.cover_id):
        if obj.file_id:
            after_commit.append(("delete_file", obj.file_id))
        if obj.cover_id:
            after_commit.append(("delete_image", obj.cover_id))
    elif kind == "categories" and obj.key in FALLBACK_KEY.values():
        # fallback categories can't be removed: transactions rely on them
        obj.deleted = False


def apply_changes(db: Session, user: User, changes: List[ChangeIn]) -> Dict[str, Any]:
    """Apply client changes. Returns accepted ids, rejected items and server versions that won."""
    accepted: List[str] = []
    rejected: List[Dict[str, str]] = []
    winners: List[Dict[str, Any]] = []
    after_commit: List[Tuple[str, str]] = []
    rev: Optional[int] = None
    server_now = now_ms()

    for ch in changes:
        entry = REGISTRY.get(ch.kind)
        if entry is None:
            rejected.append({"kind": ch.kind, "id": ch.id, "error": "unknown_kind"})
            continue
        model, schema = entry
        obj = db.get(model, ch.id)
        if obj is not None and obj.user_id != user.id:
            rejected.append({"kind": ch.kind, "id": ch.id, "error": "forbidden"})
            continue
        updated_at = min(ch.updated_at, server_now + MAX_FUTURE_MS)
        if obj is not None and obj.updated_at > updated_at:
            winners.append(serialize(ch.kind, obj))
            continue

        if ch.deleted:
            if obj is None or obj.deleted:
                accepted.append(ch.id)
                continue
            if rev is None:
                rev = bump_rev(db, user.id)
            obj.deleted, obj.updated_at, obj.rev = True, updated_at, rev
            _cascade_delete(db, user.id, ch.kind, obj, rev, updated_at, after_commit)
            if not obj.deleted:  # protected record: tell the client the server version
                winners.append(serialize(ch.kind, obj))
                continue
            accepted.append(ch.id)
            continue

        try:
            data = schema.model_validate(ch.data).model_dump()
        except ValidationError as exc:
            rejected.append({"kind": ch.kind, "id": ch.id, "error": "invalid", "detail": str(exc.errors()[:3])})
            continue

        if rev is None:
            rev = bump_rev(db, user.id)
        if obj is None:
            obj = model(id=ch.id, user_id=user.id, created_at=ch.created_at or updated_at)
            db.add(obj)
        elif ch.kind == "tasks" and (obj.due_date != data.get("due_date") or obj.due_time != data.get("due_time")):
            obj.reminded_at = None
        elif ch.kind == "books":
            if obj.file_id and obj.file_id != data.get("file_id"):
                after_commit.append(("delete_file", obj.file_id))
            if obj.cover_id and obj.cover_id != data.get("cover_id"):
                after_commit.append(("delete_image", obj.cover_id))
        for field, value in data.items():
            setattr(obj, field, value)
        obj.deleted, obj.updated_at, obj.rev = False, updated_at, rev
        db.flush()
        accepted.append(ch.id)

    db.commit()
    for action, ref in after_commit:
        if action == "delete_file":
            delete_file_quietly(db, user.id, ref)
        elif action == "delete_image":
            delete_image_quietly(db, user.id, ref)
    return {"accepted": accepted, "rejected": rejected, "winners": winners}


def pull(db: Session, user_id: str, cursor: int) -> Tuple[int, List[Dict[str, Any]]]:
    # Read the counter first: anything committed later has a higher rev and comes next time.
    current = int(db.execute(select(User.rev).where(User.id == user_id)).scalar_one())
    out: List[Dict[str, Any]] = []
    for kind, (model, _schema) in REGISTRY.items():
        q = select(model).where(model.user_id == user_id, model.rev > cursor, model.rev <= current)
        if cursor == 0:
            q = q.where(model.deleted.is_(False))
        out.extend(serialize(kind, obj) for obj in db.scalars(q))
    return current, out


def create_record(db: Session, user: User, kind: str, record_id: str, data: Dict[str, Any]) -> Any:
    """Server-side insert (used by the Telegram bot) going through the same validation and rev logic."""
    model, schema = REGISTRY[kind]
    clean = schema.model_validate(data).model_dump()
    rev = bump_rev(db, user.id)
    ts = now_ms()
    obj = model(id=record_id, user_id=user.id, created_at=ts, updated_at=ts, deleted=False, rev=rev, **clean)
    db.add(obj)
    db.commit()
    return obj


def soft_delete(db: Session, user: User, kind: str, obj: Any) -> None:
    rev = bump_rev(db, user.id)
    obj.deleted, obj.updated_at, obj.rev = True, now_ms(), rev
    db.commit()


def delete_image_quietly(db: Session, user_id: str, image_id: Optional[str]) -> None:
    """Remove a picture the user no longer references (old cover, avatar, background)."""
    if not image_id:
        return
    try:
        row = db.get(Image, image_id)
        if row is not None and row.user_id == user_id:
            db.delete(row)
            db.commit()
    except Exception:
        db.rollback()
        log.exception("could not delete image %s", image_id)


def delete_file_quietly(db: Session, user_id: str, file_id: str) -> None:
    from .storage import get_storage  # local import avoids a cycle

    try:
        row = db.get(StoredFile, file_id)
        if row is None or row.user_id != user_id:
            return
        storage = get_storage()
        if storage is not None:
            storage.delete(row.storage_key)
        db.delete(row)
        db.commit()
    except Exception:  # storage errors must never break sync
        db.rollback()
        log.exception("could not delete file %s", file_id)
