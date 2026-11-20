"""PDF upload / download (cloud copy of library books)."""
import tempfile
import uuid
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..deps import get_current_user
from ..models import StoredFile, User
from ..services.storage import StorageError, get_storage
from ..services.sync import delete_file_quietly

router = APIRouter(prefix="/files", tags=["files"])


@router.post("")
def upload(file: UploadFile = File(...), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    settings = get_settings()
    storage = get_storage()
    if storage is None:
        raise HTTPException(status_code=503, detail="files_disabled")
    limit = settings.max_file_mb * 1024 * 1024
    size = 0
    with tempfile.SpooledTemporaryFile(max_size=4 * 1024 * 1024) as tmp:
        head = b""
        while True:
            chunk = file.file.read(256 * 1024)
            if not chunk:
                break
            if not head:
                head = chunk[:5]
            size += len(chunk)
            if size > limit:
                raise HTTPException(status_code=413, detail="file_too_large")
            tmp.write(chunk)
        if size == 0 or head != b"%PDF-":
            raise HTTPException(status_code=415, detail="not_pdf")
        tmp.seek(0)
        file_id = str(uuid.uuid4())
        key = f"{user.id}/{file_id}.pdf"
        try:
            storage.save(key, tmp, size, "application/pdf")
        except StorageError:
            raise HTTPException(status_code=502, detail="storage_error")
    name = (file.filename or "book.pdf").replace("/", "_").replace("\\", "_")[:255]
    row = StoredFile(id=file_id, user_id=user.id, name=name, size=size, storage_key=key)
    db.add(row)
    db.commit()
    return {"id": row.id, "name": row.name, "size": row.size}


@router.get("/{file_id}")
def download(file_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.get(StoredFile, file_id)
    storage = get_storage()
    if row is None or row.user_id != user.id or storage is None:
        raise HTTPException(status_code=404, detail="not_found")
    try:
        stream = storage.open_stream(row.storage_key)
    except StorageError:
        raise HTTPException(status_code=404, detail="not_found")
    headers = {
        "Content-Disposition": f"inline; filename*=UTF-8''{quote(row.name)}",
        "Content-Length": str(row.size),
        "Cache-Control": "private, max-age=0",
    }
    return StreamingResponse(stream, media_type="application/pdf", headers=headers)


@router.delete("/{file_id}")
def remove(file_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.get(StoredFile, file_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(status_code=404, detail="not_found")
    delete_file_quietly(db, user.id, file_id)
    return {"ok": True}
