"""CSV / Excel export of transactions and the iCalendar (.ics) feed for timetable and deadlines."""
import csv
import io
import zipfile
from datetime import date, datetime, timedelta, timezone
from typing import Dict, List, Optional, Sequence
from xml.sax.saxutils import escape

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Category, Course, Task, TimetableItem, Transaction, User
from .defaults import TASK_KINDS, TIMETABLE_KINDS, category_label
from .telegram import user_zone

HEADERS = {
    "uz": ["Sana", "Turi", "Kategoriya", "Izoh", "Summa", "Manba"],
    "en": ["Date", "Type", "Category", "Note", "Amount", "Source"],
    "ru": ["Дата", "Тип", "Категория", "Комментарий", "Сумма", "Источник"],
}
TYPE_LABELS = {
    "uz": {"expense": "Chiqim", "income": "Kirim"},
    "en": {"expense": "Expense", "income": "Income"},
    "ru": {"expense": "Расход", "income": "Доход"},
}
SOURCE_LABELS = {
    "uz": {"manual": "Ilova", "telegram": "Telegram", "import": "Import"},
    "en": {"manual": "App", "telegram": "Telegram", "import": "Import"},
    "ru": {"manual": "Приложение", "telegram": "Telegram", "import": "Импорт"},
}
TOTAL_LABELS = {
    "uz": ["Jami kirim", "Jami chiqim", "Qoldiq"],
    "en": ["Total income", "Total expenses", "Balance"],
    "ru": ["Всего доходов", "Всего расходов", "Остаток"],
}
SHEET_NAMES = {"uz": "Moliya", "en": "Finance", "ru": "Финансы"}
CALENDAR_NAMES = {"uz": "Makon — dars jadvali", "en": "Makon — timetable", "ru": "Makon — расписание"}


def transaction_rows(db: Session, user: User, start: Optional[str], end: Optional[str], lang: str) -> List[List]:
    q = select(Transaction).where(Transaction.user_id == user.id, Transaction.deleted.is_(False))
    if start:
        q = q.where(Transaction.date >= start)
    if end:
        q = q.where(Transaction.date <= end)
    q = q.order_by(Transaction.date.desc(), Transaction.created_at.desc())
    cats = {c.id: c for c in db.scalars(select(Category).where(Category.user_id == user.id))}
    rows = []
    for tx in db.scalars(q):
        signed = tx.amount if tx.type == "income" else -tx.amount
        rows.append([
            tx.date, TYPE_LABELS[lang][tx.type], category_label(cats.get(tx.category_id), lang), tx.note, signed,
            SOURCE_LABELS[lang].get(tx.source, tx.source),
        ])
    return rows


def _totals(rows: Sequence[List]) -> List[int]:
    income = sum(r[4] for r in rows if r[4] > 0)
    expense = -sum(r[4] for r in rows if r[4] < 0)
    return [income, expense, income - expense]


def _safe_cell(value):
    """Prevent CSV formula injection when the file is opened in Excel."""
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


def to_csv(rows: List[List], lang: str) -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(HEADERS[lang])
    for row in rows:
        writer.writerow([_safe_cell(v) for v in row])
    writer.writerow([])
    for label, value in zip(TOTAL_LABELS[lang], _totals(rows)):
        writer.writerow([label, "", "", "", value, ""])
    return ("\ufeff" + buf.getvalue()).encode("utf-8")  # BOM so Excel detects UTF-8


def _col(n: int) -> str:
    out = ""
    while n >= 0:
        out = chr(65 + n % 26) + out
        n = n // 26 - 1
    return out


def _cell(ref: str, value, style: int = 0) -> str:
    s = f' s="{style}"' if style else ""
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return f'<c r="{ref}"{s}><v>{value}</v></c>'
    text = escape(str(value or ""))
    return f'<c r="{ref}" t="inlineStr"{s}><is><t xml:space="preserve">{text}</t></is></c>'


def to_xlsx(rows: List[List], lang: str) -> bytes:
    """Minimal but valid .xlsx written with the standard library."""
    sheet_rows = []
    all_rows = [HEADERS[lang]] + rows + [[]] + [
        [label, "", "", "", value, ""] for label, value in zip(TOTAL_LABELS[lang], _totals(rows))
    ]
    for r_idx, row in enumerate(all_rows, start=1):
        cells = []
        for c_idx, value in enumerate(row):
            if value == "" and r_idx != 1:
                continue
            style = 1 if r_idx == 1 or (row and row[0] in TOTAL_LABELS[lang]) else (2 if c_idx == 4 else 0)
            cells.append(_cell(f"{_col(c_idx)}{r_idx}", value, style))
        sheet_rows.append(f'<row r="{r_idx}">{"".join(cells)}</row>')
    widths = [12, 10, 22, 40, 16, 12]
    cols = "".join(f'<col min="{i+1}" max="{i+1}" width="{w}" customWidth="1"/>' for i, w in enumerate(widths))
    sheet = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" state="frozen"/></sheetView></sheetViews>'
        f"<cols>{cols}</cols><sheetData>{''.join(sheet_rows)}</sheetData></worksheet>"
    )
    styles = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>'
        '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
        '<xf numFmtId="3" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/>'
        '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>'
        "</styleSheet>"
    )
    sheet_name = SHEET_NAMES.get(lang, "Finance")
    files = {
        "[Content_Types].xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
            "</Types>"
        ),
        "_rels/.rels": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
            "</Relationships>"
        ),
        "xl/workbook.xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            f'<sheets><sheet name="{sheet_name}" sheetId="1" r:id="rId1"/></sheets></workbook>'
        ),
        "xl/_rels/workbook.xml.rels": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
            "</Relationships>"
        ),
        "xl/worksheets/sheet1.xml": sheet,
        "xl/styles.xml": styles,
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, content in files.items():
            zf.writestr(name, content)
    return buf.getvalue()


# ---------------------------------------------------------------- iCalendar

ICS_DAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]


def _ics_escape(text: str) -> str:
    return (text or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\r", "").replace("\n", "\\n")


def _fold(line: str) -> str:
    """Fold lines longer than 75 octets (RFC 5545)."""
    raw = line.encode("utf-8")
    if len(raw) <= 75:
        return line
    parts, current = [], b""
    for ch in line:
        b = ch.encode("utf-8")
        if len(current) + len(b) > (75 if not parts else 74):
            parts.append(current.decode("utf-8"))
            current = b""
        current += b
    parts.append(current.decode("utf-8"))
    return "\r\n ".join(parts)


def _fixed_offset(tz) -> Optional[str]:
    jan = datetime(2025, 1, 15, tzinfo=tz).utcoffset()
    jul = datetime(2025, 7, 15, tzinfo=tz).utcoffset()
    if jan != jul or jan is None:
        return None
    minutes = int(jan.total_seconds() // 60)
    sign = "+" if minutes >= 0 else "-"
    minutes = abs(minutes)
    return f"{sign}{minutes // 60:02d}{minutes % 60:02d}"


def build_ics(db: Session, user: User, lang: str) -> bytes:
    tz = user_zone(user)
    tzid = user.tz or "Asia/Tashkent"
    now_stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    cal_name = CALENDAR_NAMES.get(lang, CALENDAR_NAMES["en"])
    lines = [
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Makon//Study//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
        f"X-WR-CALNAME:{_ics_escape(cal_name)}", f"X-WR-TIMEZONE:{tzid}", "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    ]
    offset = _fixed_offset(tz)
    if offset:
        lines += [
            "BEGIN:VTIMEZONE", f"TZID:{tzid}", "BEGIN:STANDARD", "DTSTART:19700101T000000",
            f"TZOFFSETFROM:{offset}", f"TZOFFSETTO:{offset}", f"TZNAME:{offset[:3]}", "END:STANDARD", "END:VTIMEZONE",
        ]
    courses: Dict[str, str] = {
        c.id: c.name for c in db.scalars(select(Course).where(Course.user_id == user.id, Course.deleted.is_(False)))
    }

    items = db.scalars(select(TimetableItem).where(TimetableItem.user_id == user.id, TimetableItem.deleted.is_(False)))
    for it in items:
        created = datetime.fromtimestamp(it.created_at / 1000, tz).date()
        monday = created - timedelta(days=created.weekday())
        day = monday + timedelta(days=it.weekday - 1)
        start = f"{day.strftime('%Y%m%d')}T{it.start.replace(':', '')}00"
        end = f"{day.strftime('%Y%m%d')}T{it.end.replace(':', '')}00"
        kind = TIMETABLE_KINDS.get(it.kind, {}).get(lang, it.kind)
        lines += [
            "BEGIN:VEVENT", f"UID:tt-{it.id}@makon", f"DTSTAMP:{now_stamp}",
            f"DTSTART;TZID={tzid}:{start}", f"DTEND;TZID={tzid}:{end}",
            f"RRULE:FREQ=WEEKLY;BYDAY={ICS_DAYS[it.weekday - 1]}",
            f"SUMMARY:{_ics_escape(it.title)}", f"DESCRIPTION:{_ics_escape(kind)}",
        ]
        if it.location:
            lines.append(f"LOCATION:{_ics_escape(it.location)}")
        lines.append("END:VEVENT")

    tasks = db.scalars(select(Task).where(Task.user_id == user.id, Task.deleted.is_(False), Task.done.is_(False),
                                          Task.due_date.isnot(None)))
    for task in tasks:
        summary = task.title + (f" · {courses[task.course_id]}" if task.course_id in courses else "")
        kind = TASK_KINDS.get(task.kind, {}).get(lang, task.kind)
        d = date.fromisoformat(task.due_date)
        lines += ["BEGIN:VEVENT", f"UID:task-{task.id}@makon", f"DTSTAMP:{now_stamp}"]
        if task.due_time:
            lines += [f"DTSTART;TZID={tzid}:{d.strftime('%Y%m%d')}T{task.due_time.replace(':', '')}00", "DURATION:PT30M"]
        else:
            lines += [f"DTSTART;VALUE=DATE:{d.strftime('%Y%m%d')}",
                      f"DTEND;VALUE=DATE:{(d + timedelta(days=1)).strftime('%Y%m%d')}"]
        lines += [
            f"SUMMARY:{_ics_escape('📌 ' + summary)}", f"DESCRIPTION:{_ics_escape(kind)}",
            "BEGIN:VALARM", "ACTION:DISPLAY", f"DESCRIPTION:{_ics_escape(summary)}",
            f"TRIGGER:-PT{max(user.remind_minutes or 60, 5)}M", "END:VALARM", "END:VEVENT",
        ]
    lines.append("END:VCALENDAR")
    return ("\r\n".join(_fold(line) for line in lines) + "\r\n").encode("utf-8")
