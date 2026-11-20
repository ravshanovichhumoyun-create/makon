import io
import time
import uuid
import zipfile
from datetime import datetime, timezone

from app.db import session_scope
from app.models import Task, User
from app.services.defaults import category_id
from app.services.telegram import run_reminders


def now():
    return int(time.time() * 1000)


def change(kind, data, rid=None, ts=None, deleted=False):
    return {"kind": kind, "id": rid or str(uuid.uuid4()), "updated_at": ts or now(), "deleted": deleted, "data": data}


def sync(client, user, changes=(), cursor=0):
    r = client.post("/api/sync", json={"cursor": cursor, "changes": list(changes)}, headers=user["h"])
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------- auth


def test_health_and_config(client):
    assert client.get("/api/health").json()["ok"] is True
    cfg = client.get("/api/config").json()
    assert cfg["files"]["enabled"] is True
    assert cfg["telegram"]["bot"] == "makon_test_bot"


def test_register_login_me(client, user):
    assert user["user"]["name"] == "Ali"
    r = client.post("/api/auth/login", json={"email": user["email"].upper(), "password": "secret123"})
    assert r.status_code == 200
    assert client.get("/api/auth/me", headers={"Authorization": "Bearer " + r.json()["token"]}).status_code == 200
    assert client.post("/api/auth/login", json={"email": user["email"], "password": "wrong"}).status_code == 401
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/auth/me", headers={"Authorization": "Bearer junk"}).status_code == 401


def test_register_validation(client, user):
    r = client.post("/api/auth/register", json={"name": "X", "email": user["email"], "password": "secret123"})
    assert r.status_code == 409 and r.json()["error"] == "email_taken"
    r = client.post("/api/auth/register", json={"name": "X", "email": "bad", "password": "secret123"})
    assert r.status_code == 422
    r = client.post("/api/auth/register", json={"name": "X", "email": "a@b.co", "password": "short"})
    assert r.status_code == 422


def test_login_rate_limit(client, user):
    for _ in range(10):
        client.post("/api/auth/login", json={"email": user["email"], "password": "nope"})
    r = client.post("/api/auth/login", json={"email": user["email"], "password": "secret123"})
    assert r.status_code == 429


def test_password_change_signs_out_other_devices(client, user):
    old = user["h"]
    r = client.post("/api/auth/password", json={"current": "secret123", "new": "newsecret1"}, headers=old)
    assert r.status_code == 200
    assert client.get("/api/auth/me", headers=old).status_code == 401
    new_h = {"Authorization": "Bearer " + r.json()["token"]}
    assert client.get("/api/auth/me", headers=new_h).status_code == 200


def test_profile_patch(client, user):
    r = client.patch("/api/auth/me", json={"lang": "en", "monthly_budget": 3000000, "digest_time": "08:15"},
                     headers=user["h"])
    body = r.json()
    assert body["lang"] == "en" and body["monthly_budget"] == 3000000 and body["digest_time"] == "08:15"
    r = client.patch("/api/auth/me", json={"monthly_budget": None}, headers=user["h"])
    assert r.json()["monthly_budget"] is None
    assert client.patch("/api/auth/me", json={"digest_time": "25:00"}, headers=user["h"]).status_code == 422


# ---------------------------------------------------------------- sync


def test_initial_sync_has_default_categories(client, user):
    res = sync(client, user)
    cats = [c for c in res["changes"] if c["kind"] == "categories"]
    assert len(cats) == 16
    assert res["cursor"] >= 1


def test_sync_push_pull_and_cursor(client, user):
    first = sync(client, user)
    cat = category_id(user["user"]["id"], "food")
    tx = change("transactions", {"type": "expense", "amount": 85000, "category_id": cat, "date": "2026-11-20",
                                 "note": "Korzinka"})
    res = sync(client, user, [tx], cursor=first["cursor"])
    assert tx["id"] in res["accepted"]
    assert res["changes"] == []  # own change is not echoed
    # another device pulls from the old cursor and gets it
    other = sync(client, user, cursor=first["cursor"])
    assert [c["id"] for c in other["changes"]] == [tx["id"]]
    assert other["changes"][0]["data"]["amount"] == 85000


def test_last_write_wins(client, user):
    base = sync(client, user)["cursor"]
    rid = str(uuid.uuid4())
    t1 = now()
    sync(client, user, [change("notes", {"title": "new", "content": "B"}, rid, ts=t1 + 1000)])
    res = sync(client, user, [change("notes", {"title": "old", "content": "A"}, rid, ts=t1)], cursor=base)
    assert rid not in res["accepted"]
    winner = [c for c in res["changes"] if c["id"] == rid][0]
    assert winner["data"]["title"] == "new"


def test_validation_and_ownership(client, user, fake_tg):
    bad = change("transactions", {"type": "expense", "amount": -5, "category_id": "x", "date": "2026-11-20"})
    res = sync(client, user, [bad, change("unknown", {})])
    errors = {r["error"] for r in res["rejected"]}
    assert errors == {"invalid", "unknown_kind"}
    # timetable end must be after start
    res = sync(client, user, [change("timetable", {"title": "A", "weekday": 1, "start": "10:00", "end": "09:00"})])
    assert res["rejected"][0]["error"] == "invalid"
    # project links must be http(s) — blocks javascript: URLs
    res = sync(client, user, [change("projects", {"title": "P", "link": "javascript:alert(1)"})])
    assert res["rejected"][0]["error"] == "invalid"

    rid = str(uuid.uuid4())
    sync(client, user, [change("notes", {"title": "mine"}, rid)])
    r = client.post("/api/auth/register", json={"name": "Eve", "email": f"eve{rid[:6]}@x.com", "password": "secret123"})
    eve = {"h": {"Authorization": "Bearer " + r.json()["token"]}}
    res = sync(client, eve, [change("notes", {"title": "hacked"}, rid, ts=now() + 10)])
    assert res["rejected"][0]["error"] == "forbidden"
    assert client.get(f"/api/data/notes/{rid}", headers=eve["h"]).status_code == 404


def test_delete_course_cascades_tasks(client, user):
    course = change("courses", {"name": "AI"})
    task = change("tasks", {"title": "HW", "course_id": course["id"], "due_date": "2026-11-21"})
    base = sync(client, user, [course, task])["cursor"]
    sync(client, user, [change("courses", {}, course["id"], ts=now() + 5, deleted=True)])
    res = sync(client, user, cursor=base)
    by_id = {c["id"]: c for c in res["changes"]}
    assert by_id[course["id"]]["deleted"] and by_id[task["id"]]["deleted"]
    # a fresh device does not receive tombstones
    fresh = sync(client, user)
    assert course["id"] not in {c["id"] for c in fresh["changes"]}


def test_fallback_category_cannot_be_deleted(client, user):
    other = category_id(user["user"]["id"], "other_expense")
    res = sync(client, user, [change("categories", {}, other, ts=now() + 5, deleted=True)])
    assert other not in res["accepted"]
    assert any(c["id"] == other and not c["deleted"] for c in res["changes"])


def test_rest_crud(client, user):
    r = client.post("/api/data/notes", json={"title": "REST", "content": "x"}, headers=user["h"])
    assert r.status_code == 201
    rid = r.json()["id"]
    r = client.put(f"/api/data/notes/{rid}", json={"title": "REST2"}, headers=user["h"])
    assert r.json()["data"]["title"] == "REST2"
    assert client.delete(f"/api/data/notes/{rid}", headers=user["h"]).json()["ok"]
    assert client.get(f"/api/data/notes/{rid}", headers=user["h"]).status_code == 404
    assert client.get("/api/data/nope", headers=user["h"]).status_code == 404


# ---------------------------------------------------------------- exports


def _seed_finance(client, user):
    uid = user["user"]["id"]
    sync(client, user, [
        change("transactions", {"type": "income", "amount": 2000000, "category_id": category_id(uid, "salary"),
                                "date": "2026-11-01", "note": "Oylik"}),
        change("transactions", {"type": "expense", "amount": 85000, "category_id": category_id(uid, "food"),
                                "date": "2026-11-02", "note": "=HYPERLINK(\"x\")"}),
    ])


def test_export_csv_and_xlsx(client, user):
    _seed_finance(client, user)
    r = client.get("/api/export/transactions.csv?from=2026-11-01&to=2026-11-30&lang=uz", headers=user["h"])
    assert r.status_code == 200
    text = r.content.decode("utf-8-sig")
    assert "Sana,Turi,Kategoriya" in text and "Oziq-ovqat" in text and "-85000" in text
    assert "'=HYPERLINK" in text  # formula injection neutralised
    assert "Qoldiq,,,,1915000" in text
    r = client.get("/api/export/transactions.xlsx?lang=en", headers=user["h"])
    assert r.status_code == 200
    zf = zipfile.ZipFile(io.BytesIO(r.content))
    sheet = zf.read("xl/worksheets/sheet1.xml").decode()
    assert "Groceries" in sheet and "<v>-85000</v>" in sheet
    assert client.get("/api/export/transactions.pdf", headers=user["h"]).status_code == 404


def test_calendar_feed(client, user):
    sync(client, user, [
        change("timetable", {"title": "Algoritmlar, ma'ruza", "weekday": 1, "start": "09:00", "end": "10:30",
                             "location": "302"}),
        change("tasks", {"title": "Kurs ishi", "due_date": "2026-11-25", "due_time": "18:00"}),
    ])
    path = client.get("/api/auth/me", headers=user["h"]).json()["calendar_path"]
    r = client.get(path)
    assert r.status_code == 200
    body = r.text
    assert "BEGIN:VCALENDAR" in body and "RRULE:FREQ=WEEKLY;BYDAY=MO" in body
    assert "SUMMARY:Algoritmlar\\, ma'ruza" in body
    assert "DTSTART;TZID=Asia/Tashkent:20261125T180000" in body
    assert "TZOFFSETTO:+0500" in body
    assert all(len(line.encode()) <= 75 for line in body.split("\r\n"))
    assert client.get("/api/calendar/wrong-token-1234567.ics").status_code == 404


# ---------------------------------------------------------------- files


def test_pdf_upload_download_delete(client, user):
    pdf = b"%PDF-1.4\n" + b"x" * 1000
    r = client.post("/api/files", files={"file": ("kitob.pdf", pdf, "application/pdf")}, headers=user["h"])
    assert r.status_code == 200, r.text
    fid = r.json()["id"]
    r = client.get(f"/api/files/{fid}", headers=user["h"])
    assert r.status_code == 200 and r.content == pdf
    r = client.post("/api/files", files={"file": ("x.pdf", b"not a pdf", "application/pdf")}, headers=user["h"])
    assert r.status_code == 415
    # deleting the book deletes the file
    book = change("books", {"title": "Kitob", "file_id": fid, "file_name": "kitob.pdf"})
    sync(client, user, [book])
    sync(client, user, [change("books", {}, book["id"], ts=now() + 5, deleted=True)])
    assert client.get(f"/api/files/{fid}", headers=user["h"]).status_code == 404


# ---------------------------------------------------------------- telegram


def _tg_message(chat_id, text, message_id=1, update_id=None):
    return {"update_id": update_id or int(time.time() * 1000) % 10 ** 9 + message_id,
            "message": {"message_id": message_id, "chat": {"id": chat_id, "type": "private", "username": "ali"},
                        "text": text}}


WEBHOOK = {"X-Telegram-Bot-Api-Secret-Token": None}


def _post_update(client, update):
    from app.config import get_settings

    headers = {"X-Telegram-Bot-Api-Secret-Token": get_settings().telegram_webhook_secret}
    return client.post("/api/telegram/webhook", json=update, headers=headers)


def test_webhook_requires_secret(client):
    r = client.post("/api/telegram/webhook", json={}, headers={"X-Telegram-Bot-Api-Secret-Token": "wrong"})
    assert r.status_code == 403


def test_telegram_link_and_add_expense(client, user, fake_tg):
    chat_id = 555000 + int(time.time()) % 1000
    # unlinked chats cannot add anything
    _post_update(client, _tg_message(chat_id, "Korzinka 85000", 1))
    assert "Sozlamalar" in fake_tg.messages()[-1]["text"]

    link = client.post("/api/telegram/link", headers=user["h"]).json()
    assert link["url"].startswith("https://t.me/makon_test_bot?start=")
    code = link["url"].split("start=")[1]
    _post_update(client, _tg_message(chat_id, f"/start {code}", 2))
    assert client.get("/api/auth/me", headers=user["h"]).json()["telegram"]["linked"] is True

    base = sync(client, user)["cursor"]
    _post_update(client, _tg_message(chat_id, "taksi 25k", 3))
    reply = fake_tg.messages()[-1]
    assert "25 000" in reply["text"] and "Transport" in reply["text"]
    res = sync(client, user, cursor=base)
    txs = [c for c in res["changes"] if c["kind"] == "transactions"]
    assert len(txs) == 1 and txs[0]["data"]["amount"] == 25000 and txs[0]["data"]["source"] == "telegram"

    # the same message delivered twice is stored once
    _post_update(client, _tg_message(chat_id, "taksi 25k", 3, update_id=999999999))
    assert len([c for c in sync(client, user, cursor=base)["changes"] if c["kind"] == "transactions"]) == 1

    # undo button
    callback = reply["reply_markup"]["inline_keyboard"][0][0]["callback_data"]
    _post_update(client, {"update_id": 123456, "callback_query": {
        "id": "cb1", "data": callback, "message": {"message_id": 3, "chat": {"id": chat_id}, "text": reply["text"]}}})
    txs = [c for c in sync(client, user, cursor=base)["changes"] if c["kind"] == "transactions"]
    assert txs[0]["deleted"] is True

    # used link code no longer works
    _post_update(client, _tg_message(chat_id + 1, f"/start {code}", 4))
    assert "eskirgan" in fake_tg.messages()[-1]["text"]


def test_reminders_and_digest(client, user, fake_tg):
    chat_id = 777000 + int(time.time()) % 1000
    with session_scope() as db:
        u = db.get(User, user["user"]["id"])
        u.telegram_chat_id = chat_id
    sync(client, user, [
        change("timetable", {"title": "Fizika", "weekday": 5, "start": "09:00", "end": "10:20"}),
        change("tasks", {"title": "Referat", "due_date": "2026-11-20", "due_time": "12:00"}),
    ])
    # Friday 2026-11-20, 07:40 in Tashkent (02:40 UTC): digest goes out, reminder not yet
    with session_scope() as db:
        res = run_reminders(db, now_utc=datetime(2026, 11, 20, 2, 40, tzinfo=timezone.utc))
    assert res == {"digests": 1, "reminders": 0}
    assert "Fizika" in fake_tg.messages()[-1]["text"]
    # 11:10 local: reminder fires exactly once
    with session_scope() as db:
        res = run_reminders(db, now_utc=datetime(2026, 11, 20, 6, 10, tzinfo=timezone.utc))
        res2 = run_reminders(db, now_utc=datetime(2026, 11, 20, 6, 20, tzinfo=timezone.utc))
    assert res == {"digests": 0, "reminders": 1} and res2 == {"digests": 0, "reminders": 0}
    assert "Referat" in fake_tg.messages()[-1]["text"]
    with session_scope() as db:
        assert db.query(Task).filter(Task.user_id == user["user"]["id"]).first().reminded_at is not None


def test_cron_requires_key(client):
    assert client.get("/api/cron/tick").status_code == 403
    assert client.get("/api/cron/tick?key=cron-secret").json()["ok"] is True


def test_delete_account(client, user):
    r = client.post("/api/auth/delete", json={"password": "wrong"}, headers=user["h"])
    assert r.status_code == 400
    r = client.post("/api/auth/delete", json={"password": "secret123"}, headers=user["h"])
    assert r.json()["ok"]
    assert client.get("/api/auth/me", headers=user["h"]).status_code == 401


def test_frontend_served_with_security_headers(client):
    r = client.get("/")
    assert r.status_code == 200
    assert "script-src 'self'" in r.headers["content-security-policy"]
    sw = client.get("/sw.js")
    assert sw.status_code == 200 and "__BUILD__" not in sw.text
    assert client.get("/api/does-not-exist").status_code == 404


def test_android_assetlinks(client):
    r = client.get("/.well-known/assetlinks.json")
    assert r.status_code == 200
    target = r.json()[0]["target"]
    assert target["package_name"] == "uz.makon.app"
    assert target["sha256_cert_fingerprints"] == ["AA:BB:CC", "DD:EE:FF"]


def test_privacy_page(client):
    r = client.get("/privacy")
    assert r.status_code == 200
    assert "help@example.com" in r.text and "CONTACT_EMAIL" not in r.text
    assert "Hisobni oʻchirish" in r.text and "Delete account" in r.text
