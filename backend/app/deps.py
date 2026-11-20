"""FastAPI dependencies."""
import ipaddress

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from .models import User
from .security import decode_token


def _valid_ip(value: str) -> str:
    value = (value or "").strip()
    try:
        return str(ipaddress.ip_address(value))
    except ValueError:
        return ""


def client_ip(request: Request) -> str:
    """Best-effort client address for rate limiting.

    Never trusts the left side of X-Forwarded-For: a client can put anything there and proxies
    only append to it. Order: a header set by the edge proxy itself (Cloudflare on Render),
    then X-Forwarded-For counted from the right by the number of trusted proxies, then the socket.
    """
    settings = get_settings()
    for name in settings.client_ip_headers:
        ip = _valid_ip(request.headers.get(name, ""))
        if ip:
            return ip
    hops = settings.trusted_proxy_hops
    if hops:
        chain = [p.strip() for p in request.headers.get("x-forwarded-for", "").split(",") if p.strip()]
        if len(chain) >= hops:
            ip = _valid_ip(chain[-hops])
            if ip:
                return ip
    return request.client.host if request.client else "unknown"


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="unauthorized")
    payload = decode_token(auth[7:].strip())
    if not payload:
        raise HTTPException(status_code=401, detail="unauthorized")
    user = db.get(User, str(payload.get("sub", "")))
    if user is None or int(payload.get("ver", -1)) != user.token_version:
        raise HTTPException(status_code=401, detail="unauthorized")
    return user
