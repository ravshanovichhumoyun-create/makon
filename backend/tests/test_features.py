"""Security fixes and the newer features: password reset, pictures, weather, plans, challenges, Russian."""
import re
import struct
import time
import uuid
import zlib
from datetime import datetime, timezone

from sqlalchemy import create_engine, inspect, text

from app import security
from app.config import get_settings
from app.db import Base, add_missing_columns, session_scope
from app.models import Image, User
from app.services import weather
from app.services.telegram import run_reminders


def now():
    return int(time.time() * 1000)


def change(kind, data, rid=None, ts=None, deleted=False):
    return {"kind": kind, "id": rid or str(uuid.uuid4()), "updated_at": ts or now(), "deleted": deleted, "data": data}


def sync(client, user, changes=(), cursor=0):
    r = client.post("/api/sync", json={"cursor": cursor, "changes": list(changes)}, headers=user["h"])
    assert r.status_code == 200, r.text
    return r.json()


def png(w=2, h=2):
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    raw = b"".join(b"\x00" + b"\xff\x00\x00" * w for _ in range(h))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def upload_image(client, user, kind="cover", data=None, image_id=None):
    image_id = image_id or str(uuid.uuid4())
    r = client.put(f"/api/images/{image_id}", data={"kind": kind},
                   files={"file": ("pic.png", data if data is not None else png(), "image/png")}, headers=user["h"])
    return image_id, r


def link_telegram(user, chat_id):
    with session_scope() as db:
        db.get(User, user["user"]["id"]).telegram_chat_id = chat_id


def clear_limiters():
    for lim in (security.login_limiter, security.login_fail_limiter, security.reset_request_limiter,
                security.reset_ip_limiter, security.reset_confirm_limiter):
        lim._hits.clear()


# ---------------------------------------------------------------- security


def test_forged_forwarded_for_cannot_bypass_login_limit(client, user):
    clear_limiters()
    codes = []
    for i in range(12):
        r = client.post("/api/auth/login", json={"email": user["email"], "password": "nope"},
                        headers={"X-Forwarded-For": f"10.0.0.{i}"})
        codes.append(r.status_code)
    assert codes[:10] == [401] * 10 and codes[10:] == [429, 429]
    # even the right password waits until the account cools down
    r = client.post("/api/auth/login", json={"email": user["email"], "password": "secret123"},
                    headers={"X-Forwarded-For": "10.9.9.9"})
    assert r.status_code == 429
    clear_limiters()


def test_client_ip_only_trusts_the_right_side(monkeypatch):
    from starlette.requests import Request

    from app.deps import client_ip

    def req(headers, peer="172.16.0.5"):
        scope = {"type": "http", "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
                 "client": (peer, 1234)}
        return Request(scope)

    settings = get_settings()
    monkeypatch.setattr(settings, "client_ip_headers", [])
    monkeypatch.setattr(settings, "trusted_proxy_hops", 0)
    assert client_ip(req({"X-Forwarded-For": "1.2.3.4"})) == "172.16.0.5"
    monkeypatch.setattr(settings, "trusted_proxy_hops", 1)
    assert client_ip(req({"X-Forwarded-For": "6.6.6.6, 203.0.113.7"})) == "203.0.113.7"
    assert client_ip(req({"X-Forwarded-For": "junk"})) == "172.16.0.5"
    monkeypatch.setattr(settings, "client_ip_headers", ["true-client-ip"])
    assert client_ip(req({"True-Client-IP": "198.51.100.2", "X-Forwarded-For": "6.6.6.6"})) == "198.51.100.2"


def test_security_headers_and_body_limit(client):
    r = client.get("/")
    assert r.headers["strict-transport-security"].startswith("max-age=")
    assert r.headers["cross-origin-opener-policy"] == "same-origin"
    assert "geolocation=(self)" in r.headers["permissions-policy"]
    r = client.post("/api/sync", content=b"{}", headers={"Content-Length": str(50 * 1024 * 1024),
                                                          "Content-Type": "application/json"})
    assert r.status_code == 413


def test_health_checks_database(client):
    body = client.get("/api/health").json()
    assert body["ok"] is True and body["db"] is True


def test_missing_columns_are_added(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path}/old.db")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE tasks (id VARCHAR(64) PRIMARY KEY, user_id VARCHAR(36), title VARCHAR(300))"))
    added = add_missing_columns(engine)
    cols = {c["name"] for c in inspect(engine).get_columns("tasks")}
    assert "done_at" in cols and "deleted" in cols and "tasks.done_at" in added
    assert add_missing_columns(engine) == []  # second run changes nothing
    assert Base.metadata.tables["tasks"] is not None


# ---------------------------------------------------------------- password reset


def test_password_reset_through_telegram(client, user, fake_tg):
    clear_limiters()
    link_telegram(user, 880000 + int(time.time()) % 1000)
    r = client.post("/api/auth/reset/request", json={"email": user["email"]})
    assert r.status_code == 200 and r.json() == {"ok": True}
    code = re.search(r"\b(\d{6})\b", fake_tg.messages()[-1]["text"]).group(1)

    wrong = "000000" if code != "000000" else "111111"
    r = client.post("/api/auth/reset/confirm", json={"email": user["email"], "code": wrong, "password": "brandnew1"})
    assert r.status_code == 400 and r.json()["error"] == "bad_code"

    r = client.post("/api/auth/reset/confirm", json={"email": user["email"], "code": code, "password": "brandnew1"})
    assert r.status_code == 200
    assert client.get("/api/auth/me", headers=user["h"]).status_code == 401  # old sessions are gone
    assert client.post("/api/auth/login", json={"email": user["email"], "password": "brandnew1"}).status_code == 200
    # a used code cannot be used again
    r = client.post("/api/auth/reset/confirm", json={"email": user["email"], "code": code, "password": "another1"})
    assert r.status_code == 400
    clear_limiters()


def test_reset_answer_does_not_reveal_accounts(client, user, fake_tg):
    clear_limiters()
    before = len(fake_tg.messages())
    a = client.post("/api/auth/reset/request", json={"email": "nobody-here@example.com"})
    b = client.post("/api/auth/reset/request", json={"email": user["email"]})  # exists, no Telegram linked
    assert a.status_code == b.status_code == 200 and a.json() == b.json()
    assert len(fake_tg.messages()) == before
    clear_limiters()


def test_reset_code_locks_after_five_wrong_guesses(client, user, fake_tg):
    clear_limiters()
    link_telegram(user, 881000 + int(time.time()) % 1000)
    client.post("/api/auth/reset/request", json={"email": user["email"]})
    code = re.search(r"\b(\d{6})\b", fake_tg.messages()[-1]["text"]).group(1)
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(5):
        client.post("/api/auth/reset/confirm", json={"email": user["email"], "code": wrong, "password": "brandnew1"})
    r = client.post("/api/auth/reset/confirm", json={"email": user["email"], "code": code, "password": "brandnew1"})
    assert r.status_code == 400
    clear_limiters()


# ---------------------------------------------------------------- pictures


def test_image_upload_checks_content_and_owner(client, user):
    image_id, r = upload_image(client, user, "avatar")
    assert r.status_code == 200
    got = client.get(f"/api/images/{image_id}", headers=user["h"])
    assert got.status_code == 200 and got.headers["content-type"] == "image/png" and got.content == png()

    # an HTML/SVG file renamed to .png is refused
    _, r = upload_image(client, user, data=b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>")
    assert r.status_code == 415
    _, r = upload_image(client, user, kind="script")
    assert r.status_code == 422

    # someone else cannot read, overwrite or delete it
    other = client.post("/api/auth/register", json={"name": "B", "email": f"b-{uuid.uuid4().hex[:8]}@example.com",
                                                    "password": "secret123"}).json()
    oh = {"Authorization": f"Bearer {other['token']}"}
    assert client.get(f"/api/images/{image_id}", headers=oh).status_code == 404
    assert client.delete(f"/api/images/{image_id}", headers=oh).status_code == 404
    _, r = upload_image(client, {"h": oh}, image_id=image_id)
    assert r.status_code == 403

    # retrying the same upload is fine
    _, r = upload_image(client, user, "avatar", image_id=image_id)
    assert r.status_code == 200
    assert client.delete(f"/api/images/{image_id}", headers=user["h"]).json()["ok"] is True


def test_image_size_limit(client, user):
    big = png() + b"\x00" * (get_settings().max_image_kb * 1024)
    _, r = upload_image(client, user, data=big)
    assert r.status_code == 413


def test_profile_picture_background_and_city(client, user):
    a1, _ = upload_image(client, user, "avatar")
    r = client.patch("/api/auth/me", json={"avatar_id": a1}, headers=user["h"])
    assert r.status_code == 200 and r.json()["avatar_id"] == a1
    # cannot point at a picture that is not yours
    assert client.patch("/api/auth/me", json={"avatar_id": "nope-123"}, headers=user["h"]).status_code == 422
    # replacing the avatar deletes the old picture
    a2, _ = upload_image(client, user, "avatar")
    client.patch("/api/auth/me", json={"avatar_id": a2}, headers=user["h"])
    assert client.get(f"/api/images/{a1}", headers=user["h"]).status_code == 404

    bg, _ = upload_image(client, user, "background")
    r = client.patch("/api/auth/me", json={"background": f"img:{bg}"}, headers=user["h"])
    assert r.json()["background"] == f"img:{bg}"
    r = client.patch("/api/auth/me", json={"background": "g:sunset"}, headers=user["h"])
    assert r.json()["background"] == "g:sunset"
    assert client.get(f"/api/images/{bg}", headers=user["h"]).status_code == 404
    assert client.patch("/api/auth/me", json={"background": "url(javascript:x)"}, headers=user["h"]).status_code == 422

    r = client.patch("/api/auth/me", json={"city": "Samarqand", "lat": 39.6542, "lon": 66.9597}, headers=user["h"])
    assert r.json()["city"] == "Samarqand" and r.json()["lat"] == 39.6542
    assert client.patch("/api/auth/me", json={"lat": 100, "lon": 1}, headers=user["h"]).status_code == 422


def test_book_cover_is_removed_with_the_book(client, user):
    cover, _ = upload_image(client, user, "cover")
    book_id = str(uuid.uuid4())
    sync(client, user, [change("books", {"title": "Alkimyogar", "cover_id": cover}, rid=book_id)])
    sync(client, user, [change("books", {}, rid=book_id, deleted=True)])
    with session_scope() as db:
        assert db.get(Image, cover) is None


# ---------------------------------------------------------------- weather


def test_weather_and_city_search(client, user, monkeypatch):
    calls = []

    def fake_get(url, params):
        calls.append(url)
        if "geocoding" in url:
            return {"results": [{"name": "Toshkent", "admin1": "Toshkent", "country": "Oʻzbekiston",
                                 "latitude": 41.26465, "longitude": 69.21627}]}
        return {"current": {"temperature_2m": 12.4, "apparent_temperature": 10.1, "weather_code": 2, "is_day": 1,
                            "wind_speed_10m": 9.0, "relative_humidity_2m": 40, "time": "2026-11-20T12:00"},
                "daily": {"temperature_2m_max": [15.0], "temperature_2m_min": [4.0],
                          "sunrise": ["2026-11-20T07:21"], "sunset": ["2026-11-20T17:02"]}}

    monkeypatch.setattr(weather, "_get", fake_get)
    weather._cache.clear()
    r = client.get("/api/weather?lat=41.31&lon=69.28", headers=user["h"])
    assert r.status_code == 200
    body = r.json()
    assert body["temp"] == 12.4 and body["max"] == 15.0 and body["sunset"] == "17:02"
    client.get("/api/weather?lat=41.3111&lon=69.2799", headers=user["h"])  # same ~1 km cell: cached
    assert len(calls) == 1
    r = client.get("/api/geo?q=Tosh&lang=uz", headers=user["h"])
    assert r.json()["results"][0]["lat"] == 41.2647
    assert client.get("/api/weather?lat=41&lon=69").status_code == 401
    assert client.get("/api/weather?lat=500&lon=69", headers=user["h"]).status_code == 422


def test_weather_failure_is_reported(client, user, monkeypatch):
    def boom(url, params):
        raise weather.WeatherError("down")

    monkeypatch.setattr(weather, "_get", boom)
    weather._cache.clear()
    r = client.get("/api/weather?lat=40.1&lon=65.3", headers=user["h"])
    assert r.status_code == 502 and r.json()["error"] == "weather_unavailable"


# ---------------------------------------------------------------- plans, challenges, done dates


def test_plans_challenges_and_done_dates(client, user):
    plan = change("plans", {"title": "Kitob o'qish", "date": "2026-11-20", "time": "21:00", "done": True,
                            "done_at": "2026-11-20"})
    challenge = change("challenges", {"title": "Har kuni yugurish", "icon": "🏃", "days": 30,
                                      "start_date": "2026-11-01",
                                      "checkins": ["2026-11-03", "2026-11-01", "2026-11-01", "bad"]})
    task = change("tasks", {"title": "Referat", "done": True, "done_at": "2026-11-20"})
    book = change("books", {"title": "Sariq devni minib", "finished_at": "2026-11-19"})
    res = sync(client, user, [plan, challenge, task, book])
    assert set(res["accepted"]) == {plan["id"], challenge["id"], task["id"], book["id"]}
    # a fresh device receives everything, with check-ins cleaned up
    pulled = {c["id"]: c for c in sync(client, user)["changes"]}
    assert pulled[challenge["id"]]["data"]["checkins"] == ["2026-11-01", "2026-11-03"]
    assert pulled[plan["id"]]["data"]["done_at"] == "2026-11-20"
    assert pulled[task["id"]]["data"]["done_at"] == "2026-11-20"
    assert pulled[book["id"]]["data"]["finished_at"] == "2026-11-19"

    bad = sync(client, user, [change("challenges", {"title": "X", "days": 0, "start_date": "2026-11-01"}),
                              change("plans", {"title": "Y", "date": "2026-13-40"})])
    assert len(bad["rejected"]) == 2


def test_digest_lists_todays_plans(client, user, fake_tg):
    link_telegram(user, 882000 + int(time.time()) % 1000)
    sync(client, user, [change("plans", {"title": "Ingliz tili 30 daqiqa", "date": "2026-11-27", "time": "19:00"})])
    with session_scope() as db:
        run_reminders(db, now_utc=datetime(2026, 11, 27, 2, 40, tzinfo=timezone.utc))
    assert "Ingliz tili 30 daqiqa" in fake_tg.messages()[-1]["text"]


# ---------------------------------------------------------------- Russian


def test_russian_everywhere(client, fake_tg):
    clear_limiters()
    security.register_limiter._hits.clear()
    email = f"ru-{uuid.uuid4().hex[:8]}@example.com"
    r = client.post("/api/auth/register", json={"name": "Иван", "email": email, "password": "secret123", "lang": "ru"})
    assert r.status_code == 200 and r.json()["user"]["lang"] == "ru"
    h = {"Authorization": f"Bearer {r.json()['token']}"}
    csv_text = client.get("/api/export/transactions.csv?lang=ru", headers=h).content.decode("utf-8-sig")
    assert csv_text.startswith("Дата,Тип,Категория")
    assert client.patch("/api/auth/me", json={"lang": "ru"}, headers=h).json()["lang"] == "ru"
    assert client.patch("/api/auth/me", json={"lang": "de"}, headers=h).status_code == 422

    user = {"h": h, "user": r.json()["user"]}
    link_telegram(user, 883000 + int(time.time()) % 1000)
    sync(client, user, [change("plans", {"title": "Спортзал", "date": "2026-11-27"})])
    with session_scope() as db:
        run_reminders(db, now_utc=datetime(2026, 11, 27, 2, 40, tzinfo=timezone.utc))
    text_ru = fake_tg.messages()[-1]["text"]
    assert "Доброе утро" in text_ru and "27 ноября" in text_ru and "Спортзал" in text_ru
