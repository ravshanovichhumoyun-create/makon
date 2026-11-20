"""Exports, calendar feed, Telegram linking/webhook, cron and health endpoints."""
import hmac
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from ..config import APP_VERSION, FRONTEND_DIR, get_settings
from ..db import get_db, session_scope
from ..deps import client_ip, get_current_user
from ..models import User
from ..schemas import DATE_RE, LANG_PATTERN
from ..security import RateLimiter
from ..services import exports, weather
from ..services.telegram import get_api, handle_update, link_expiry, make_link_code, run_reminders

router = APIRouter(tags=["misc"])
weather_limiter = RateLimiter(limit=120, window_seconds=3600)


@router.get("/health")
def health(db: Session = Depends(get_db)):
    """Also touches the database, so the cron ping keeps a free Supabase project from pausing."""
    try:
        db.execute(text("SELECT 1"))
        db_ok = True
    except Exception:
        db_ok = False
    return {"ok": True, "db": db_ok, "version": APP_VERSION}


@router.get("/config")
def public_config():
    settings = get_settings()
    username = get_api().username() if settings.telegram_mode != "off" else None
    return {
        "app": settings.app_name,
        "version": APP_VERSION,
        "files": {"enabled": settings.files_enabled, "max_mb": settings.max_file_mb},
        "telegram": {"enabled": settings.telegram_mode != "off", "bot": username},
        "weather": {"enabled": settings.weather_enabled},
        "images": {"max_kb": settings.max_image_kb},
        "android_apk": "/download/makon.apk" if (FRONTEND_DIR / "download" / "makon.apk").is_file() else None,
    }


# ---------------------------------------------------------------- weather


def _weather_guard(request: Request, user: User) -> None:
    if not get_settings().weather_enabled:
        raise HTTPException(status_code=503, detail="weather_disabled")
    if not weather_limiter.hit(user.id) or not weather_limiter.hit(f"ip:{client_ip(request)}"):
        raise HTTPException(status_code=429, detail="too_many_attempts")


@router.get("/weather")
def get_weather(
    request: Request,
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    user: User = Depends(get_current_user),
):
    _weather_guard(request, user)
    try:
        return weather.forecast(lat, lon, user.tz or "Asia/Tashkent")
    except weather.WeatherError:
        raise HTTPException(status_code=502, detail="weather_unavailable")


@router.get("/geo")
def geo_search(
    request: Request,
    q: str = Query(..., min_length=2, max_length=80),
    lang: str = Query("uz", pattern=LANG_PATTERN),
    user: User = Depends(get_current_user),
):
    _weather_guard(request, user)
    try:
        return {"results": weather.search_city(q, lang)}
    except weather.WeatherError:
        raise HTTPException(status_code=502, detail="weather_unavailable")


# ---------------------------------------------------------------- exports


@router.get("/export/transactions.{fmt}")
def export_transactions(
    fmt: str,
    start: Optional[str] = Query(None, alias="from"),
    end: Optional[str] = Query(None, alias="to"),
    lang: str = Query("uz", pattern=LANG_PATTERN),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    for value in (start, end):
        if value and not DATE_RE.match(value):
            raise HTTPException(status_code=422, detail="invalid")
    rows = exports.transaction_rows(db, user, start, end, lang)
    stem = "makon-moliya" if lang == "uz" else "makon-finance"
    if fmt == "csv":
        body, media = exports.to_csv(rows, lang), "text/csv; charset=utf-8"
    elif fmt == "xlsx":
        body, media = exports.to_xlsx(rows, lang), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    else:
        raise HTTPException(status_code=404, detail="not_found")
    return Response(body, media_type=media, headers={"Content-Disposition": f'attachment; filename="{stem}.{fmt}"'})


@router.get("/calendar/{token}.ics")
def calendar_feed(token: str, lang: Optional[str] = Query(None, pattern=LANG_PATTERN), db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.calendar_token == token)) if len(token) >= 16 else None
    if user is None:
        raise HTTPException(status_code=404, detail="not_found")
    body = exports.build_ics(db, user, lang or user.lang)
    return Response(body, media_type="text/calendar; charset=utf-8",
                    headers={"Content-Disposition": 'inline; filename="makon.ics"', "Cache-Control": "no-cache"})


# ---------------------------------------------------------------- telegram


@router.post("/telegram/link")
def telegram_link(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    settings = get_settings()
    if settings.telegram_mode == "off":
        raise HTTPException(status_code=503, detail="telegram_disabled")
    username = get_api().username()
    if not username:
        raise HTTPException(status_code=502, detail="telegram_unavailable")
    user.telegram_link_code = make_link_code()
    user.telegram_link_expires = link_expiry()
    db.commit()
    return {"url": f"https://t.me/{username}?start={user.telegram_link_code}", "bot": username}


@router.post("/telegram/unlink")
def telegram_unlink(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    user.telegram_chat_id = None
    user.telegram_username = None
    db.commit()
    return {"ok": True}


def _process_update(update: dict) -> None:
    with session_scope() as db:
        handle_update(db, update)


@router.post("/telegram/webhook")
async def telegram_webhook(request: Request, secret: Optional[str] = Header(None, alias="X-Telegram-Bot-Api-Secret-Token")):
    settings = get_settings()
    if settings.telegram_mode != "webhook" or not secret or not hmac.compare_digest(
        secret, settings.telegram_webhook_secret
    ):
        raise HTTPException(status_code=403, detail="forbidden")
    try:
        update = await request.json()
    except ValueError:
        return {"ok": True}
    try:
        await run_in_threadpool(_process_update, update)
    except Exception:  # never make Telegram retry a broken update forever
        import logging

        logging.getLogger("makon.telegram").exception("update failed")
    return {"ok": True}


# ---------------------------------------------------------------- cron


def _run_reminders_job() -> dict:
    with session_scope() as db:
        return run_reminders(db)


@router.api_route("/cron/tick", methods=["GET", "POST"])
async def cron_tick(key: Optional[str] = Query(None), x_cron_key: Optional[str] = Header(None)):
    settings = get_settings()
    given = key or x_cron_key or ""
    if not settings.cron_secret or not hmac.compare_digest(given, settings.cron_secret):
        raise HTTPException(status_code=403, detail="forbidden")
    result = await run_in_threadpool(_run_reminders_job)
    return {"ok": True, **result}
