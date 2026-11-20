// Local-time date helpers. Dates are 'YYYY-MM-DD' strings in the device's time zone
// (never toISOString(), which is UTC and shifts the day after midnight in Uzbekistan).

const pad = (n) => String(n).padStart(2, '0');

export function iso(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parse(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export const today = () => iso(new Date());

export function addDays(s, n) {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return iso(d);
}

export function addMonths(s, n) {
  const d = parse(s);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, daysInMonth(d.getFullYear(), d.getMonth() + 1)));
  return iso(d);
}

export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

/** ISO weekday: 1 = Monday ... 7 = Sunday */
export function weekday(s) {
  const wd = parse(s).getDay();
  return wd === 0 ? 7 : wd;
}

export const startOfWeek = (s) => addDays(s, 1 - weekday(s));
export const startOfMonth = (s) => `${s.slice(0, 7)}-01`;

export function endOfMonth(s) {
  const [y, m] = s.split('-').map(Number);
  return `${s.slice(0, 7)}-${pad(daysInMonth(y, m))}`;
}

export const startOfYear = (s) => `${s.slice(0, 4)}-01-01`;
export const endOfYear = (s) => `${s.slice(0, 4)}-12-31`;

export function diffDays(a, b) {
  return Math.round((parse(b) - parse(a)) / 86400000);
}

export function eachDay(from, to) {
  const out = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

export function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

export function toMinutes(hhmm) {
  const [h, m] = String(hhmm || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
export const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ''));
