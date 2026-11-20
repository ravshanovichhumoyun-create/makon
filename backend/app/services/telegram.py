"""Telegram bot: quick expense entry, /today, /month, /undo, linking to an app account."""
import logging
import secrets
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import httpx
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import Category, Course, Plan, Task, TimetableItem, Transaction, User, now_ms
from . import texts
from .defaults import FALLBACK_KEY, category_id, category_label, stable_id
from .parser import parse
from .sync import create_record, soft_delete

log = logging.getLogger("makon.telegram")

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    from backports.zoneinfo import ZoneInfo  # type: ignore


def user_zone(user: User):
    try:
        return ZoneInfo(user.tz or "Asia/Tashkent")
    except Exception:
        return ZoneInfo("Asia/Tashkent")


def user_now(user: User, now_utc: Optional[datetime] = None) -> datetime:
    now_utc = now_utc or datetime.now(timezone.utc)
    return now_utc.astimezone(user_zone(user))


class TelegramAPI:
    def __init__(self, token: str) -> None:
        self.token = token
        self.base = f"https://api.telegram.org/bot{token}"
        self._username: Optional[str] = None
        self._checked_at = 0

    def call(self, method: str, payload: Optional[Dict[str, Any]] = None, timeout: float = 15) -> Dict[str, Any]:
        if not self.token:
            return {}
        try:
            r = httpx.post(f"{self.base}/{method}", json=payload or {}, timeout=timeout)
            data = r.json()
        except (httpx.HTTPError, ValueError) as exc:
            log.warning("telegram %s failed: %s", method, exc)
            return {}
        if not data.get("ok"):
            log.warning("telegram %s error: %s", method, data.get("description"))
        return data

    def send(self, chat_id: int, text: str, reply_markup: Optional[Dict] = None) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"chat_id": chat_id, "text": text[:4000], "disable_web_page_preview": True}
        if reply_markup:
            payload["reply_markup"] = reply_markup
        return self.call("sendMessage", payload)

    def username(self) -> Optional[str]:
        # failed lookups are retried at most once a minute so /api/config never stalls
        if self._username is None and self.token and now_ms() - self._checked_at > 60_000:
            self._checked_at = now_ms()
            res = self.call("getMe", timeout=5)
            if res.get("ok"):
                self._username = res["result"].get("username")
        return self._username


_api: Optional[TelegramAPI] = None


def get_api() -> TelegramAPI:
    global _api
    if _api is None:
        _api = TelegramAPI(get_settings().telegram_token)
    return _api


def reset_api() -> None:
    global _api
    _api = None


def setup_bot(api: TelegramAPI) -> None:
    """Register webhook (webhook mode) and the command menu. Safe to call repeatedly."""
    settings = get_settings()
    if settings.telegram_mode == "webhook":
        api.call("setWebhook", {
            "url": f"{settings.public_url}/api/telegram/webhook",
            "secret_token": settings.telegram_webhook_secret,
            "allowed_updates": ["message", "callback_query"],
        })
    for lang, cmds in texts.COMMANDS.items():
        payload: Dict[str, Any] = {"commands": [{"command": c, "description": d} for c, d in cmds]}
        if lang != "uz":
            payload["language_code"] = lang
        api.call("setMyCommands", payload)
    api.username()


# ---------------------------------------------------------------- summaries


def _course_names(db: Session, user_id: str) -> Dict[str, str]:
    rows = db.execute(select(Course.id, Course.name).where(Course.user_id == user_id, Course.deleted.is_(False)))
    return {r[0]: r[1] for r in rows}


def today_text(db: Session, user: User, now_local: datetime, morning: bool = False) -> Optional[str]:
    lang = user.lang
    today = now_local.date().isoformat()
    items = list(db.scalars(
        select(TimetableItem)
        .where(TimetableItem.user_id == user.id, TimetableItem.deleted.is_(False),
               TimetableItem.weekday == now_local.isoweekday())
        .order_by(TimetableItem.start)
    ))
    due = list(db.scalars(
        select(Task).where(Task.user_id == user.id, Task.deleted.is_(False), Task.done.is_(False),
                           Task.due_date == today)
        .order_by(Task.due_time)
    ))
    overdue = db.scalar(
        select(func.count()).select_from(Task).where(
            Task.user_id == user.id, Task.deleted.is_(False), Task.done.is_(False), Task.due_date < today)
    ) or 0
    plans = list(db.scalars(
        select(Plan).where(Plan.user_id == user.id, Plan.deleted.is_(False), Plan.done.is_(False), Plan.date == today)
        .order_by(Plan.time)
    ))
    if morning and not items and not due and not overdue and not plans:
        return None

    courses = _course_names(db, user.id)
    lines: List[str] = []
    if morning:
        lines.append(texts.t(lang, "good_morning"))
    lines.append(f"📅 {texts.long_date(now_local.date(), lang)}")
    lines.append("")
    if items:
        lines.append(texts.t(lang, "classes"))
        for it in items:
            extra = f" · {it.location}" if it.location else ""
            lines.append(f"• {it.start}–{it.end}  {it.title}{extra}")
    else:
        lines.append(texts.t(lang, "no_classes"))
    if due:
        lines.append("")
        lines.append(texts.t(lang, "deadlines"))
        for task in due:
            when = f"{task.due_time} " if task.due_time else ""
            course = f" · {courses[task.course_id]}" if task.course_id in courses else ""
            lines.append(f"• {when}{task.title}{course}")
    if plans:
        lines.append("")
        lines.append(texts.t(lang, "plans"))
        for plan in plans:
            when = f"{plan.time} " if plan.time else ""
            lines.append(f"• {when}{plan.title}")
    if overdue:
        lines.append("")
        lines.append(texts.t(lang, "overdue", n=overdue))
    if not morning:
        spent = db.scalar(
            select(func.coalesce(func.sum(Transaction.amount), 0)).where(
                Transaction.user_id == user.id, Transaction.deleted.is_(False), Transaction.type == "expense",
                Transaction.date == today)
        ) or 0
        lines.append("")
        lines.append(texts.t(lang, "spent_today", amount=texts.money(spent, lang)))
    return "\n".join(lines)


def month_text(db: Session, user: User, now_local: datetime) -> str:
    lang = user.lang
    d = now_local.date()
    start = d.replace(day=1).isoformat()
    end = d.isoformat()[:7] + "-31"
    rows = db.execute(
        select(Transaction.type, Transaction.category_id, func.sum(Transaction.amount))
        .where(Transaction.user_id == user.id, Transaction.deleted.is_(False),
               Transaction.date >= start, Transaction.date <= end)
        .group_by(Transaction.type, Transaction.category_id)
    ).all()
    income = sum(int(r[2]) for r in rows if r[0] == "income")
    expense = sum(int(r[2]) for r in rows if r[0] == "expense")
    lines = [
        f"📊 {texts.month_title(d, lang)}",
        "",
        f"⬆️ {texts.t(lang, 'income')}: {texts.money(income, lang)}",
        f"⬇️ {texts.t(lang, 'expense')}: {texts.money(expense, lang)}",
        f"💰 {texts.t(lang, 'balance')}: {texts.money(income - expense, lang)}",
    ]
    if user.monthly_budget:
        left = user.monthly_budget - expense
        key = "budget_left" if left >= 0 else "budget_over"
        lines.append(f"🎯 {texts.t(lang, key, amount=texts.money(abs(left), lang))}")
    top = sorted((r for r in rows if r[0] == "expense"), key=lambda r: -int(r[2]))[:3]
    if top:
        cats = {c.id: c for c in db.scalars(select(Category).where(Category.user_id == user.id))}
        lines.append("")
        lines.append(texts.t(lang, "top"))
        for r in top:
            cat = cats.get(r[1])
            icon = cat.icon if cat else "📦"
            lines.append(f"{icon} {category_label(cat, lang)} — {texts.money(int(r[2]), lang)}")
    return "\n".join(lines)


# ---------------------------------------------------------------- update handling

_recent_updates: List[int] = []


def _seen(update_id: Optional[int]) -> bool:
    if update_id is None:
        return False
    if update_id in _recent_updates:
        return True
    _recent_updates.append(update_id)
    if len(_recent_updates) > 500:
        del _recent_updates[:250]
    return False


def _resolve_category(db: Session, user: User, parsed: Dict[str, Any]) -> Category:
    if parsed.get("category_id"):
        cat = db.get(Category, parsed["category_id"])
        if cat is not None and cat.user_id == user.id and not cat.deleted:
            return cat
    for key in (parsed["category_key"], FALLBACK_KEY[parsed["type"]]):
        cat = db.get(Category, category_id(user.id, key))
        if cat is not None and not cat.deleted:
            return cat
    return db.get(Category, category_id(user.id, FALLBACK_KEY[parsed["type"]]))


def _link_account(db: Session, api: TelegramAPI, chat: Dict, code: str) -> None:
    chat_id = chat["id"]
    user = db.scalar(select(User).where(User.telegram_link_code == code))
    if user is None or (user.telegram_link_expires or 0) < now_ms():
        api.send(chat_id, texts.all_langs("link_invalid"))
        return
    previous = db.scalar(select(User).where(User.telegram_chat_id == chat_id, User.id != user.id))
    if previous is not None:
        previous.telegram_chat_id = None
        previous.telegram_username = None
        db.flush()
    user.telegram_chat_id = chat_id
    user.telegram_username = (chat.get("username") or "")[:64] or None
    user.telegram_link_code = None
    user.telegram_link_expires = None
    db.commit()
    api.send(chat_id, f"{texts.t(user.lang, 'welcome', name=user.name)}\n\n{texts.t(user.lang, 'help')}")


def _add_transaction(db: Session, api: TelegramAPI, user: User, msg: Dict, text: str) -> None:
    chat_id = msg["chat"]["id"]
    lang = user.lang
    custom = [
        {"id": c.id, "type": c.type, "name": c.name}
        for c in db.scalars(select(Category).where(Category.user_id == user.id, Category.deleted.is_(False),
                                                   Category.name != ""))
    ]
    parsed = parse(text, custom)
    if not parsed:
        api.send(chat_id, texts.t(lang, "no_amount"))
        return
    tx_id = stable_id("tg", chat_id, msg.get("message_id"))
    if db.get(Transaction, tx_id) is not None:  # Telegram re-delivered the same message
        return
    cat = _resolve_category(db, user, parsed)
    local_date = user_now(user).date().isoformat()
    create_record(db, user, "transactions", tx_id, {
        "type": parsed["type"], "amount": parsed["amount"], "category_id": cat.id if cat else
        category_id(user.id, FALLBACK_KEY[parsed["type"]]), "date": local_date, "note": parsed["note"],
        "source": "telegram",
    })
    sign = "−" if parsed["type"] == "expense" else "+"
    label = category_label(cat, lang)
    icon = cat.icon if cat else "📦"
    note = f"\n{parsed['note']}" if parsed["note"] else ""
    api.send(
        chat_id,
        f"✅ {sign}{texts.money(parsed['amount'], lang)}\n{icon} {label}{note}",
        {"inline_keyboard": [[{"text": texts.t(lang, "undo_btn"), "callback_data": f"undo:{tx_id}"}]]},
    )


def _undo_last(db: Session, api: TelegramAPI, user: User, chat_id: int) -> None:
    since = now_ms() - 24 * 3600 * 1000
    tx = db.scalar(
        select(Transaction)
        .where(Transaction.user_id == user.id, Transaction.source == "telegram", Transaction.deleted.is_(False),
               Transaction.created_at >= since)
        .order_by(Transaction.created_at.desc())
    )
    if tx is None:
        api.send(chat_id, texts.t(user.lang, "nothing_to_undo"))
        return
    soft_delete(db, user, "transactions", tx)
    sign = "−" if tx.type == "expense" else "+"
    api.send(chat_id, f"{texts.t(user.lang, 'undone')}: {sign}{texts.money(tx.amount, user.lang)}")


def _handle_callback(db: Session, api: TelegramAPI, cq: Dict) -> None:
    data = cq.get("data") or ""
    chat_id = (cq.get("message") or {}).get("chat", {}).get("id")
    user = db.scalar(select(User).where(User.telegram_chat_id == chat_id)) if chat_id else None
    answer = ""
    if user is not None and data.startswith("undo:"):
        tx = db.get(Transaction, data[5:])
        if tx is not None and tx.user_id == user.id and not tx.deleted:
            soft_delete(db, user, "transactions", tx)
        answer = texts.t(user.lang, "undone")
        message = cq.get("message") or {}
        api.call("editMessageText", {
            "chat_id": chat_id, "message_id": message.get("message_id"),
            "text": f"{message.get('text', '')}\n\n{answer}",
        })
    api.call("answerCallbackQuery", {"callback_query_id": cq.get("id"), "text": answer})


def handle_update(db: Session, update: Dict[str, Any], api: Optional[TelegramAPI] = None) -> None:
    api = api or get_api()
    if _seen(update.get("update_id")):
        return
    if update.get("callback_query"):
        _handle_callback(db, api, update["callback_query"])
        return
    msg = update.get("message")
    if not msg:
        return
    chat = msg.get("chat") or {}
    chat_id = chat.get("id")
    text = (msg.get("text") or msg.get("caption") or "").strip()
    if not chat_id or not text:
        return
    if chat.get("type") != "private":
        api.send(chat_id, texts.all_langs("group_only_private"))
        return

    if text.startswith("/start"):
        parts = text.split(maxsplit=1)
        if len(parts) == 2:
            _link_account(db, api, chat, parts[1].strip())
            return

    user = db.scalar(select(User).where(User.telegram_chat_id == chat_id))
    if user is None:
        api.send(chat_id, texts.NOT_LINKED)
        return

    command = text.split()[0].split("@")[0].lower() if text.startswith("/") else ""
    if command in ("/start", "/help"):
        api.send(chat_id, texts.t(user.lang, "help"))
    elif command == "/today":
        api.send(chat_id, today_text(db, user, user_now(user)) or "")
    elif command == "/month":
        api.send(chat_id, month_text(db, user, user_now(user)))
    elif command in ("/undo", "/ochir"):
        _undo_last(db, api, user, chat_id)
    elif command:
        api.send(chat_id, texts.t(user.lang, "help"))
    else:
        _add_transaction(db, api, user, msg, text)


# ---------------------------------------------------------------- reminders


def _minutes(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def run_reminders(db: Session, api: Optional[TelegramAPI] = None, now_utc: Optional[datetime] = None) -> Dict[str, int]:
    """Morning digest + deadline reminders. Idempotent: every send is claimed in the DB first."""
    settings = get_settings()
    if settings.telegram_mode == "off":
        return {"digests": 0, "reminders": 0}
    api = api or get_api()
    now_utc = now_utc or datetime.now(timezone.utc)
    sent = {"digests": 0, "reminders": 0}
    users = list(db.scalars(select(User).where(User.telegram_chat_id.isnot(None))))
    for user in users:
        local = user_now(user, now_utc)
        today = local.date().isoformat()
        now_min = local.hour * 60 + local.minute

        if user.digest_enabled and user.last_digest_date != today:
            try:
                start = _minutes(user.digest_time or "07:30")
            except ValueError:
                start = 450
            if start <= now_min < start + 180:
                claimed = db.execute(
                    User.__table__.update()
                    .where(User.id == user.id)
                    .where((User.last_digest_date.is_(None)) | (User.last_digest_date != today))
                    .values(last_digest_date=today)
                ).rowcount
                db.commit()
                if claimed:
                    text = today_text(db, user, local, morning=True)
                    if text:
                        api.send(user.telegram_chat_id, text)
                        sent["digests"] += 1

        if user.remind_minutes:
            tomorrow = (local.date() + timedelta(days=1)).isoformat()
            tasks = list(db.scalars(
                select(Task).where(Task.user_id == user.id, Task.deleted.is_(False), Task.done.is_(False),
                                   Task.reminded_at.is_(None), Task.due_time.isnot(None),
                                   Task.due_date.in_([today, tomorrow]))
            ))
            if tasks:
                courses = _course_names(db, user.id)
            for task in tasks:
                try:
                    due_local = datetime.combine(date.fromisoformat(task.due_date), datetime.min.time()).replace(
                        hour=int(task.due_time[:2]), minute=int(task.due_time[3:5]), tzinfo=local.tzinfo)
                except (ValueError, TypeError):
                    continue
                left = (due_local - local).total_seconds() / 60
                if not (0 < left <= user.remind_minutes):
                    continue
                claimed = db.execute(
                    Task.__table__.update().where(Task.id == task.id, Task.reminded_at.is_(None))
                    .values(reminded_at=now_ms())
                ).rowcount
                db.commit()
                if not claimed:
                    continue
                mins = int(round(left))
                when = (texts.t(user.lang, "in_hours", n=round(mins / 60)) if mins >= 90
                        else texts.t(user.lang, "in_minutes", n=max(1, mins)))
                title = task.title + (f" · {courses[task.course_id]}" if task.course_id in courses else "")
                api.send(user.telegram_chat_id, texts.t(user.lang, "reminder", when=when, title=title))
                sent["reminders"] += 1
    return sent


def make_link_code() -> str:
    return secrets.token_urlsafe(9)


def link_expiry() -> int:
    return now_ms() + 15 * 60 * 1000
