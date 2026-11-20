"""Smart text parser for quick expense entry: "Korzinka 85000", "taksi 25k", "+1,5 mln oylik".

The same rules are implemented in frontend/js/core/parser.js; both are tested against
backend/tests/parser_cases.json so the bot and the app always agree.
"""
import re
from typing import Dict, List, Optional

APOSTROPHES = "ʻʼ‘’`´"

NOISE_PATTERNS = [
    # whole lines with a balance / remaining amount
    r"[^\n]*(?:balans|balance|ostatok|остаток|qoldiq|dostupno|доступно)[^\n]*",
    # phone numbers
    r"\+?998[\d\s\-]{9,13}",
    # card masks: 8600 **** **** 1234, ***4589, *4589
    r"(?:\b\d{4}\s?)?(?:[*•]{2,}\s?)+\d{2,4}\b",
    r"\*\d{4}\b",
    # dates and times
    r"\b\d{4}[./-]\d{1,2}[./-]\d{1,2}\b",
    r"\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b",
    r"\b\d{1,2}:\d{2}(?::\d{2})?\b",
]
_NOISE = [re.compile(p, re.I) for p in NOISE_PATTERNS]

# prefix group instead of look-behind (look-behind is not available on older iPhones in JS)
NUM_RE = re.compile(
    r"(^|[^0-9a-zа-яё_.,])([+-]?)(\d{1,3}(?:[ ,.]\d{3})+|\d+)(?:[.,](\d{1,2}))?(?!\d)"
    r"(\s*(k|к|ming|минг|тыс|tys|mln|million|млн|mlrd|млрд|mn|m)(?![a-zа-яё']))?"
)
CURRENCY_RE = re.compile(r"^\s*(so'm|som|sum|uzs|сум|сўм)(?![a-zа-яё'])")
TOKEN_RE = re.compile(r"[a-zа-яёўқғҳ']+")

MULTIPLIERS = {
    "k": 1e3, "к": 1e3, "ming": 1e3, "минг": 1e3, "тыс": 1e3, "tys": 1e3,
    "mln": 1e6, "million": 1e6, "млн": 1e6, "mn": 1e6, "m": 1e6,
    "mlrd": 1e9, "млрд": 1e9,
}

INCOME_WORDS = ["зарплат*", "доход*", "стипенд*", "аванс*", "преми*", 
    "kirim", "oylik*", "maosh*", "avans*", "stipend*", "zarplat*", "daromad*", "income", "salary*",
    "popolnen*", "пополн*", "zachisl*", "зачисл*", "tushdi", "tushum*", "keldi", "bonus*", "mukofot*",
    "frilans*", "freelance*",
]
EXPENSE_WORDS = ["chiqim", "xarajat*", "expense*", "spisan*", "списан*", "oplata", "оплата", "pokupka", "покупка"]
STOP_WORDS = {
    "kirim", "chiqim", "xarajat", "income", "expense", "oplata", "оплата", "spisanie", "списание",
    "popolnenie", "пополнение", "pokupka", "покупка", "zachislenie", "karta", "card", "uzcard", "humo",
    "uzs", "so'm", "som", "sum", "сум",
}

EXPENSE_KEYWORDS: Dict[str, List[str]] = {
    "food": ["корзин*", "макро", "хавас", "продукт*", "магазин*", "рынок*", "базар*", "хлеб*", "мясо*", "молок*", "овощ*", "фрукт*", "супермаркет*", "korzin*", "makro", "havas", "baraka", "carrefour", "magnum", "bozor*", "market*", "supermarket*",
             "non", "go'sht*", "gosht*", "sabzavot*", "meva*", "produkt*", "oziq*", "grocer*", "food", "sut",
             "tuxum*", "olma", "guruch*", "shakar", "choy"],
    "cafe": ["кафе*", "кофе*", "ресторан*", "обед*", "ужин*", "завтрак*", "лаваш*", "бургер*", "пицц*", "шаурм*", "самс*", "чайхан*", "kafe*", "cafe*", "coffee*", "kofe*", "qahva*", "evos", "kfc", "oqtepa*", "bellissimo", "maxway",
             "safia", "safiya", "choyxona*", "restoran*", "restaurant*", "osh", "lavash*", "burger*", "pizza*",
             "shaurma*", "tushlik*", "nonushta*", "kechki", "somsa*", "lunch", "dinner", "breakfast", "starbucks"],
    "transport": ["такси*", "яндекс*", "метро*", "автобус*", "бензин*", "метан*", "пропан*", "заправк*", "проезд*", "парковк*", "поезд*", "транспорт*", "taksi*", "taxi*", "yandex*", "uklon*", "mytaxi*", "metro*", "avtobus*", "bus", "benzin*",
                  "metan*", "propan*", "zapravka*", "yo'lkira*", "yo'l", "transport*", "parkovka*", "parking*",
                  "uber", "poyezd*", "train*", "avia*"],
    "education": ["курс*", "контракт*", "универ*", "репетитор*", "учеб*", "обучен*", "урок*", "kurs*", "course*", "kontrakt*", "univer*", "repetitor*", "ielts*", "toefl*", "udemy*",
                  "coursera*", "o'qish*", "oqish*", "ta'lim*", "talim*", "dars*", "lesson*", "tuition*"],
    "books": ["книг*", "тетрад*", "ручк*", "канцеляр*", "распечат*", "kitob*", "book*", "daftar*", "ruchka*", "qalam*", "kanstovar*", "kanselyar*", "print*", "nusxa*",
              "pechat*", "stationery*"],
    "internet": ["интернет*", "связь*", "мобильн*", "телефон*", "internet*", "uzmobile*", "ucell*", "beeline*", "mobiuz*", "humans*", "uztelecom*", "aloqa*",
                 "paynet*", "wifi*", "trafik*", "simkarta*"],
    "shopping": ["одежд*", "обув*", "шопинг*", "узум*", "kiyim*", "poyabzal*", "zara", "waikiki*", "lcw", "terra*", "shop*", "do'kon*", "dokon*",
                 "savdo*", "clothes*", "shoes*", "uzum*", "wildberries*", "ozon*", "aliexpress*"],
    "health": ["аптек*", "лекарств*", "врач*", "клиник*", "больниц*", "анализ*", "стоматолог*", "фитнес*", "спортзал*", "apteka*", "dori*", "dorixona*", "shifoxona*", "doktor*", "doctor*", "klinika*", "clinic*",
               "pharmacy*", "stomatolog*", "tish*", "analiz*", "fitnes*", "gym"],
    "home": ["коммунал*", "свет", "электр*", "газ", "вода", "аренд*", "квартир*", "ремонт*", "мебел*", "kommunal*", "svet*", "elektr*", "gaz", "suv", "ijara*", "arenda*", "kvartira*", "rent", "uy",
             "ta'mir*", "remont*", "mebel*"],
    "fun": ["кино*", "игр*", "концерт*", "театр*", "подписк*", "развлеч*", "kino*", "cinema*", "o'yin*", "oyin*", "game*", "netflix*", "spotify*", "youtube*", "obuna*",
            "subscription*", "konsert*", "concert*", "teatr*", "theatre*", "playstation*", "steam*", "bowling*"],
}
INCOME_KEYWORDS: Dict[str, List[str]] = {
    "salary": ["зарплат*", "аванс*", "оклад*", "oylik*", "maosh*", "zarplat*", "salary*", "avans*"],
    "scholarship": ["стипенд*", "грант*", "stipend*", "grant*", "scholarship*"],
    "freelance": ["фриланс*", "заказ*", "frilans*", "freelance*", "loyiha*", "zakaz*", "buyurtma*", "upwork*", "fiverr*"],
    "family": ["родител*", "мама", "папа", "семь*", "ota", "otam", "ona", "onam", "oila*", "uydan", "dadam*", "oyim*", "akam*", "opam*", "family*",
               "parents*"],
}


def normalize(text: str) -> str:
    out = text.lower()
    for ch in APOSTROPHES:
        out = out.replace(ch, "'")
    return out.replace(" ", " ").replace(" ", " ")


def _word_match(token: str, word: str) -> bool:
    if word.endswith("*"):
        return token.startswith(word[:-1])
    return token == word


def _has_any(tokens: List[str], words: List[str]) -> bool:
    return any(_word_match(t, w) for t in tokens for w in words)


def _best_category(tokens: List[str], table: Dict[str, List[str]]) -> Optional[str]:
    best, best_score = None, 0
    for key, words in table.items():
        score = sum(1 for t in tokens if any(_word_match(t, w) for w in words))
        if score > best_score:
            best, best_score = key, score
    return best


def _to_number(int_part: str, dec_part: Optional[str]) -> float:
    digits = re.sub(r"[ ,.]", "", int_part)
    value = float(digits)
    if dec_part:
        value += float("0." + dec_part)
    return value


def parse(text: str, custom: Optional[List[Dict]] = None) -> Optional[Dict]:
    """Return {amount, type, category_key, category_id, note} or None when no amount is found.

    custom: user's own categories [{id, type, name}] — matched by name before built-in keywords.
    """
    if not text or not text.strip():
        return None
    original = text.replace(" ", " ").replace(" ", " ")
    norm = normalize(text)
    if len(norm) != len(original):  # rare unicode case changes: fall back to normalized text
        original = norm
    for rx in _NOISE:
        original = rx.sub(lambda m: " " * len(m.group(0)), original)
        norm = rx.sub(lambda m: " " * len(m.group(0)), norm)

    candidates = []
    for m in NUM_RE.finditer(norm):
        sign, int_part, dec_part, mult = m.group(2), m.group(3), m.group(4), m.group(6)
        value = _to_number(int_part, dec_part)
        if mult:
            value *= MULTIPLIERS[mult]
        start = m.start(2) if sign else m.start(3)
        end = m.end()
        cur = CURRENCY_RE.match(norm[end:])
        if cur:
            end += cur.end()
        if value >= 1:
            candidates.append({
                "value": int(round(value)), "sign": sign, "start": start, "end": end,
                "preferred": bool(mult or cur),
            })
    if not candidates:
        return None
    pool = [c for c in candidates if c["preferred"]] or candidates
    chosen = max(pool, key=lambda c: c["value"])

    rest_norm = norm[: chosen["start"]] + " " + norm[chosen["end"]:]
    tokens = TOKEN_RE.findall(rest_norm)

    if chosen["sign"] == "+":
        tx_type = "income"
    elif chosen["sign"] == "-":
        tx_type = "expense"
    elif _has_any(tokens, INCOME_WORDS) and not _has_any(tokens, EXPENSE_WORDS):
        tx_type = "income"
    else:
        tx_type = "expense"

    category_id = None
    for cat in custom or []:
        if cat.get("type") != tx_type:
            continue
        name = normalize(str(cat.get("name") or "")).strip()
        if len(name) >= 3 and (name in tokens or (len(name) >= 4 and any(t.startswith(name) for t in tokens))):
            category_id = cat.get("id")
            break
    table = INCOME_KEYWORDS if tx_type == "income" else EXPENSE_KEYWORDS
    key = _best_category(tokens, table) or ("other_income" if tx_type == "income" else "other_expense")

    rest = original[: chosen["start"]] + " " + original[chosen["end"]:]
    words = []
    for word in re.split(r"\s+", rest):
        clean = re.sub(r"[^\w'&/.\-]", "", word, flags=re.UNICODE).strip(".-/")
        if clean and normalize(clean) not in STOP_WORDS:
            words.append(clean)
    note = " ".join(words).strip()[:200]
    if note:
        note = note[0].upper() + note[1:]
    return {
        "amount": chosen["value"],
        "type": tx_type,
        "category_key": key,
        "category_id": category_id,
        "note": note,
    }
