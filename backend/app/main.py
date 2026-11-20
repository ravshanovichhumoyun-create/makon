"""Makon — FastAPI application: JSON API under /api and the PWA frontend at /."""
import asyncio
import hashlib
import logging
import mimetypes
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from .config import APP_VERSION, FRONTEND_DIR, get_settings
from .db import create_tables, init_engine, session_scope
from .routers import auth, data, files, images, misc
from .services.storage import SupabaseStorage, get_storage
from .services.telegram import get_api, handle_update, run_reminders, setup_bot

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
# Module scripts are rejected by browsers unless served with a JavaScript MIME type.
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("application/vnd.android.package-archive", ".apk")
log = logging.getLogger("makon")


# ---------------------------------------------------------------- background jobs


def _reminders_job() -> None:
    with session_scope() as db:
        result = run_reminders(db)
        if any(result.values()):
            log.info("reminders sent: %s", result)


async def scheduler_loop() -> None:
    while True:
        try:
            await run_in_threadpool(_reminders_job)
        except Exception:
            log.exception("scheduler error")
        await asyncio.sleep(60)


def _process_update(update: dict) -> None:
    with session_scope() as db:
        handle_update(db, update)


async def polling_loop() -> None:
    """Local development without a public URL: long-poll Telegram instead of a webhook."""
    api = get_api()
    await run_in_threadpool(api.call, "deleteWebhook", {"drop_pending_updates": False})
    offset = 0
    async with httpx.AsyncClient(timeout=40) as client:
        while True:
            try:
                r = await client.post(f"{api.base}/getUpdates", json={
                    "offset": offset, "timeout": 25, "allowed_updates": ["message", "callback_query"],
                })
                payload = r.json()
                for update in payload.get("result", []):
                    offset = update["update_id"] + 1
                    try:
                        await run_in_threadpool(_process_update, update)
                    except Exception:
                        log.exception("update failed")
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.warning("polling error: %s", exc)
                await asyncio.sleep(5)


def _startup_side_effects() -> None:
    settings = get_settings()
    if settings.telegram_mode != "off":
        setup_bot(get_api())
    storage = get_storage()
    if isinstance(storage, SupabaseStorage):
        storage.ensure_bucket()


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    init_engine(settings.database_url)
    create_tables()
    log.info("Makon %s | db=%s | files=%s | telegram=%s", APP_VERSION, settings.database_url.split(":")[0],
             settings.file_storage, settings.telegram_mode)
    tasks = [asyncio.create_task(asyncio.to_thread(_startup_side_effects))]
    if settings.scheduler_enabled and settings.telegram_mode != "off":
        tasks.append(asyncio.create_task(scheduler_loop()))
    if settings.telegram_mode == "polling":
        tasks.append(asyncio.create_task(polling_loop()))
    try:
        yield
    finally:
        for task in tasks:
            task.cancel()


# ---------------------------------------------------------------- app

app = FastAPI(
    title="Makon API", version=APP_VERSION, lifespan=lifespan,
    docs_url="/api/docs", redoc_url=None, openapi_url="/api/openapi.json",
)

_settings = get_settings()
if _settings.cors_origins:
    app.add_middleware(
        CORSMiddleware, allow_origins=_settings.cors_origins, allow_methods=["*"],
        allow_headers=["Authorization", "Content-Type"],
    )
app.add_middleware(GZipMiddleware, minimum_size=1000)

CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
    "font-src 'self'; connect-src 'self'; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; "
    "form-action 'self'; frame-ancestors 'self'; manifest-src 'self'; worker-src 'self'"
)


HSTS = "max-age=31536000; includeSubDomains"


def _body_limit(path: str) -> int:
    """Largest request body accepted for a path (checked before anything is read)."""
    if path.startswith("/api/files"):
        return (_settings.max_file_mb + 1) * 1024 * 1024
    if path.startswith("/api/images"):
        return _settings.max_image_kb * 1024 + 64 * 1024
    return 20 * 1024 * 1024


@app.middleware("http")
async def security_headers(request: Request, call_next):
    length = request.headers.get("content-length")
    if length is not None:
        try:
            too_big = int(length) > _body_limit(request.url.path)
        except ValueError:
            too_big = True
        if too_big:
            return JSONResponse({"error": "file_too_large"}, status_code=413)
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
    response.headers.setdefault("Cross-Origin-Resource-Policy", "same-origin")
    # geolocation only for this site itself (weather "use my location")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=(self), payment=()")
    if _settings.public_url.startswith("https://"):
        response.headers.setdefault("Strict-Transport-Security", HSTS)
    if not request.url.path.startswith("/api/docs"):
        response.headers.setdefault("Content-Security-Policy", CSP)
    if request.url.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-store")
    elif "Cache-Control" not in response.headers:
        response.headers["Cache-Control"] = "no-cache"
    return response


@app.exception_handler(StarletteHTTPException)
async def http_error(request: Request, exc: StarletteHTTPException):
    return JSONResponse({"error": exc.detail if isinstance(exc.detail, str) else "error"}, status_code=exc.status_code)


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    fields = [".".join(str(p) for p in e.get("loc", [])[1:]) for e in exc.errors()]
    return JSONResponse({"error": "invalid", "fields": fields}, status_code=422)


@app.exception_handler(Exception)
async def server_error(request: Request, exc: Exception):
    log.exception("unhandled error on %s", request.url.path)
    return JSONResponse({"error": "server_error"}, status_code=500)


for r in (auth.router, data.router, files.router, images.router, misc.router):
    app.include_router(r, prefix="/api")


@app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
def api_not_found(path: str):
    raise HTTPException(status_code=404, detail="not_found")


# ---------------------------------------------------------------- frontend


def _build_hash() -> str:
    h = hashlib.sha256(APP_VERSION.encode())
    for path in sorted(FRONTEND_DIR.rglob("*")):
        if path.is_file() and path.name != "sw.js" and not path.name.endswith(".apk"):
            h.update(str(path.relative_to(FRONTEND_DIR)).encode())
            h.update(path.read_bytes())
    return h.hexdigest()[:12]


BUILD = _build_hash() if FRONTEND_DIR.is_dir() else "dev"


def _shell_assets() -> list:
    """Everything the app needs offline (the large PDF reader is cached on first use instead)."""
    out = ["/"]
    for path in sorted(FRONTEND_DIR.rglob("*")):
        rel = path.relative_to(FRONTEND_DIR).as_posix()
        if path.is_file() and not rel.startswith(("vendor/", "download/", ".")) and "/." not in rel and rel not in ("sw.js", "index.html"):
            out.append("/" + rel)
    return out


@app.get("/sw.js", include_in_schema=False)
def service_worker():
    import json

    source = (FRONTEND_DIR / "sw.js").read_text(encoding="utf-8")
    source = source.replace("__BUILD__", BUILD).replace("__ASSETS__", json.dumps(_shell_assets()))
    return Response(source, media_type="application/javascript",
                    headers={"Cache-Control": "no-cache", "Service-Worker-Allowed": "/"})


@app.get("/.well-known/assetlinks.json", include_in_schema=False)
def assetlinks():
    """Digital Asset Links: proves to Android that the Play Store app and this site belong together."""
    settings = get_settings()
    if not settings.android_package or not settings.android_fingerprints:
        raise HTTPException(status_code=404, detail="not_found")
    return JSONResponse([{
        "relation": ["delegate_permission/common.handle_all_urls"],
        "target": {
            "namespace": "android_app",
            "package_name": settings.android_package,
            "sha256_cert_fingerprints": settings.android_fingerprints,
        },
    }])


@app.get("/privacy", include_in_schema=False)
@app.get("/privacy.html", include_in_schema=False)
def privacy():
    email = get_settings().contact_email or "—"
    page = (FRONTEND_DIR / "privacy.html").read_text(encoding="utf-8").replace("CONTACT_EMAIL", email)
    return Response(page, media_type="text/html; charset=utf-8")


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(FRONTEND_DIR / "index.html", headers={"Cache-Control": "no-cache"})


if FRONTEND_DIR.is_dir():
    app.mount("/", StaticFiles(directory=Path(FRONTEND_DIR), html=False), name="frontend")
