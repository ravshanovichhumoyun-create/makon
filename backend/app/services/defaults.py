"""Built-in categories and server-side labels (bot messages, exports)."""
import uuid
from typing import Dict, List

NAMESPACE = uuid.UUID("6f1c2b7e-3a4d-4e5f-9a8b-1c2d3e4f5a6b")

# key, type, icon, color — names come from CATEGORY_NAMES (and the frontend locales).
DEFAULT_CATEGORIES: List[Dict] = [
    {"key": "food", "type": "expense", "icon": "🛒", "color": "#2a78d6"},
    {"key": "cafe", "type": "expense", "icon": "☕", "color": "#eb6834"},
    {"key": "transport", "type": "expense", "icon": "🚕", "color": "#1baf7a"},
    {"key": "education", "type": "expense", "icon": "🎓", "color": "#6250d6"},
    {"key": "books", "type": "expense", "icon": "📚", "color": "#0e7490"},
    {"key": "internet", "type": "expense", "icon": "📱", "color": "#e87ba4"},
    {"key": "shopping", "type": "expense", "icon": "🛍️", "color": "#eda100"},
    {"key": "health", "type": "expense", "icon": "💊", "color": "#008300"},
    {"key": "home", "type": "expense", "icon": "🏠", "color": "#e34948"},
    {"key": "fun", "type": "expense", "icon": "🎬", "color": "#8d6e63"},
    {"key": "other_expense", "type": "expense", "icon": "📦", "color": "#898781"},
    {"key": "salary", "type": "income", "icon": "💼", "color": "#1baf7a"},
    {"key": "scholarship", "type": "income", "icon": "🎓", "color": "#2a78d6"},
    {"key": "freelance", "type": "income", "icon": "💻", "color": "#6250d6"},
    {"key": "family", "type": "income", "icon": "👪", "color": "#eda100"},
    {"key": "other_income", "type": "income", "icon": "➕", "color": "#898781"},
]

CATEGORY_NAMES: Dict[str, Dict[str, str]] = {
    "food": {"uz": "Oziq-ovqat", "en": "Groceries", "ru": "Продукты"},
    "cafe": {"uz": "Kafe", "en": "Cafes", "ru": "Кафе"},
    "transport": {"uz": "Transport", "en": "Transport", "ru": "Транспорт"},
    "education": {"uz": "Taʼlim", "en": "Education", "ru": "Образование"},
    "books": {"uz": "Kitob va kanselyariya", "en": "Books & supplies", "ru": "Книги и канцелярия"},
    "internet": {"uz": "Aloqa", "en": "Phone & internet", "ru": "Связь"},
    "shopping": {"uz": "Xaridlar", "en": "Shopping", "ru": "Покупки"},
    "health": {"uz": "Salomatlik", "en": "Health", "ru": "Здоровье"},
    "home": {"uz": "Uy-roʻzgʻor", "en": "Home & bills", "ru": "Дом и счета"},
    "fun": {"uz": "Hordiq", "en": "Entertainment", "ru": "Досуг"},
    "other_expense": {"uz": "Boshqa", "en": "Other", "ru": "Другое"},
    "salary": {"uz": "Maosh", "en": "Salary", "ru": "Зарплата"},
    "scholarship": {"uz": "Stipendiya", "en": "Scholarship", "ru": "Стипендия"},
    "freelance": {"uz": "Frilans", "en": "Freelance", "ru": "Фриланс"},
    "family": {"uz": "Oiladan", "en": "Family", "ru": "От семьи"},
    "other_income": {"uz": "Boshqa", "en": "Other", "ru": "Другое"},
}

FALLBACK_KEY = {"expense": "other_expense", "income": "other_income"}


def category_id(user_id: str, key: str) -> str:
    """Deterministic id of a built-in category for a given user."""
    return str(uuid.uuid5(NAMESPACE, f"{user_id}:{key}"))


def stable_id(*parts: object) -> str:
    return str(uuid.uuid5(NAMESPACE, ":".join(str(p) for p in parts)))


def category_label(cat, lang: str) -> str:
    """Display name for a Category row (custom name wins over the built-in one)."""
    if cat is None:
        return CATEGORY_NAMES["other_expense"].get(lang, "Other")
    if cat.name:
        return cat.name
    names = CATEGORY_NAMES.get(cat.key or "", {})
    return names.get(lang) or names.get("en") or "—"


WEEKDAYS = {
    "uz": ["Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba", "Yakshanba"],
    "en": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
    "ru": ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"],
}

TIMETABLE_KINDS = {
    "lecture": {"uz": "Maʼruza", "en": "Lecture", "ru": "Лекция"},
    "practice": {"uz": "Amaliyot", "en": "Practice", "ru": "Практика"},
    "lab": {"uz": "Laboratoriya", "en": "Lab", "ru": "Лабораторная"},
    "seminar": {"uz": "Seminar", "en": "Seminar", "ru": "Семинар"},
    "assignment": {"uz": "Vazifa", "en": "Assignment", "ru": "Задание"},
    "project": {"uz": "Loyiha", "en": "Project", "ru": "Проект"},
    "personal": {"uz": "Shaxsiy", "en": "Personal", "ru": "Личное"},
}

TASK_KINDS = {
    "homework": {"uz": "Uy vazifasi", "en": "Homework", "ru": "Домашнее задание"},
    "exam": {"uz": "Imtihon", "en": "Exam", "ru": "Экзамен"},
    "independent": {"uz": "Mustaqil ish", "en": "Independent work", "ru": "Самостоятельная работа"},
    "lab": {"uz": "Laboratoriya", "en": "Lab", "ru": "Лабораторная"},
    "other": {"uz": "Boshqa", "en": "Other", "ru": "Другое"},
}
