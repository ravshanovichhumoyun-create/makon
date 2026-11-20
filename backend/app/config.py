"""Application settings, read from environment variables (and an optional .env file)."""
import hashlib
import hmac
import os
import secrets
from functools import lru_cache
from pathlib import Path
from typing import List

BACKEND_DIR = Path(__file__).resolve().parent.parent
ROOT_DIR = BACKEND_DIR.parent
FRONTEND_DIR = ROOT_DIR / "frontend"
DATA_DIR = Path(os.getenv("DATA_DIR") or (ROOT_DIR / "data"))

APP_VERSION = "1.0.0"


def _load_env_file(path: Path) -> None:
    """Minimal .env loader: KEY=VALUE lines, existing env vars win."""
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        os.environ.setdefault(key, value)


_load_env_file(ROOT_DIR / ".env")


def _bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, "").strip() or default)
    except ValueError:
        return default


def normalize_db_url(url: str) -> str:
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


def _dev_secret() -> str:
    """Stable secret for local development, stored under data/."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    path = DATA_DIR / ".secret_key"
    if path.is_file():
        return path.read_text().strip()
    value = secrets.token_urlsafe(48)
    path.write_text(value)
    return value


class Settings:
    def __init__(self) -> None:
        self.app_name = os.getenv("APP_NAME", "Makon")
        self.env = os.getenv("APP_ENV", "production" if os.getenv("RENDER") else "development")
        self.is_production = self.env == "production"

        db_url = os.getenv("DATABASE_URL", "").strip()
        if not db_url:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            db_url = "sqlite:///" + str(DATA_DIR / "makon.db")
        self.database_url = normalize_db_url(db_url)

        secret = os.getenv("SECRET_KEY", "").strip()
        if not secret:
            if self.is_production:
                raise RuntimeError("SECRET_KEY must be set in production")
            secret = _dev_secret()
        self.secret_key = secret
        self.token_days = _int("TOKEN_DAYS", 30)

        self.public_url = (os.getenv("PUBLIC_URL") or os.getenv("RENDER_EXTERNAL_URL") or "").rstrip("/")
        self.cors_origins: List[str] = [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]

        # Client IP for rate limiting. X-Forwarded-For can be forged by the client (proxies append to it),
        # so it is only trusted from the right: TRUSTED_PROXY_HOPS = how many proxies sit in front of the app.
        # Render runs behind Cloudflare, which overwrites True-Client-IP / CF-Connecting-IP itself.
        on_render = bool(os.getenv("RENDER"))
        default_header = "true-client-ip,cf-connecting-ip" if on_render else ""
        self.client_ip_headers: List[str] = [
            h.strip().lower() for h in os.getenv("CLIENT_IP_HEADER", default_header).split(",") if h.strip()
        ]
        self.trusted_proxy_hops = max(0, _int("TRUSTED_PROXY_HOPS", 1 if on_render else 0))

        # Telegram
        self.telegram_token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
        mode = os.getenv("TELEGRAM_MODE", "auto").strip().lower()
        if not self.telegram_token:
            mode = "off"
        elif mode == "auto":
            mode = "webhook" if self.public_url.startswith("https://") else "off"
        self.telegram_mode = mode
        self.telegram_webhook_secret = os.getenv("TELEGRAM_WEBHOOK_SECRET") or hmac.new(
            self.secret_key.encode(), b"telegram-webhook", hashlib.sha256
        ).hexdigest()[:48]

        # Background scheduler (reminders, morning digest)
        self.scheduler_enabled = _bool("SCHEDULER_ENABLED", True)
        self.cron_secret = os.getenv("CRON_SECRET", "").strip()

        # File storage for PDFs
        self.supabase_url = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
        self.supabase_key = os.getenv("SUPABASE_SERVICE_KEY", "").strip()
        self.supabase_bucket = os.getenv("SUPABASE_BUCKET", "books").strip() or "books"
        storage = os.getenv("FILE_STORAGE", "auto").strip().lower()
        if storage == "auto":
            if self.supabase_url and self.supabase_key:
                storage = "supabase"
            elif os.getenv("RENDER"):
                # Render free disks are wiped on restart: never pretend files are safe there.
                storage = "none"
            else:
                storage = "local"
        self.file_storage = storage
        self.files_dir = Path(os.getenv("FILES_DIR") or (DATA_DIR / "files"))

        self.contact_email = os.getenv("CONTACT_EMAIL", "").strip()

        # Google Play (Trusted Web Activity): package name + SHA-256 signing fingerprints
        self.android_package = os.getenv("ANDROID_PACKAGE", "").strip()
        self.android_fingerprints: List[str] = [
            f.strip().upper().replace(" ", "") for f in os.getenv("ANDROID_SHA256", "").split(",") if f.strip()
        ]
        self.max_file_mb = _int("MAX_FILE_MB", 50)

        # Pictures (avatar, background, book covers) live in the database: small, resized on the device.
        self.max_image_kb = _int("MAX_IMAGE_KB", 1536)
        self.max_images_per_user = _int("MAX_IMAGES_PER_USER", 400)

        # Weather: Open-Meteo (free, no key). WEATHER_ENABLED=false turns the widget off.
        self.weather_enabled = _bool("WEATHER_ENABLED", True)

    @property
    def files_enabled(self) -> bool:
        return self.file_storage in ("local", "supabase")


@lru_cache()
def get_settings() -> Settings:
    return Settings()
