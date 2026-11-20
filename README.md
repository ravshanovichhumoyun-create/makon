# Makon ✦

Moliya, darslar, kitoblar, loyihalar, rejalar, chellenjlar va eslatmalar bir joyda. Veb-sayt va telefonga oʻrnatiladigan ilova (PWA) bitta koddan ishlaydi. Interfeys oʻzbek, rus va ingliz tillarida, internetsiz ham ishlaydi, qurilmalar oʻzaro sinxronlanadi.

**English summary is at the bottom.**

## Imkoniyatlar

| Boʻlim | Nima bor |
|---|---|
| **Bugun** | Fonli bosh ekran: jonli manzara (quyosh/oy haqiqiy quyosh chiqishi-botishiga qarab) yoki oʻz rasmingiz, katta soat, ob-havo, 3D balans kartasi, eslatmalar. Bugungi rejalar (bajarildi belgisi), bugungi faollik halqasi va 7 kunlik grafik, darslar, muddatlar, xarajat, oʻqilayotgan kitob |
| **Chellenjlar** | Nomi, necha kun, boshlanish sanasi, kunlik maqsad; holat (rejada / jarayonda / tugallandi), seriya, reja va natija grafigi, kunlar kalendari |
| **Moliya** | Kalkulyatorli kiritish (`45 000 + 5 000`), tez yozish (`taksi 25k`), davrlar (kun/hafta/oy/yil/oraliq), tarkib, kunlik va 6 oylik grafiklar, prognoz, aqlli tahlil, kategoriya va oylik byudjet, jamgʻarma maqsadlari, Excel/CSV eksport |
| **Oʻqish** | Fanlar (vazifalar, avtomatik saqlanadigan konspekt, jadval), haftalik dars jadvali, barcha vazifalar muddat boʻyicha, Google/Apple kalendarga obuna (.ics) |
| **Kutubxona** | PDF kitoblar (bulutda yoki qurilmada), muqova rasmi (oʻzingiz tanlaysiz yoki PDFning 1-sahifasidan avtomatik), “Oʻqib boʻldim” belgisi, toʻliq ekranli PDF oʻquvchi (iPhone va Android'da ham), oʻqilgan sahifa avtomatik eslab qolinadi |
| **Loyihalar** | Rejada / Jarayonda / Tugallangan doskasi, muddat hisoblagichi, qadamlar, havola, teglar |
| **Eslatmalar** | Rangli kartochkalar, teglar, qadash, qidiruv |
| **Telegram bot** | `Korzinka 85000` deb yozing va xarajat qoʻshiladi (bekor qilish tugmasi bilan). `/today`, `/month`, `/undo` buyruqlari, ertalabki xabar, muddatdan 1 soat oldin eslatma |
| **Profil** | Profil rasmi, bosh sahifa foni (manzara, 6 ta rang yoki oʻz rasmingiz), ob-havo shahri, til: oʻzbek / rus / ingliz |
| **Xavfsizlik** | Parol (PBKDF2), JWT, parolni Telegram bot orqali tiklash (6 xonali kod, 10 daqiqa), hisob boʻyicha login cheklovi (IP almashtirish yordam bermaydi), PIN-qulf (10 ta xatodan keyin chiqib ketadi), XSS himoyasi, qatʼiy CSP, HSTS, rasmlar imzosi boʻyicha tekshiriladi |

## Kompyuterda ishga tushirish (macOS)

```bash
cd "my kundalik projrct "
./run.sh
```

Brauzerda **http://localhost:8080** ni oching. Birinchi ishga tushishda kerakli paketlar oʻrnatiladi. Maʼlumotlar `data/` papkasidagi SQLite faylga yoziladi, PDF fayllar `data/files/` ga.

Telefonda sinash uchun kompyuter va telefon bitta Wi-Fi tarmogʻida boʻlishi kerak. Telefonda `http://<kompyuter-IP>:8080` ni oching. PIN-qulf va ilovani oʻrnatish faqat https orqali ishlaydi, shuning uchun ularni internetga joylangan versiyada sinang.

Testlar:

```bash
.venv/bin/python -m pytest backend/tests -q
# PostgreSQL'da: TEST_DATABASE_URL=postgresql://... .venv/bin/python -m pytest backend/tests -q
```

## Bepul va doimiy ishlaydigan server

Uchta bepul xizmat kerak, hech biri karta soʻramaydi (ob-havo uchun Open-Meteo ham bepul va kalitsiz):

| Xizmat | Vazifasi |
|---|---|
| **Supabase** | PostgreSQL maʼlumotlar bazasi (500 MB) va PDF fayllar uchun joy (1 GB) |
| **Render** | Server: API, sayt va ilova bitta manzilda |
| **cron-job.org** | Har 10 daqiqada serverni uygʻotib turadi, shunda u uxlab qolmaydi |

### 1. Kodni GitHub'ga yuklash

```bash
git init && git add . && git commit -m "Makon"
```

GitHub'da yangi **private** repozitoriy oching va koʻrsatilgan `git remote add …` hamda `git push` buyruqlarini bajaring.

### 2. Supabase: baza va fayllar

1. [supabase.com](https://supabase.com) → **New project**. Region: **Central EU (Frankfurt)**. Parolni saqlab qoʻying.
2. **Project Settings → Database → Connection string → Session pooler** havolasini nusxalang. `[YOUR-PASSWORD]` oʻrniga parolingizni yozing. Parolda `@ # / ?` belgilari boʻlsa, ularni URL-kodlang yoki parolni oddiyroq qiling.
3. **Project Settings → API** boʻlimidan **Project URL** va **service_role** kalitini oling. Bu kalitni hech kimga koʻrsatmang.

### 3. Render: server

1. [render.com](https://render.com) → GitHub bilan kiring → **New → Blueprint** → repozitoriyni tanlang. `render.yaml` avtomatik oʻqiladi.
2. Soʻralgan qiymatlarni kiriting:
   - `DATABASE_URL`: Supabase'dagi Session pooler havolasi
   - `SUPABASE_URL` va `SUPABASE_SERVICE_KEY`: PDF'lar bulutda saqlanishi uchun. Boʻsh qoldirilsa, PDF faqat qurilmada saqlanadi.
   - `TELEGRAM_BOT_TOKEN`: ixtiyoriy, 5-qadamga qarang
3. **Apply** bosing. 3–5 daqiqadan keyin sayt `https://makon-xxxx.onrender.com` manzilida ochiladi.

### 4. Serverni uygʻoq ushlab turish

Render'ning bepul serveri 15 daqiqa soʻrov boʻlmasa uxlab qoladi va keyingi ochilishda ~50 soniya uygʻonadi. Buning oldini olish uchun:

[cron-job.org](https://cron-job.org) → roʻyxatdan oʻting → **Create cronjob**:
- URL: `https://makon-xxxx.onrender.com/api/health`
- Schedule: **every 10 minutes**

Bepul rejadagi 750 soat bir oyga (744 soat) yetadi, shuning uchun server kecha-kunduz ishlaydi. Shu Render hisobida boshqa bepul servis boʻlsa, soatlar ular bilan boʻlinadi.

`/api/health` har safar bazaga ham murojaat qiladi. Shu sababli bu ping bepul Supabase loyihasini ham faol ushlab turadi (Supabase 7 kun ishlatilmagan bepul loyihani toʻxtatadi).

Server uxlab qolsa ham ilova ochilaveradi va internetsiz ishlayveradi. Oʻzgarishlar server uygʻonganda yuboriladi.

### 5. Telegram bot (ixtiyoriy)

1. Eski loyihadagi token kodda ochiq turgan edi. **@BotFather → /revoke** bilan uni bekor qiling.
2. @BotFather → `/newbot` → yangi token oling va Render'da **Environment → TELEGRAM_BOT_TOKEN** ga qoʻying. Server webhook'ni oʻzi sozlaydi.
3. Ilovada **Sozlamalar → Telegram → Ulash** → Telegram ochiladi → **Start**. Bot faqat shu tarzda bogʻlangan hisobga yozadi.
4. Parolni unutsangiz: kirish oynasida **Parolni unutdingizmi?** → email → botga 6 xonali kod keladi. Bot ulanmagan boʻlsa, parolni tiklab boʻlmaydi, shuning uchun botni oldindan ulab qoʻying.

### 6. Telefonga oʻrnatish

- **Android (Chrome):** saytni oching → **Sozlamalar → Ilova → Oʻrnatish**, yoki brauzer menyusidan *Install app*.
- **iPhone (Safari):** **Ulashish → Bosh ekranga qoʻshish**.
- **Play Market uchun APK/AAB:** [pwabuilder.com](https://www.pwabuilder.com) ga sayt manzilini kiriting → **Package for stores → Android**. Bu bepul.

## Eski versiyadan koʻchish

1. Eski saytda (`http://127.0.0.1:8080`) chap pastdagi **⬇ Saqlash** tugmasini bosing, JSON fayl yuklanadi.
2. Makon'da **Sozlamalar → Maʼlumotlar → Import → Fayl tanlash**.
3. Amallar, kitoblar, fanlar va vazifalar, jadval, loyihalar, eslatmalar va jamgʻarma maqsadi koʻchadi. Eski ilova yaratgan namuna yozuvlar oʻtkazib yuboriladi (xohlasangiz belgilab qoʻshish mumkin). PDF fayllarni qayta biriktirish kerak.

## Tuzilma

```
backend/app/
  main.py            FastAPI ilova, xavfsizlik sarlavhalari, fon vazifalari, frontendni berish
  config.py          .env sozlamalari
  models.py          SQLAlchemy jadvallari (users, transactions, categories, goals, books,
                     courses, tasks, timetable, projects, notes, files)
  schemas.py         Pydantic validatsiya
  routers/           auth (+ parolni tiklash), sync + REST (/api/data/*), files, images, export/calendar/telegram/weather/cron
  services/          sync (oflayn-birinchi, last-write-wins), parser, telegram, exports, storage, weather
backend/tests/       72 ta test (SQLite va PostgreSQL)
frontend/
  index.html, sw.js, manifest.webmanifest
  css/app.css        dizayn tizimi (yorugʻ/qorongʻi)
  js/core/           store, sync, api, i18n, charts, calc, parser, ui, lock, importer, pdfview, images, weather, activity, fx
  js/pages/          today, hero, finance, study, library, challenges, projects, notes, settings, auth
  js/locales/        uz.js, ru.js, en.js
  fonts/             Outfit va Plus Jakarta Sans (OFL)
  vendor/pdfjs/      PDF.js 4.10 (Apache-2.0)
```

API hujjati: `/api/docs`.

---

## English

**Makon** is a personal hub for money, study, books, projects, notes, daily plans and challenges. One codebase serves the website and an installable PWA. It runs in Uzbek, Russian and English, works offline and syncs across devices.

- **Run locally:** `./run.sh` → http://localhost:8080 (SQLite in `data/`).
- **Tests:** `.venv/bin/python -m pytest backend/tests -q`. 72 tests pass on SQLite and PostgreSQL.
- **Free hosting:** Render (free web service, `render.yaml` blueprint) + Supabase (Postgres + Storage) + cron-job.org pinging `/api/health` every 10 min so the instance never sleeps.
- **Env vars:** see `.env.example`. `SECRET_KEY` and `DATABASE_URL` are required in production. Supabase keys enable cloud PDFs, and `TELEGRAM_BOT_TOKEN` enables the bot (webhook is registered automatically) and password reset by Telegram code. On hosts other than Render set `TRUSTED_PROXY_HOPS=1` so rate limits see the real client IP.
- **Schema changes:** new columns are added automatically at startup (`add_missing_columns`), so an existing database keeps working after an update.
- **Architecture:** FastAPI + SQLAlchemy 2 + Pydantic 2, offline-first sync (`POST /api/sync`, per-user revision cursor, last-write-wins with soft deletes), plus plain REST at `/api/data/{kind}`. Exports: `/api/export/transactions.{csv,xlsx}` and a private `.ics` calendar feed. The frontend is dependency-free ES modules (no build step) with a strict CSP, auto-escaping templates and a service worker.
