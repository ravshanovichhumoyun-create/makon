import uz from '../locales/uz.js';
import en from '../locales/en.js';
import ru from '../locales/ru.js';
import { diffDays, iso, parse, today } from './dates.js';

const DICTS = { uz, en, ru };
export const LANGS = ['uz', 'ru', 'en'];
let lang = 'uz';

export function setLang(l) {
  lang = DICTS[l] ? l : 'uz';
  document.documentElement.lang = lang;
}
export const getLang = () => lang;

/** t('finance.title') or t('n.books', { n: 3 }). Values may be strings with {var} or functions. */
export function t(key, params = {}) {
  let v = DICTS[lang][key];
  if (v === undefined && lang === 'ru') v = DICTS.en[key];
  if (v === undefined) v = DICTS.uz[key];
  if (v === undefined) return key;
  if (typeof v === 'function') return v(params);
  if (typeof v !== 'string') return v;
  return v.replace(/\{(\w+)\}/g, (_, k) => (params[k] !== undefined ? params[k] : ''));
}

// ------------------------------------------------------------------ numbers & money

const NBSP = ' ';
const CURRENCY = { uz: 'soʻm', ru: 'сум', en: 'UZS' };

export function num(n) {
  const v = Math.round(Number(n) || 0);
  const s = Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, lang === 'en' ? ',' : NBSP);
  return (v < 0 ? '−' : '') + s;
}

export function money(n, { sign = false } = {}) {
  const v = Math.round(Number(n) || 0);
  const prefix = sign && v > 0 ? '+' : '';
  return `${prefix}${num(v)}${NBSP}${CURRENCY[lang]}`;
}

export const currencyLabel = () => CURRENCY[lang];

const COMPACT = {
  uz: [' mlrd', ' mln', ' ming'],
  ru: [' млрд', ' млн', ' тыс'],
  en: ['B', 'M', 'K'],
};

/** Compact: 1,2 mln · 850 ming (uz) / 1,2 млн (ru) / 1.2M · 850K (en) */
export function compact(n) {
  const v = Math.abs(Number(n) || 0);
  const s = (Number(n) || 0) < 0 ? '−' : '';
  const fmt = (x) => {
    const r = x >= 100 ? Math.round(x) : Math.round(x * 10) / 10;
    return lang === 'en' ? String(r) : String(r).replace('.', ',');
  };
  const [b, m, k] = COMPACT[lang];
  if (v >= 1e9) return s + fmt(v / 1e9) + b;
  if (v >= 1e6) return s + fmt(v / 1e6) + m;
  if (v >= 1e3) return s + fmt(v / 1e3) + k;
  return s + String(Math.round(v));
}

export function percent(x) {
  return `${Math.round(x)}%`;
}

// ------------------------------------------------------------------ dates

export const monthName = (m) => t('months')[m - 1];
export const monthShort = (m) => t('monthsShort')[m - 1];
export const weekdayName = (wd) => t('weekdays')[wd - 1];
export const weekdayShort = (wd) => t('weekdaysShort')[wd - 1];
const monthGen = (m) => DICTS.ru.monthsGen[m - 1];

/** '2026-11-20' → '20-noyabr' / '20 ноября' / '20 Nov' (year added when not current) */
export function dateShort(s, { year } = {}) {
  if (!s) return '';
  const d = parse(s);
  const withYear = year === true || (year !== false && d.getFullYear() !== new Date().getFullYear());
  if (lang === 'en') return `${d.getDate()} ${monthShort(d.getMonth() + 1)}${withYear ? ' ' + d.getFullYear() : ''}`;
  if (lang === 'ru') return `${d.getDate()} ${monthGen(d.getMonth() + 1)}${withYear ? ' ' + d.getFullYear() : ''}`;
  return `${d.getDate()}-${monthName(d.getMonth() + 1).toLowerCase()}${withYear ? ', ' + d.getFullYear() : ''}`;
}

export function dateLong(s) {
  const d = parse(s);
  const wd = d.getDay() === 0 ? 7 : d.getDay();
  if (lang === 'en') return `${weekdayName(wd)}, ${d.getDate()} ${monthName(d.getMonth() + 1)}`;
  if (lang === 'ru') return `${weekdayName(wd)}, ${d.getDate()} ${monthGen(d.getMonth() + 1)}`;
  return `${d.getDate()}-${monthName(d.getMonth() + 1).toLowerCase()}, ${weekdayName(wd).toLowerCase()}`;
}

export function monthTitle(year, month) {
  return `${monthName(month)} ${year}`;
}

/** Relative day label: Bugun / Ertaga / Kecha / 3 kundan keyin / 2 kun oʻtdi */
export function relDay(s) {
  const d = diffDays(today(), s);
  if (d === 0) return t('rel.today');
  if (d === 1) return t('rel.tomorrow');
  if (d === -1) return t('rel.yesterday');
  if (d > 1) return t('rel.inDays', { n: d });
  return t('rel.daysAgo', { n: -d });
}

export function timeAgo(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return t('rel.justNow');
  if (s < 3600) return t('rel.minAgo', { n: Math.floor(s / 60) });
  if (s < 86400) return t('rel.hoursAgo', { n: Math.floor(s / 3600) });
  return dateShort(iso(new Date(ms)));
}
