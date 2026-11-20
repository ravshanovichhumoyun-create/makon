// Quick-entry parser: "Korzinka 85000", "taksi 25k", "+1,5 mln oylik".
// Mirrors backend/app/services/parser.py; both are tested with backend/tests/parser_cases.json.

const APOSTROPHES = /[ʻʼ‘’`´]/g;

const NOISE = [
  /[^\n]*(?:balans|balance|ostatok|остаток|qoldiq|dostupno|доступно)[^\n]*/gi,
  /\+?998[\d\s-]{9,13}/gi,
  /(?:\b\d{4}\s?)?(?:[*•]{2,}\s?)+\d{2,4}\b/gi,
  /\*\d{4}\b/gi,
  /\b\d{4}[./-]\d{1,2}[./-]\d{1,2}\b/gi,
  /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/gi,
  /\b\d{1,2}:\d{2}(?::\d{2})?\b/gi,
];

const NUM_RE = /(^|[^0-9a-zа-яё_.,])([+-]?)(\d{1,3}(?:[ ,.]\d{3})+|\d+)(?:[.,](\d{1,2}))?(?!\d)(\s*(k|к|ming|минг|тыс|tys|mln|million|млн|mlrd|млрд|mn|m)(?![a-zа-яё']))?/g;
const CURRENCY_RE = /^\s*(so'm|som|sum|uzs|сум|сўм)(?![a-zа-яё'])/;
const TOKEN_RE = /[a-zа-яёўқғҳ']+/g;

const MULT = {
  k: 1e3, к: 1e3, ming: 1e3, минг: 1e3, тыс: 1e3, tys: 1e3,
  mln: 1e6, million: 1e6, млн: 1e6, mn: 1e6, m: 1e6, mlrd: 1e9, млрд: 1e9,
};

const INCOME_WORDS = ['зарплат*', 'доход*', 'стипенд*', 'аванс*', 'преми*', 'kirim', 'oylik*', 'maosh*', 'avans*', 'stipend*', 'zarplat*', 'daromad*', 'income', 'salary*',
  'popolnen*', 'пополн*', 'zachisl*', 'зачисл*', 'tushdi', 'tushum*', 'keldi', 'bonus*', 'mukofot*', 'frilans*', 'freelance*'];
const EXPENSE_WORDS = ['chiqim', 'xarajat*', 'expense*', 'spisan*', 'списан*', 'oplata', 'оплата', 'pokupka', 'покупка'];
const STOP = new Set(['kirim', 'chiqim', 'xarajat', 'income', 'expense', 'oplata', 'оплата', 'spisanie', 'списание',
  'popolnenie', 'пополнение', 'pokupka', 'покупка', 'zachislenie', 'karta', 'card', 'uzcard', 'humo', 'uzs', "so'm",
  'som', 'sum', 'сум']);

const EXPENSE_KEYWORDS = {
  food: ['корзин*', 'макро', 'хавас', 'продукт*', 'магазин*', 'рынок*', 'базар*', 'хлеб*', 'мясо*', 'молок*', 'овощ*', 'фрукт*', 'супермаркет*', 'korzin*', 'makro', 'havas', 'baraka', 'carrefour', 'magnum', 'bozor*', 'market*', 'supermarket*', 'non',
    "go'sht*", 'gosht*', 'sabzavot*', 'meva*', 'produkt*', 'oziq*', 'grocer*', 'food', 'sut', 'tuxum*', 'olma',
    'guruch*', 'shakar', 'choy'],
  cafe: ['кафе*', 'кофе*', 'ресторан*', 'обед*', 'ужин*', 'завтрак*', 'лаваш*', 'бургер*', 'пицц*', 'шаурм*', 'самс*', 'чайхан*', 'kafe*', 'cafe*', 'coffee*', 'kofe*', 'qahva*', 'evos', 'kfc', 'oqtepa*', 'bellissimo', 'maxway', 'safia',
    'safiya', 'choyxona*', 'restoran*', 'restaurant*', 'osh', 'lavash*', 'burger*', 'pizza*', 'shaurma*', 'tushlik*',
    'nonushta*', 'kechki', 'somsa*', 'lunch', 'dinner', 'breakfast', 'starbucks'],
  transport: ['такси*', 'яндекс*', 'метро*', 'автобус*', 'бензин*', 'метан*', 'пропан*', 'заправк*', 'проезд*', 'парковк*', 'поезд*', 'транспорт*', 'taksi*', 'taxi*', 'yandex*', 'uklon*', 'mytaxi*', 'metro*', 'avtobus*', 'bus', 'benzin*', 'metan*',
    'propan*', 'zapravka*', "yo'lkira*", "yo'l", 'transport*', 'parkovka*', 'parking*', 'uber', 'poyezd*', 'train*', 'avia*'],
  education: ['курс*', 'контракт*', 'универ*', 'репетитор*', 'учеб*', 'обучен*', 'урок*', 'kurs*', 'course*', 'kontrakt*', 'univer*', 'repetitor*', 'ielts*', 'toefl*', 'udemy*', 'coursera*',
    "o'qish*", 'oqish*', "ta'lim*", 'talim*', 'dars*', 'lesson*', 'tuition*'],
  books: ['книг*', 'тетрад*', 'ручк*', 'канцеляр*', 'распечат*', 'kitob*', 'book*', 'daftar*', 'ruchka*', 'qalam*', 'kanstovar*', 'kanselyar*', 'print*', 'nusxa*', 'pechat*', 'stationery*'],
  internet: ['интернет*', 'связь*', 'мобильн*', 'телефон*', 'internet*', 'uzmobile*', 'ucell*', 'beeline*', 'mobiuz*', 'humans*', 'uztelecom*', 'aloqa*', 'paynet*',
    'wifi*', 'trafik*', 'simkarta*'],
  shopping: ['одежд*', 'обув*', 'шопинг*', 'узум*', 'kiyim*', 'poyabzal*', 'zara', 'waikiki*', 'lcw', 'terra*', 'shop*', "do'kon*", 'dokon*', 'savdo*',
    'clothes*', 'shoes*', 'uzum*', 'wildberries*', 'ozon*', 'aliexpress*'],
  health: ['аптек*', 'лекарств*', 'врач*', 'клиник*', 'больниц*', 'анализ*', 'стоматолог*', 'фитнес*', 'спортзал*', 'apteka*', 'dori*', 'dorixona*', 'shifoxona*', 'doktor*', 'doctor*', 'klinika*', 'clinic*', 'pharmacy*',
    'stomatolog*', 'tish*', 'analiz*', 'fitnes*', 'gym'],
  home: ['коммунал*', 'свет', 'электр*', 'газ', 'вода', 'аренд*', 'квартир*', 'ремонт*', 'мебел*', 'kommunal*', 'svet*', 'elektr*', 'gaz', 'suv', 'ijara*', 'arenda*', 'kvartira*', 'rent', 'uy', "ta'mir*", 'remont*', 'mebel*'],
  fun: ['кино*', 'игр*', 'концерт*', 'театр*', 'подписк*', 'развлеч*', 'kino*', 'cinema*', "o'yin*", 'oyin*', 'game*', 'netflix*', 'spotify*', 'youtube*', 'obuna*', 'subscription*',
    'konsert*', 'concert*', 'teatr*', 'theatre*', 'playstation*', 'steam*', 'bowling*'],
};
const INCOME_KEYWORDS = {
  salary: ['зарплат*', 'аванс*', 'оклад*', 'oylik*', 'maosh*', 'zarplat*', 'salary*', 'avans*'],
  scholarship: ['стипенд*', 'грант*', 'stipend*', 'grant*', 'scholarship*'],
  freelance: ['фриланс*', 'заказ*', 'frilans*', 'freelance*', 'loyiha*', 'zakaz*', 'buyurtma*', 'upwork*', 'fiverr*'],
  family: ['родител*', 'мама', 'папа', 'семь*', 'ota', 'otam', 'ona', 'onam', 'oila*', 'uydan', 'dadam*', 'oyim*', 'akam*', 'opam*', 'family*', 'parents*'],
};

export function normalize(text) {
  return String(text).toLowerCase().replace(APOSTROPHES, "'").replace(/[  ]/g, ' ');
}

const wordMatch = (token, word) => (word.endsWith('*') ? token.startsWith(word.slice(0, -1)) : token === word);
const hasAny = (tokens, words) => tokens.some((tk) => words.some((w) => wordMatch(tk, w)));

function bestCategory(tokens, table) {
  let best = null;
  let bestScore = 0;
  for (const [key, words] of Object.entries(table)) {
    const score = tokens.filter((tk) => words.some((w) => wordMatch(tk, w))).length;
    if (score > bestScore) { best = key; bestScore = score; }
  }
  return best;
}

const blank = (m) => ' '.repeat(m.length);

/** @returns {{amount:number,type:string,category_key:string,category_id:?string,note:string}|null} */
export function parseEntry(text, custom = []) {
  if (!text || !String(text).trim()) return null;
  let original = String(text).replace(/[  ]/g, ' ');
  let norm = normalize(text);
  if (norm.length !== original.length) original = norm;
  for (const rx of NOISE) {
    original = original.replace(rx, blank);
    norm = norm.replace(rx, blank);
  }

  const candidates = [];
  NUM_RE.lastIndex = 0;
  let m;
  while ((m = NUM_RE.exec(norm)) !== null) {
    const [, prefix, sign, intPart, decPart, , mult] = m;
    let value = Number(intPart.replace(/[ ,.]/g, ''));
    if (decPart) value += Number(`0.${decPart}`);
    if (mult) value *= MULT[mult];
    const start = m.index + prefix.length;
    let end = m.index + m[0].length;
    const cur = CURRENCY_RE.exec(norm.slice(end));
    if (cur) end += cur[0].length;
    if (value >= 1) candidates.push({ value: Math.round(value), sign, start, end, preferred: !!(mult || cur) });
    if (m[0].length === 0) NUM_RE.lastIndex += 1;
  }
  if (!candidates.length) return null;
  const preferred = candidates.filter((c) => c.preferred);
  const pool = preferred.length ? preferred : candidates;
  const chosen = pool.reduce((a, b) => (b.value > a.value ? b : a));

  const restNorm = `${norm.slice(0, chosen.start)} ${norm.slice(chosen.end)}`;
  const tokens = restNorm.match(TOKEN_RE) || [];

  let type;
  if (chosen.sign === '+') type = 'income';
  else if (chosen.sign === '-') type = 'expense';
  else if (hasAny(tokens, INCOME_WORDS) && !hasAny(tokens, EXPENSE_WORDS)) type = 'income';
  else type = 'expense';

  let categoryId = null;
  for (const cat of custom || []) {
    if (cat.type !== type) continue;
    const name = normalize(cat.name || '').trim();
    if (name.length >= 3 && (tokens.includes(name) || (name.length >= 4 && tokens.some((tk) => tk.startsWith(name))))) {
      categoryId = cat.id;
      break;
    }
  }
  const table = type === 'income' ? INCOME_KEYWORDS : EXPENSE_KEYWORDS;
  const key = bestCategory(tokens, table) || (type === 'income' ? 'other_income' : 'other_expense');

  const rest = `${original.slice(0, chosen.start)} ${original.slice(chosen.end)}`;
  const words = [];
  for (const word of rest.split(/\s+/)) {
    const clean = word.replace(/[^\p{L}\p{N}_'&/.-]/gu, '').replace(/^[.\-/]+|[.\-/]+$/g, '');
    if (clean && !STOP.has(normalize(clean))) words.push(clean);
  }
  let note = words.join(' ').trim().slice(0, 200);
  if (note) note = note[0].toUpperCase() + note.slice(1);
  return { amount: chosen.value, type, category_key: key, category_id: categoryId, note };
}
