"""Pydantic schemas: request bodies and validation of synced record data."""
import re
from datetime import date
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
COLOR_RE = re.compile(r"^(#[0-9a-fA-F]{6}|[a-z]{3,12})$")
ID_RE = re.compile(r"^[A-Za-z0-9_\-:.]{1,64}$")
EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$")

MAX_AMOUNT = 10 ** 13


def _check_date(v: Optional[str]) -> Optional[str]:
    if v is None or v == "":
        return None
    if not DATE_RE.match(v):
        raise ValueError("invalid date")
    date.fromisoformat(v)
    return v


def _check_time(v: Optional[str]) -> Optional[str]:
    if v is None or v == "":
        return None
    if not TIME_RE.match(v):
        raise ValueError("invalid time")
    return v


def _check_id(v: Optional[str]) -> Optional[str]:
    if v is None or v == "":
        return None
    if not ID_RE.match(v):
        raise ValueError("invalid id")
    return v


LANG_PATTERN = "^(uz|en|ru)$"
BACKGROUND_RE = re.compile(r"^(|g:[a-z0-9-]{1,24}|img:[A-Za-z0-9_\-:.]{1,64})$")


def _check_color(v: str) -> str:
    v = (v or "").strip()
    if v and not COLOR_RE.match(v):
        raise ValueError("invalid color")
    return v


class _Data(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)


# ---------------------------------------------------------------- record data


class CategoryData(_Data):
    type: str = Field(pattern="^(expense|income)$")
    key: Optional[str] = Field(default=None, max_length=32)
    name: str = Field(default="", max_length=60)
    icon: str = Field(default="", max_length=16)
    color: str = Field(default="", max_length=16)
    monthly_limit: Optional[int] = Field(default=None, ge=0, le=MAX_AMOUNT)
    sort: int = Field(default=0, ge=-100000, le=100000)

    _color = field_validator("color")(_check_color)


class TransactionData(_Data):
    type: str = Field(pattern="^(expense|income)$")
    amount: int = Field(gt=0, le=MAX_AMOUNT)
    category_id: str = Field(min_length=1, max_length=64)
    date: str
    note: str = Field(default="", max_length=500)
    source: str = Field(default="manual", pattern="^(manual|telegram|import)$")

    @field_validator("date")
    @classmethod
    def _date(cls, v: str) -> str:
        if not v:
            raise ValueError("date required")
        return _check_date(v)  # type: ignore[return-value]


class GoalData(_Data):
    title: str = Field(min_length=1, max_length=120)
    target: int = Field(gt=0, le=MAX_AMOUNT)
    saved: int = Field(default=0, ge=0, le=MAX_AMOUNT)
    deadline: Optional[str] = None
    icon: str = Field(default="", max_length=16)
    color: str = Field(default="", max_length=16)

    _deadline = field_validator("deadline")(_check_date)
    _color = field_validator("color")(_check_color)


class BookData(_Data):
    title: str = Field(min_length=1, max_length=200)
    author: str = Field(default="", max_length=120)
    category: str = Field(default="other", pattern="^(it|science|business|fiction|self|religion|language|other)$")
    total_pages: int = Field(default=0, ge=0, le=100000)
    read_pages: int = Field(default=0, ge=0, le=100000)
    description: str = Field(default="", max_length=1000)
    file_id: Optional[str] = Field(default=None, max_length=64)
    file_name: str = Field(default="", max_length=255)
    file_size: Optional[int] = Field(default=None, ge=0)
    cover_id: Optional[str] = Field(default=None, max_length=64)
    finished_at: Optional[str] = None

    _finished_at = field_validator("finished_at")(_check_date)
    _cover_id = field_validator("cover_id")(_check_id)

    @field_validator("read_pages")
    @classmethod
    def _read(cls, v: int, info) -> int:
        total = info.data.get("total_pages") or 0
        return min(v, total) if total else v


class CourseData(_Data):
    name: str = Field(min_length=1, max_length=120)
    teacher: str = Field(default="", max_length=120)
    room: str = Field(default="", max_length=120)
    description: str = Field(default="", max_length=1000)
    color: str = Field(default="indigo", max_length=16)
    notes: str = Field(default="", max_length=100000)

    _color = field_validator("color")(_check_color)


class TaskData(_Data):
    course_id: Optional[str] = Field(default=None, max_length=64)
    title: str = Field(min_length=1, max_length=300)
    kind: str = Field(default="homework", pattern="^(homework|exam|independent|lab|other)$")
    due_date: Optional[str] = None
    due_time: Optional[str] = None
    done: bool = False
    done_at: Optional[str] = None

    _due_date = field_validator("due_date")(_check_date)
    _due_time = field_validator("due_time")(_check_time)
    _done_at = field_validator("done_at")(_check_date)


class PlanData(_Data):
    title: str = Field(min_length=1, max_length=300)
    date: str
    time: Optional[str] = None
    done: bool = False
    done_at: Optional[str] = None

    _time = field_validator("time")(_check_time)
    _done_at = field_validator("done_at")(_check_date)

    @field_validator("date")
    @classmethod
    def _date(cls, v: str) -> str:
        if not v:
            raise ValueError("date required")
        return _check_date(v)  # type: ignore[return-value]


class ChallengeData(_Data):
    title: str = Field(min_length=1, max_length=120)
    icon: str = Field(default="🔥", max_length=16)
    color: str = Field(default="indigo", max_length=16)
    days: int = Field(default=30, ge=1, le=366)
    start_date: str
    goal: str = Field(default="", max_length=300)
    checkins: List[str] = Field(default_factory=list, max_length=400)
    stopped: bool = False

    _color = field_validator("color")(_check_color)

    @field_validator("start_date")
    @classmethod
    def _start(cls, v: str) -> str:
        if not v:
            raise ValueError("start_date required")
        return _check_date(v)  # type: ignore[return-value]

    @field_validator("checkins")
    @classmethod
    def _checkins(cls, v: List[str]) -> List[str]:
        out = set()
        for d in v:
            try:
                checked = _check_date(str(d))
            except ValueError:
                continue  # one bad day must not throw away the whole challenge
            if checked:
                out.add(checked)
        return sorted(out)


class TimetableData(_Data):
    title: str = Field(min_length=1, max_length=120)
    weekday: int = Field(ge=1, le=7)
    start: str
    end: str
    kind: str = Field(default="lecture", pattern="^(lecture|practice|lab|seminar|assignment|project|personal)$")
    location: str = Field(default="", max_length=120)
    course_id: Optional[str] = Field(default=None, max_length=64)

    @field_validator("start", "end")
    @classmethod
    def _time(cls, v: str) -> str:
        if not v or not TIME_RE.match(v):
            raise ValueError("invalid time")
        return v

    @field_validator("end")
    @classmethod
    def _end_after_start(cls, v: str, info) -> str:
        start = info.data.get("start")
        if start and v <= start:
            raise ValueError("end must be after start")
        return v


class SubtaskData(_Data):
    id: str = Field(min_length=1, max_length=64)
    text: str = Field(min_length=1, max_length=300)
    done: bool = False


class ProjectData(_Data):
    title: str = Field(min_length=1, max_length=200)
    status: str = Field(default="planned", pattern="^(planned|active|done)$")
    deadline: Optional[str] = None
    tags: List[str] = Field(default_factory=list, max_length=20)
    link: str = Field(default="", max_length=500)
    description: str = Field(default="", max_length=20000)
    subtasks: List[SubtaskData] = Field(default_factory=list, max_length=300)

    _deadline = field_validator("deadline")(_check_date)

    @field_validator("tags")
    @classmethod
    def _tags(cls, v: List[str]) -> List[str]:
        out = []
        for tag in v:
            tag = str(tag).strip()[:40]
            if tag and tag not in out:
                out.append(tag)
        return out

    @field_validator("link")
    @classmethod
    def _link(cls, v: str) -> str:
        if v and not re.match(r"^https?://", v, re.I):
            raise ValueError("link must start with http:// or https://")
        return v


class NoteData(_Data):
    title: str = Field(default="", max_length=200)
    content: str = Field(default="", max_length=100000)
    color: str = Field(default="amber", max_length=16)
    pinned: bool = False
    tag: str = Field(default="", max_length=40)

    _color = field_validator("color")(_check_color)


# ---------------------------------------------------------------- sync


class ChangeIn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    kind: str = Field(max_length=32)
    id: str = Field(pattern=ID_RE.pattern)
    updated_at: int = Field(ge=0)
    created_at: Optional[int] = Field(default=None, ge=0)
    deleted: bool = False
    data: Dict[str, Any] = Field(default_factory=dict)


class SyncIn(BaseModel):
    cursor: int = Field(default=0, ge=0)
    changes: List[ChangeIn] = Field(default_factory=list, max_length=1000)


# ---------------------------------------------------------------- auth / profile


class RegisterIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=80)
    email: str = Field(max_length=255)
    password: str = Field(min_length=8, max_length=200)
    lang: str = Field(default="uz", pattern=LANG_PATTERN)
    tz: str = Field(default="Asia/Tashkent", max_length=64)

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        v = v.strip().lower()
        if not EMAIL_RE.match(v):
            raise ValueError("invalid email")
        return v


class LoginIn(BaseModel):
    email: str = Field(max_length=255)
    password: str = Field(max_length=200)


class ProfilePatch(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    lang: Optional[str] = Field(default=None, pattern=LANG_PATTERN)
    tz: Optional[str] = Field(default=None, max_length=64)
    monthly_budget: Optional[int] = Field(default=None, ge=0, le=MAX_AMOUNT)
    digest_enabled: Optional[bool] = None
    digest_time: Optional[str] = None
    remind_minutes: Optional[int] = Field(default=None, ge=0, le=1440)
    avatar_id: Optional[str] = Field(default=None, max_length=64)
    background: Optional[str] = Field(default=None, max_length=80)
    city: Optional[str] = Field(default=None, max_length=80)
    lat: Optional[float] = Field(default=None, ge=-90, le=90)
    lon: Optional[float] = Field(default=None, ge=-180, le=180)

    _digest_time = field_validator("digest_time")(_check_time)
    _avatar_id = field_validator("avatar_id")(_check_id)

    @field_validator("background")
    @classmethod
    def _background(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        if not BACKGROUND_RE.match(v):
            raise ValueError("invalid background")
        return v


class PasswordChangeIn(BaseModel):
    current: str = Field(max_length=200)
    new: str = Field(min_length=8, max_length=200)


class PasswordConfirmIn(BaseModel):
    password: str = Field(max_length=200)


class ResetRequestIn(BaseModel):
    email: str = Field(max_length=255)


class ResetConfirmIn(BaseModel):
    email: str = Field(max_length=255)
    code: str = Field(pattern=r"^\d{6}$")
    password: str = Field(min_length=8, max_length=200)
