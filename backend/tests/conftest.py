import os
import sys
import tempfile
import uuid
from pathlib import Path

import pytest

TMP = tempfile.mkdtemp(prefix="makon-test-")
os.environ.update({
    "APP_ENV": "test",
    # set TEST_DATABASE_URL=postgresql://... to run the suite against PostgreSQL
    "DATABASE_URL": os.environ.get("TEST_DATABASE_URL") or f"sqlite:///{TMP}/test.db",
    "SECRET_KEY": "test-secret-key-for-pytest-only-1234567890",
    "FILE_STORAGE": "local",
    "FILES_DIR": f"{TMP}/files",
    "TELEGRAM_BOT_TOKEN": "123:TEST",
    "TELEGRAM_MODE": "webhook",
    "PUBLIC_URL": "https://example.test",
    "CRON_SECRET": "cron-secret",
    "SCHEDULER_ENABLED": "false",
    "ANDROID_PACKAGE": "uz.makon.app",
    "CONTACT_EMAIL": "help@example.com",
    "ANDROID_SHA256": "aa:bb:cc, DD:EE:FF",
})
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.services import telegram  # noqa: E402


class FakeTelegram:
    def __init__(self):
        self.sent = []

    def __call__(self, api_self, method, payload=None, timeout=15):
        self.sent.append((method, payload or {}))
        if method == "getMe":
            return {"ok": True, "result": {"username": "makon_test_bot"}}
        return {"ok": True, "result": {}}

    def messages(self):
        return [p for m, p in self.sent if m == "sendMessage"]


@pytest.fixture(scope="session")
def fake_tg():
    fake = FakeTelegram()
    mp = pytest.MonkeyPatch()

    def fake_call(api_self, method, payload=None, timeout=15):
        return fake(api_self, method, payload, timeout)

    mp.setattr(telegram.TelegramAPI, "call", fake_call)
    yield fake
    mp.undo()


@pytest.fixture(scope="session")
def client(fake_tg):
    with TestClient(app) as c:
        yield c


_counter = {"n": 0}
RUN = uuid.uuid4().hex[:8]  # unique emails, so the suite can rerun against a persistent database


@pytest.fixture()
def user(client):
    from app import security

    security.register_limiter._hits.clear()
    _counter["n"] += 1
    email = f"user{_counter['n']}-{RUN}@example.com"
    r = client.post("/api/auth/register", json={"name": "Ali", "email": email, "password": "secret123", "lang": "uz"})
    assert r.status_code == 200, r.text
    body = r.json()
    return {"email": email, "token": body["token"], "user": body["user"],
            "h": {"Authorization": f"Bearer {body['token']}"}}
