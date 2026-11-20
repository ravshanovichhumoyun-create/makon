"""Password hashing (PBKDF2-SHA256, stdlib only) and JWT access tokens."""
import base64
import hashlib
import hmac
import secrets
import threading
import time
from collections import defaultdict, deque
from typing import Deque, Dict, Optional

import jwt

from .config import get_settings

PBKDF2_ITERATIONS = 240_000
JWT_ALG = "HS256"


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iterations, salt_b64, digest_b64 = stored.split("$", 3)
        if algo != "pbkdf2_sha256":
            return False
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(digest_b64)
        digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, int(iterations))
        return hmac.compare_digest(digest, expected)
    except (ValueError, TypeError):
        return False


# Used to keep login timing similar whether or not the e-mail exists.
DUMMY_HASH = hash_password(secrets.token_urlsafe(16))


def create_token(user_id: str, token_version: int) -> str:
    settings = get_settings()
    now = int(time.time())
    payload = {"sub": user_id, "ver": token_version, "iat": now, "exp": now + settings.token_days * 86400}
    return jwt.encode(payload, settings.secret_key, algorithm=JWT_ALG)


def decode_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, get_settings().secret_key, algorithms=[JWT_ALG])
    except jwt.PyJWTError:
        return None


class RateLimiter:
    """Small in-memory sliding-window limiter (enough for a single instance)."""

    def __init__(self, limit: int, window_seconds: int) -> None:
        self.limit = limit
        self.window = window_seconds
        self._hits: Dict[str, Deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def hit(self, key: str) -> bool:
        """Register an attempt; returns False when the key is over the limit."""
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > self.window:
                q.popleft()
            if len(q) >= self.limit:
                return False
            q.append(now)
            if len(self._hits) > 10000:  # keep memory bounded
                for k in list(self._hits.keys())[:5000]:
                    if not self._hits[k]:
                        del self._hits[k]
            return True

    def blocked(self, key: str) -> bool:
        """True when the key is at the limit, without registering a new attempt."""
        now = time.monotonic()
        with self._lock:
            q = self._hits.get(key)
            if not q:
                return False
            while q and now - q[0] > self.window:
                q.popleft()
            return len(q) >= self.limit

    def reset(self, key: str) -> None:
        with self._lock:
            self._hits.pop(key, None)


# Per IP + e-mail: stops one client hammering one account.
login_limiter = RateLimiter(limit=10, window_seconds=600)
# Per account, whatever the IP: failed passwords only. Stops brute force even when the
# attacker rotates IP addresses (the account cools down for 15 minutes after 10 misses).
login_fail_limiter = RateLimiter(limit=10, window_seconds=900)
register_limiter = RateLimiter(limit=5, window_seconds=3600)
# Whole server: caps sign-ups even if IP-based limiting is bypassed.
register_global_limiter = RateLimiter(limit=60, window_seconds=3600)
# Password reset: code requests per account / per IP, and wrong-code guesses per account.
reset_request_limiter = RateLimiter(limit=3, window_seconds=900)
reset_ip_limiter = RateLimiter(limit=10, window_seconds=3600)
reset_confirm_limiter = RateLimiter(limit=20, window_seconds=3600)


def hash_code(code: str) -> str:
    """Keyed hash of a one-time code (the plain code is never stored)."""
    return hmac.new(get_settings().secret_key.encode(), f"reset:{code}".encode(), hashlib.sha256).hexdigest()


def new_reset_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"
