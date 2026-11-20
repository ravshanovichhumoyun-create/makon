"""Server-side texts (Telegram bot, exports) in Uzbek, English and Russian."""
from datetime import date

MONTHS = {
    "uz": ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"],
    "en": ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
           "November", "December"],
    "ru": ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь",
           "ноябрь", "декабрь"],
}
# Russian dates need the genitive: "20 ноября"
MONTHS_GEN_RU = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября",
                 "ноября", "декабря"]
WEEKDAYS_LOWER = {
    "uz": ["dushanba", "seshanba", "chorshanba", "payshanba", "juma", "shanba", "yakshanba"],
    "en": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
    "ru": ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"],
}

BOT = {
    "uz": {
        "welcome": "👋 Salom, {name}! Bot ulandi.",
        "help": (
            "Xarajat qoʻshish uchun yozing:\n"
            "• Korzinka 85000\n"
            "• taksi 25k\n"
            "• +1,5 mln oylik\n\n"
            "/today — bugungi reja\n"
            "/month — oy hisoboti\n"
            "/undo — oxirgisini bekor qilish"
        ),
        "link_invalid": "Havola eskirgan. Ilovada qaytadan “Ulash” tugmasini bosing.",
        "no_amount": "Summa topilmadi. Masalan: Korzinka 85000",
        "undo_btn": "↩️ Bekor qilish",
        "undone": "↩️ Bekor qilindi",
        "nothing_to_undo": "Bekor qilinadigan yozuv yoʻq.",
        "classes": "🎓 Darslar",
        "no_classes": "Bugun dars yoʻq",
        "deadlines": "📌 Bugungi muddatlar",
        "plans": "✅ Bugungi rejalar",
        "overdue": "⚠️ Muddati oʻtgan vazifalar: {n}",
        "spent_today": "💸 Bugungi chiqim: {amount}",
        "income": "Kirim",
        "expense": "Chiqim",
        "balance": "Qoldiq",
        "budget_left": "Byudjetdan qoldi: {amount}",
        "budget_over": "Byudjetdan oshdi: {amount}",
        "top": "Eng koʻp:",
        "good_morning": "☀️ Xayrli tong!",
        "reminder": "⏰ {when}: {title}",
        "in_minutes": "{n} daqiqadan keyin",
        "in_hours": "{n} soatdan keyin",
        "group_only_private": "Bot faqat shaxsiy chatda ishlaydi.",
        "reset_code": (
            "🔑 Makon: parolni tiklash kodi\n\n{code}\n\n"
            "Kod 10 daqiqa amal qiladi. Uni hech kimga bermang. "
            "Agar siz soʻramagan boʻlsangiz, bu xabarga eʼtibor bermang."
        ),
        "reset_done": "✅ Makon paroli oʻzgartirildi. Boshqa qurilmalardagi sessiyalar yopildi.",
    },
    "en": {
        "welcome": "👋 Hi, {name}! The bot is connected.",
        "help": (
            "Send a message to add an expense:\n"
            "• Groceries 85000\n"
            "• taxi 25k\n"
            "• +1.5 mln salary\n\n"
            "/today — today's plan\n"
            "/month — monthly summary\n"
            "/undo — undo the last entry"
        ),
        "link_invalid": "This link has expired. Tap “Connect” in the app again.",
        "no_amount": "No amount found. Example: Groceries 85000",
        "undo_btn": "↩️ Undo",
        "undone": "↩️ Undone",
        "nothing_to_undo": "Nothing to undo.",
        "classes": "🎓 Classes",
        "no_classes": "No classes today",
        "deadlines": "📌 Due today",
        "plans": "✅ Today's plans",
        "overdue": "⚠️ Overdue tasks: {n}",
        "spent_today": "💸 Spent today: {amount}",
        "income": "Income",
        "expense": "Expenses",
        "balance": "Balance",
        "budget_left": "Budget left: {amount}",
        "budget_over": "Over budget: {amount}",
        "top": "Top:",
        "good_morning": "☀️ Good morning!",
        "reminder": "⏰ {when}: {title}",
        "in_minutes": "in {n} min",
        "in_hours": "in {n} h",
        "group_only_private": "The bot works in private chats only.",
        "reset_code": (
            "🔑 Makon: password reset code\n\n{code}\n\n"
            "The code works for 10 minutes. Never share it. "
            "If you didn't ask for it, just ignore this message."
        ),
        "reset_done": "✅ Your Makon password was changed. Other devices were signed out.",
    },
    "ru": {
        "welcome": "👋 Привет, {name}! Бот подключён.",
        "help": (
            "Чтобы добавить расход, напишите:\n"
            "• Корзинка 85000\n"
            "• такси 25k\n"
            "• +1,5 млн зарплата\n\n"
            "/today — план на сегодня\n"
            "/month — отчёт за месяц\n"
            "/undo — отменить последнюю запись"
        ),
        "link_invalid": "Ссылка устарела. Снова нажмите «Подключить» в приложении.",
        "no_amount": "Сумма не найдена. Например: Корзинка 85000",
        "undo_btn": "↩️ Отменить",
        "undone": "↩️ Отменено",
        "nothing_to_undo": "Нечего отменять.",
        "classes": "🎓 Занятия",
        "no_classes": "Сегодня занятий нет",
        "deadlines": "📌 Сроки на сегодня",
        "plans": "✅ Планы на сегодня",
        "overdue": "⚠️ Просроченные задания: {n}",
        "spent_today": "💸 Расход за сегодня: {amount}",
        "income": "Доход",
        "expense": "Расход",
        "balance": "Остаток",
        "budget_left": "Осталось от бюджета: {amount}",
        "budget_over": "Бюджет превышен на: {amount}",
        "top": "Больше всего:",
        "good_morning": "☀️ Доброе утро!",
        "reminder": "⏰ {when}: {title}",
        "in_minutes": "через {n} мин",
        "in_hours": "через {n} ч",
        "group_only_private": "Бот работает только в личном чате.",
        "reset_code": (
            "🔑 Makon: код для сброса пароля\n\n{code}\n\n"
            "Код действует 10 минут. Никому его не сообщайте. "
            "Если вы его не запрашивали, просто проигнорируйте это сообщение."
        ),
        "reset_done": "✅ Пароль Makon изменён. Сеансы на других устройствах завершены.",
    },
}

COMMANDS = {
    "uz": [("today", "Bugungi reja"), ("month", "Oy hisoboti"), ("undo", "Oxirgisini bekor qilish"), ("help", "Yordam")],
    "en": [("today", "Today's plan"), ("month", "Monthly summary"), ("undo", "Undo the last entry"), ("help", "Help")],
    "ru": [("today", "План на сегодня"), ("month", "Отчёт за месяц"), ("undo", "Отменить последнюю запись"),
           ("help", "Помощь")],
}

NOT_LINKED = (
    "Bu bot Makon ilovasiga ulanadi. Ilovada: Sozlamalar → Telegram → Ulash.\n\n"
    "This bot connects to the Makon app. In the app: Settings → Telegram → Connect.\n\n"
    "Этот бот подключается к приложению Makon. В приложении: Настройки → Telegram → Подключить."
)


def t(lang: str, key: str, **kwargs) -> str:
    table = BOT.get(lang) or BOT["uz"]
    text = table.get(key) or BOT["uz"][key]
    return text.format(**kwargs) if kwargs else text


def all_langs(key: str) -> str:
    """The same message in every language (used before we know who is writing)."""
    return "\n\n".join(BOT[lang][key] for lang in ("uz", "en", "ru"))


def money(amount: int, lang: str) -> str:
    amount = int(amount or 0)
    sign = "−" if amount < 0 else ""
    digits = f"{abs(amount):,}"
    if lang == "en":
        return f"{sign}{digits} UZS"
    if lang == "ru":
        return f"{sign}{digits.replace(',', ' ')} сум"
    return f"{sign}{digits.replace(',', ' ')} soʻm"


def long_date(d: date, lang: str) -> str:
    wd = WEEKDAYS_LOWER.get(lang, WEEKDAYS_LOWER["uz"])[d.weekday()]
    if lang == "en":
        return f"{wd}, {d.day} {MONTHS['en'][d.month - 1]}"
    if lang == "ru":
        return f"{wd}, {d.day} {MONTHS_GEN_RU[d.month - 1]}"
    return f"{d.day}-{MONTHS['uz'][d.month - 1]}, {wd}"


def month_title(d: date, lang: str) -> str:
    month = MONTHS.get(lang, MONTHS["uz"])[d.month - 1]
    if lang in ("uz", "ru"):
        month = month.capitalize()
    return f"{month} {d.year}"
