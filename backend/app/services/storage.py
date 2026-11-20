"""PDF storage backends: local disk (development / VPS) or Supabase Storage (free cloud)."""
import logging
import shutil
from pathlib import Path
from typing import BinaryIO, Iterator
from urllib.parse import quote

import httpx

from ..config import get_settings

log = logging.getLogger("makon.storage")
CHUNK = 256 * 1024


class StorageError(Exception):
    pass


class LocalStorage:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        path = (self.root / key).resolve()
        if self.root.resolve() not in path.parents:
            raise StorageError("bad key")
        return path

    def save(self, key: str, fileobj: BinaryIO, size: int, content_type: str) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "wb") as out:
            shutil.copyfileobj(fileobj, out, CHUNK)

    def open_stream(self, key: str) -> Iterator[bytes]:
        path = self._path(key)
        if not path.is_file():
            raise StorageError("not found")

        def gen() -> Iterator[bytes]:
            with open(path, "rb") as f:
                while True:
                    chunk = f.read(CHUNK)
                    if not chunk:
                        break
                    yield chunk

        return gen()

    def delete(self, key: str) -> None:
        path = self._path(key)
        if path.is_file():
            path.unlink()


class SupabaseStorage:
    """Supabase Storage REST API with the service-role key (bucket stays private)."""

    def __init__(self, url: str, key: str, bucket: str) -> None:
        self.base = f"{url}/storage/v1"
        self.bucket = bucket
        self.headers = {"Authorization": f"Bearer {key}", "apikey": key}

    def _object_url(self, key: str) -> str:
        return f"{self.base}/object/{self.bucket}/{quote(key)}"

    def ensure_bucket(self) -> None:
        try:
            r = httpx.post(
                f"{self.base}/bucket", headers=self.headers, timeout=20,
                json={"id": self.bucket, "name": self.bucket, "public": False},
            )
            if r.status_code not in (200, 201, 400, 409):
                log.warning("bucket check returned %s: %s", r.status_code, r.text[:200])
        except httpx.HTTPError as exc:
            log.warning("bucket check failed: %s", exc)

    def save(self, key: str, fileobj: BinaryIO, size: int, content_type: str) -> None:
        def body() -> Iterator[bytes]:
            while True:
                chunk = fileobj.read(CHUNK)
                if not chunk:
                    break
                yield chunk

        headers = dict(self.headers)
        headers.update({"Content-Type": content_type, "x-upsert": "true", "Content-Length": str(size)})
        try:
            r = httpx.post(self._object_url(key), headers=headers, content=body(), timeout=300)
        except httpx.HTTPError as exc:
            raise StorageError(str(exc)) from exc
        if r.status_code >= 300:
            raise StorageError(f"upload failed: {r.status_code} {r.text[:200]}")

    def open_stream(self, key: str) -> Iterator[bytes]:
        client = httpx.Client(timeout=httpx.Timeout(30, read=120))
        try:
            req = client.build_request("GET", self._object_url(key), headers=self.headers)
            resp = client.send(req, stream=True)
        except httpx.HTTPError as exc:
            client.close()
            raise StorageError(str(exc)) from exc
        if resp.status_code >= 300:
            resp.close()
            client.close()
            raise StorageError("not found")

        def gen() -> Iterator[bytes]:
            try:
                for chunk in resp.iter_bytes(CHUNK):
                    yield chunk
            finally:
                resp.close()
                client.close()

        return gen()

    def delete(self, key: str) -> None:
        try:
            httpx.request(
                "DELETE", f"{self.base}/object/{self.bucket}", headers=self.headers,
                json={"prefixes": [key]}, timeout=30,
            )
        except httpx.HTTPError as exc:
            log.warning("delete failed for %s: %s", key, exc)


_storage = None
_initialised = False


def get_storage():
    """Return the configured backend, or None when cloud files are disabled."""
    global _storage, _initialised
    if _initialised:
        return _storage
    settings = get_settings()
    if settings.file_storage == "supabase":
        _storage = SupabaseStorage(settings.supabase_url, settings.supabase_key, settings.supabase_bucket)
    elif settings.file_storage == "local":
        _storage = LocalStorage(settings.files_dir)
    else:
        _storage = None
    _initialised = True
    return _storage


def reset_storage() -> None:
    global _storage, _initialised
    _storage, _initialised = None, False
