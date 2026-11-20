"""Registration, login, password reset (via the linked Telegram bot) and profile."""
import hmac
import logging
import secrets
import uuid
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..deps import client_ip, get_current_user
from ..models import Image, StoredFile, User, now_ms
from ..schemas import (
    LoginIn, PasswordChangeIn, PasswordConfirmIn, ProfilePatch, RegisterIn, ResetConfirmIn, ResetRequestIn,
)
from ..security import (
    DUMMY_HASH, create_token, hash_code, hash_password, login_fail_limiter, login_limiter, new_reset_code,
    register_global_limiter, register_limiter, reset_confirm_limiter, reset_ip_limiter, reset_request_limiter,
    verify_password,
)
from ..services import texts
from ..services.storage import get_storage
from ..services.sync import REGISTRY, delete_image_quietly, seed_default_categories
from ..services.telegram import get_api

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    from backports.zoneinfo import ZoneInfo  # type: ignore

log = logging.getLogger("makon.auth")
router = APIRouter(prefix="/auth", tags=["auth"])

RESET_TTL_MS = 10 * 60 * 1000
RESET_MAX_ATTEMPTS = 5


def _valid_tz(tz: str) -> str:
    try:
        ZoneInfo(tz)
        return tz
    except Exception:
        return "Asia/Tashkent"


def user_out(user: User) -> Dict[str, Any]:
    settings = get_settings()
    base = settings.public_url
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "lang": user.lang,
        "tz": user.tz,
        "currency": user.currency,
        "monthly_budget": user.monthly_budget,
        "digest_enabled": user.digest_enabled,
        "digest_time": user.digest_time,
        "remind_minutes": user.remind_minutes,
        "avatar_id": user.avatar_id,
        "background": user.background or "",
        "city": user.city or "",
        "lat": user.lat,
        "lon": user.lon,
        "telegram": {"linked": user.telegram_chat_id is not None, "username": user.telegram_username},
        "calendar_path": f"/api/calendar/{user.calendar_token}.ics",
        "calendar_url": f"{base}/api/calendar/{user.calendar_token}.ics" if base else None,
    }


def _session(user: User) -> Dict[str, Any]:
    return {"token": create_token(user.id, user.token_version), "user": user_out(user)}


def _norm_email(value: str) -> str:
    return (value or "").strip().lower()


@router.post("/register")
def register(body: RegisterIn, request: Request, db: Session = Depends(get_db)):
    if not register_limiter.hit(client_ip(request)) or not register_global_limiter.hit("all"):
        raise HTTPException(status_code=429, detail="too_many_attempts")
    if db.scalar(select(User).where(User.email == body.email)) is not None:
        raise HTTPException(status_code=409, detail="email_taken")
    user = User(
        id=str(uuid.uuid4()), email=body.email, name=body.name, password_hash=hash_password(body.password),
        lang=body.lang, tz=_valid_tz(body.tz), calendar_token=secrets.token_urlsafe(24),
        token_version=0, rev=0,
    )
    db.add(user)
    db.flush()
    seed_default_categories(db, user)
    db.commit()
    return _session(user)


@router.post("/login")
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    email = _norm_email(body.email)
    key = f"{client_ip(request)}|{email}"
    # The per-account limit does not depend on the IP, so rotating addresses does not help an attacker.
    if login_fail_limiter.blocked(email) or not login_limiter.hit(key):
        raise HTTPException(status_code=429, detail="too_many_attempts")
    user = db.scalar(select(User).where(User.email == email))
    if user is None:
        verify_password(body.password, DUMMY_HASH)
        login_fail_limiter.hit(email)
        raise HTTPException(status_code=401, detail="bad_credentials")
    if not verify_password(body.password, user.password_hash):
        login_fail_limiter.hit(email)
        raise HTTPException(status_code=401, detail="bad_credentials")
    login_limiter.reset(key)
    login_fail_limiter.reset(email)
    return _session(user)


# ---------------------------------------------------------------- password reset


@router.post("/reset/request")
def reset_request(body: ResetRequestIn, request: Request, db: Session = Depends(get_db)):
    """Send a 6-digit code to the Telegram chat linked to this account.

    The answer is the same whether or not the e-mail exists or has Telegram linked,
    so the endpoint cannot be used to find out who has an account.
    """
    settings = get_settings()
    if settings.telegram_mode == "off":
        raise HTTPException(status_code=503, detail="reset_unavailable")
    email = _norm_email(body.email)
    if not reset_ip_limiter.hit(client_ip(request)) or not reset_request_limiter.hit(email):
        raise HTTPException(status_code=429, detail="too_many_attempts")
    user = db.scalar(select(User).where(User.email == email))
    if user is not None and user.telegram_chat_id:
        code = new_reset_code()
        user.reset_code_hash = hash_code(code)
        user.reset_expires = now_ms() + RESET_TTL_MS
        user.reset_attempts = 0
        db.commit()
        try:
            get_api().send(user.telegram_chat_id, texts.t(user.lang, "reset_code", code=code))
        except Exception:  # pragma: no cover - network trouble must not reveal anything
            log.exception("could not send reset code")
    return {"ok": True}


@router.post("/reset/confirm")
def reset_confirm(body: ResetConfirmIn, request: Request, db: Session = Depends(get_db)):
    if not reset_confirm_limiter.hit(client_ip(request)):
        raise HTTPException(status_code=429, detail="too_many_attempts")
    email = _norm_email(body.email)
    user = db.scalar(select(User).where(User.email == email))
    valid = (
        user is not None and user.reset_code_hash and (user.reset_expires or 0) >= now_ms()
        and (user.reset_attempts or 0) < RESET_MAX_ATTEMPTS
    )
    if not valid:
        raise HTTPException(status_code=400, detail="bad_code")
    if not hmac.compare_digest(hash_code(body.code), user.reset_code_hash):
        user.reset_attempts = (user.reset_attempts or 0) + 1
        if user.reset_attempts >= RESET_MAX_ATTEMPTS:
            user.reset_code_hash = None
            user.reset_expires = None
        db.commit()
        raise HTTPException(status_code=400, detail="bad_code")
    user.password_hash = hash_password(body.password)
    user.token_version += 1  # every old session ends
    user.reset_code_hash = None
    user.reset_expires = None
    user.reset_attempts = 0
    db.commit()
    login_fail_limiter.reset(email)
    if user.telegram_chat_id:
        try:
            get_api().send(user.telegram_chat_id, texts.t(user.lang, "reset_done"))
        except Exception:  # pragma: no cover
            log.exception("could not send reset notice")
    return _session(user)


# ---------------------------------------------------------------- profile


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return user_out(user)


def _own_image(db: Session, user: User, image_id: Optional[str]) -> bool:
    if not image_id:
        return True
    row = db.get(Image, image_id)
    return row is not None and row.user_id == user.id


@router.patch("/me")
def update_me(body: ProfilePatch, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    fields = body.model_fields_set
    old_images = []
    for name in ("name", "lang", "digest_enabled", "digest_time", "remind_minutes"):
        value = getattr(body, name)
        if name in fields and value is not None:
            setattr(user, name, value)
    if "tz" in fields and body.tz:
        user.tz = _valid_tz(body.tz)
    if "monthly_budget" in fields:
        user.monthly_budget = body.monthly_budget or None
    if "avatar_id" in fields:
        new_id = body.avatar_id or None
        if not _own_image(db, user, new_id):
            raise HTTPException(status_code=422, detail="invalid")
        if user.avatar_id and user.avatar_id != new_id:
            old_images.append(user.avatar_id)
        user.avatar_id = new_id
    if "background" in fields and body.background is not None:
        new_bg = body.background
        new_img = new_bg[4:] if new_bg.startswith("img:") else None
        if not _own_image(db, user, new_img):
            raise HTTPException(status_code=422, detail="invalid")
        old = user.background or ""
        if old.startswith("img:") and old != new_bg:
            old_images.append(old[4:])
        user.background = new_bg
    if "city" in fields or "lat" in fields or "lon" in fields:
        if (body.lat is None) != (body.lon is None):
            raise HTTPException(status_code=422, detail="invalid")
        user.city = (body.city or "").strip()[:80]
        user.lat = round(body.lat, 4) if body.lat is not None else None
        user.lon = round(body.lon, 4) if body.lon is not None else None
    db.commit()
    for image_id in old_images:
        delete_image_quietly(db, user.id, image_id)
    return user_out(user)


@router.post("/password")
def change_password(body: PasswordChangeIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not verify_password(body.current, user.password_hash):
        raise HTTPException(status_code=400, detail="wrong_password")
    user.password_hash = hash_password(body.new)
    user.token_version += 1  # signs out every other device
    db.commit()
    return _session(user)


@router.post("/logout-all")
def logout_all(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    user.token_version += 1
    db.commit()
    return _session(user)


@router.post("/calendar-reset")
def reset_calendar(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    user.calendar_token = secrets.token_urlsafe(24)
    db.commit()
    return user_out(user)


@router.post("/delete")
def delete_account(body: PasswordConfirmIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=400, detail="wrong_password")
    storage = get_storage()
    for row in db.scalars(select(StoredFile).where(StoredFile.user_id == user.id)):
        if storage is not None:
            try:
                storage.delete(row.storage_key)
            except Exception:
                pass
    db.execute(delete(StoredFile).where(StoredFile.user_id == user.id))
    db.execute(delete(Image).where(Image.user_id == user.id))
    for model, _schema in REGISTRY.values():
        db.execute(delete(model).where(model.user_id == user.id))
    db.delete(user)
    db.commit()
    return {"ok": True}
