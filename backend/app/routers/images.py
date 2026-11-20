"""Small pictures: profile photo, home background, book covers.

The app resizes pictures on the device (JPEG/WebP, a few hundred KB) and uploads them with an id it
chose itself, so a book can point at its cover even before the upload finishes (offline first).
Bytes are checked by their signature, never trusted from the file name or the browser's type.
"""
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..deps import get_current_user
from ..models import Image, User
from ..schemas import ID_RE

router = APIRouter(prefix="/images", tags=["images"])

KINDS = {"avatar", "background", "cover"}


def sniff_image(head: bytes) -> Optional[str]:
    """MIME type from the file signature (only formats every browser can show safely; no SVG)."""
    if head[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if head[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    return None


@router.put("/{image_id}")
def put_image(
    image_id: str,
    kind: str = Form(...),
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not ID_RE.match(image_id) or kind not in KINDS:
        raise HTTPException(status_code=422, detail="invalid")
    settings = get_settings()
    limit = settings.max_image_kb * 1024
    data = file.file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(status_code=413, detail="file_too_large")
    mime = sniff_image(data[:16])
    if not data or mime is None:
        raise HTTPException(status_code=415, detail="not_image")

    row = db.get(Image, image_id)
    if row is not None:
        if row.user_id != user.id:
            raise HTTPException(status_code=403, detail="forbidden")
        if row.size == len(data):  # repeated upload of the same picture (retry after a lost reply)
            return {"id": row.id, "size": row.size}
        raise HTTPException(status_code=409, detail="exists")
    count = db.scalar(select(func.count()).select_from(Image).where(Image.user_id == user.id)) or 0
    if count >= settings.max_images_per_user:
        raise HTTPException(status_code=507, detail="too_many_images")
    db.add(Image(id=image_id, user_id=user.id, kind=kind, mime=mime, size=len(data), data=data))
    db.commit()
    return {"id": image_id, "size": len(data)}


@router.get("/{image_id}")
def get_image(image_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.get(Image, image_id) if ID_RE.match(image_id) else None
    if row is None or row.user_id != user.id:
        raise HTTPException(status_code=404, detail="not_found")
    # ids never get new content, so the browser may keep it; "private" keeps shared caches out
    return Response(row.data, media_type=row.mime, headers={
        "Cache-Control": "private, max-age=31536000, immutable",
        "Content-Disposition": "inline",
    })


@router.delete("/{image_id}")
def delete_image(image_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.get(Image, image_id) if ID_RE.match(image_id) else None
    if row is None or row.user_id != user.id:
        raise HTTPException(status_code=404, detail="not_found")
    db.delete(row)
    db.commit()
    return {"ok": True}
