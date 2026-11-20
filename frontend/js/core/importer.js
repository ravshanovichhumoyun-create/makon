// Import data from a Makon backup or from the previous single-file app ("shaxsiy hub" JSON).
import { uuid } from './dom.js';
import * as D from './dates.js';
import * as store from './store.js';

const OLD_CATEGORY_KEYS = {
  'Oziq-ovqat va Ovqatlanish': 'food',
  "Transport va Yo'l kira": 'transport',
  "O'qish va Kurslar": 'education',
  'Kitob va Kanselyariya': 'books',
  'Internet va Aloqa': 'internet',
  'Kiyim va Shaxsiy xarid': 'shopping',
  'Dam olish va Kafe': 'cafe',
  'Boshqa xarajatlar': 'other_expense',
  'Oylik / Stipendiya': 'salary',
  'Loyiha / Freelance': 'freelance',
  "Oilaviy qo'llab-quvvatlash": 'family',
  "Qo'shimcha daromad": 'other_income',
};
const OLD_DAYS = { Dushanba: 1, Seshanba: 2, Chorshanba: 3, Payshanba: 4, Juma: 5, Shanba: 6, Yakshanba: 7 };
const OLD_TT_KIND = { Dars: 'lecture', Vazifa: 'assignment', Loyiha: 'project', Shaxsiy: 'personal' };
const OLD_STATUS = { Jarayonda: 'active', Rejada: 'planned', Tugallangan: 'done' };
const OLD_BOOK_CAT = {
  'Dasturlash & IT': 'it', 'Ilmiy & Darslik': 'science', 'Biznes & Moliya': 'business',
  'Badiiy adabiyot': 'fiction', 'Shaxsiy rivojlanish': 'self',
};
// Sample records the old app created for every new user.
const OLD_SAMPLE_IDS = new Set(['t1', 't2', 't3', 't4', 't5', 'b1', 'b2', 'c1', 'c2', 'tt1', 'tt2', 'tt3', 'tt4', 'p1', 'n1', 'n2']);

const str = (v, max) => String(v ?? '').trim().slice(0, max);
const int = (v, max = 1e13) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
const date = (v) => (D.isDate(v) ? v : null);
const time = (v) => (D.isTime(v) ? v : null);

export function detect(json) {
  if (json && json.app === 'makon' && json.data) return 'makon';
  if (json && Array.isArray(json.transactions) && ('savingsGoal' in json || Array.isArray(json.books))) return 'legacy';
  return null;
}

function categoryIdByKey(key, type) {
  const cat = store.all('categories').find((c) => c.key === key);
  return (cat || store.fallbackCategory(type) || {}).id || '';
}

/** Build the list of records to insert. Returns { records: {kind: [...]}, counts, samples } */
export function planLegacy(json, { includeSamples = false } = {}) {
  const keep = (r) => includeSamples || !OLD_SAMPLE_IDS.has(r && r.id);
  const rec = { transactions: [], books: [], courses: [], tasks: [], timetable: [], projects: [], notes: [], goals: [] };
  let samples = 0;
  const count = (arr) => (arr || []).filter((r) => { const k = keep(r); if (!k) samples += 1; return k; });

  for (const tx of count(json.transactions)) {
    const type = tx.type === 'income' ? 'income' : 'expense';
    const amount = int(tx.amount);
    if (!amount) continue;
    const key = OLD_CATEGORY_KEYS[tx.category] || (type === 'income' ? 'other_income' : 'other_expense');
    rec.transactions.push({
      type, amount, category_id: categoryIdByKey(key, type), date: date(tx.date) || D.today(),
      note: str(String(tx.note || '').replace(/\s*\((Telegram Bot Avto|[^)]*• (SMS\/Chek|Telegram Bot|Avto-Karta))\)\s*$/, ''), 500),
      source: 'import',
    });
  }
  for (const b of count(json.books)) {
    const total = int(b.totalPages, 100000);
    rec.books.push({
      title: str(b.title, 200) || '—', author: str(b.author, 120), category: OLD_BOOK_CAT[b.category] || 'other',
      total_pages: total, read_pages: Math.min(int(b.readPages, 100000), total || 100000), description: str(b.desc, 1000),
      file_id: null, file_name: '', file_size: null,
    });
  }
  for (const c of count(json.courses)) {
    const id = uuid();
    rec.courses.push({ id, name: str(c.name, 120) || '—', teacher: str(c.teacher === 'Kiritilmagan' ? '' : c.teacher, 120),
      room: str(c.room, 120), description: str(c.desc, 1000), color: str(c.color, 16) || 'indigo', notes: str(c.notes, 100000) });
    for (const task of c.tasks || []) {
      rec.tasks.push({ course_id: id, title: str(task.title, 300) || '—', kind: 'homework', due_date: date(task.due), due_time: null, done: !!task.done });
    }
  }
  for (const it of count(json.timetable)) {
    const start = time(it.start) || '09:00';
    let end = time(it.end) || '10:00';
    if (end <= start) end = start === '23:59' ? '23:59' : `${String(Math.min(23, Number(start.slice(0, 2)) + 1)).padStart(2, '0')}${start.slice(2)}`;
    if (end <= start) continue;
    rec.timetable.push({ title: str(it.title, 120) || '—', weekday: OLD_DAYS[it.day] || 1, start, end,
      kind: OLD_TT_KIND[it.type] || 'lecture', location: str(it.location === 'Belgilanmagan' ? '' : it.location, 120), course_id: null });
  }
  for (const p of count(json.projects)) {
    const link = /^https?:\/\//i.test(p.link || '') ? str(p.link, 500) : '';
    rec.projects.push({
      title: str(p.title, 200) || '—', status: OLD_STATUS[p.status] || 'planned', deadline: date(p.deadline),
      tags: String(p.tags || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20), link,
      description: str(p.desc, 20000),
      subtasks: (p.subtasks || []).map((s) => ({ id: uuid(), text: str(s.text, 300) || '—', done: !!s.done })),
    });
  }
  for (const n of count(json.notes)) {
    rec.notes.push({ title: str(n.title, 200), content: str(n.content, 100000), color: str(n.color, 16) || 'amber', pinned: !!n.pinned, tag: '' });
  }
  const goal = json.savingsGoal;
  if (goal && goal.title && int(goal.target) > 0 && !(goal.title === "Yangi Noutbuk va Kurslar jamg'armasi" && !includeSamples)) {
    rec.goals.push({ title: str(goal.title, 120), target: int(goal.target), saved: 0, deadline: null, icon: '🎯', color: '' });
  }
  return { records: rec, samples };
}

export function planMakon(json) {
  const sameUser = json.user_id && json.user_id === store.getState().userId;
  const idMap = new Map();
  const mapId = (id) => {
    if (!id) return id;
    if (sameUser) return id;
    if (!idMap.has(id)) idMap.set(id, uuid());
    return idMap.get(id);
  };
  const records = {};
  // built-in categories map by key onto this account's own ids
  const catIds = new Map();
  for (const c of json.data.categories || []) {
    if (c.key) catIds.set(c.id, categoryIdByKey(c.key, c.type));
  }
  for (const kind of store.KINDS) {
    const list = json.data[kind] || [];
    records[kind] = [];
    for (const r of list) {
      if (kind === 'categories' && r.key) continue; // keep this account's built-ins
      const out = { ...r, id: mapId(r.id) };
      if (kind === 'transactions') out.category_id = catIds.get(r.category_id) || mapId(r.category_id);
      if ((kind === 'tasks' || kind === 'timetable') && r.course_id) out.course_id = mapId(r.course_id);
      delete out.deleted; delete out.updated_at; delete out.rev;
      records[kind].push(out);
    }
  }
  return { records, samples: 0 };
}

export function countRecords(records) {
  return Object.values(records).reduce((s, list) => s + list.length, 0);
}

export function applyPlan(records) {
  for (const [kind, list] of Object.entries(records)) {
    if (list.length) store.putMany(kind, list);
  }
}

export function backupJson() {
  const st = store.getState();
  const data = {};
  store.KINDS.forEach((k) => { data[k] = store.all(k); });
  return { app: 'makon', version: 1, exported_at: new Date().toISOString(), user_id: st.userId, data };
}
