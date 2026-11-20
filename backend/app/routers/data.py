"""Sync endpoint used by the app, plus plain REST access to every collection."""
import uuid
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_current_user
from ..models import User, now_ms
from ..schemas import ChangeIn, SyncIn
from ..services.sync import REGISTRY, apply_changes, pull, serialize

router = APIRouter(tags=["data"])


@router.post("/sync")
def sync(body: SyncIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    result = apply_changes(db, user, body.changes)
    cursor, changes = pull(db, user.id, body.cursor)
    pushed = {ch.id: ch.updated_at for ch in body.changes}
    accepted = set(result["accepted"])
    # don't echo back what the client just sent us
    changes = [c for c in changes if not (c["id"] in accepted and pushed.get(c["id"]) == c["updated_at"])]
    return {
        "cursor": cursor,
        "changes": changes + result["winners"],
        "accepted": result["accepted"],
        "rejected": result["rejected"],
        "server_time": now_ms(),
    }


def _kind(kind: str):
    entry = REGISTRY.get(kind)
    if entry is None:
        raise HTTPException(status_code=404, detail="not_found")
    return entry


@router.get("/data/{kind}")
def list_records(kind: str, since_rev: int = Query(0, ge=0), include_deleted: bool = False,
                 user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    model, _ = _kind(kind)
    q = select(model).where(model.user_id == user.id, model.rev > since_rev)
    if not include_deleted:
        q = q.where(model.deleted.is_(False))
    return {"items": [serialize(kind, obj) for obj in db.scalars(q.order_by(model.rev))]}


@router.get("/data/{kind}/{record_id}")
def get_record(kind: str, record_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    model, _ = _kind(kind)
    obj = db.get(model, record_id)
    if obj is None or obj.user_id != user.id or obj.deleted:
        raise HTTPException(status_code=404, detail="not_found")
    return serialize(kind, obj)


def _write(db: Session, user: User, kind: str, record_id: str, data: dict, deleted: bool = False):
    change = ChangeIn(kind=kind, id=record_id, updated_at=now_ms(), deleted=deleted, data=data)
    result = apply_changes(db, user, [change])
    if result["rejected"]:
        err = result["rejected"][0]
        raise HTTPException(status_code=403 if err["error"] == "forbidden" else 422, detail=err["error"])
    model, _ = REGISTRY[kind]
    return serialize(kind, db.get(model, record_id))


@router.post("/data/{kind}", status_code=201)
def create(kind: str, data: dict = Body(...), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _kind(kind)
    return _write(db, user, kind, str(uuid.uuid4()), data)


@router.put("/data/{kind}/{record_id}")
def upsert(kind: str, record_id: str, data: dict = Body(...), user: User = Depends(get_current_user),
           db: Session = Depends(get_db)):
    _kind(kind)
    return _write(db, user, kind, record_id, data)


@router.delete("/data/{kind}/{record_id}")
def remove(kind: str, record_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    model, _ = _kind(kind)
    obj: Optional[object] = db.get(model, record_id)
    if obj is None or obj.user_id != user.id:  # type: ignore[attr-defined]
        raise HTTPException(status_code=404, detail="not_found")
    _write(db, user, kind, record_id, {}, deleted=True)
    return {"ok": True}
