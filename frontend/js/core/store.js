// Local-first data store. Every change is applied locally at once, queued in the outbox
// and pushed to the server by sync.js. Everything is persisted in IndexedDB.
import { uuid } from './dom.js';
import { kvDel, kvGet, kvSet } from './idb.js';

export const FIELDS = {
  categories: ['type', 'key', 'name', 'icon', 'color', 'monthly_limit', 'sort'],
  transactions: ['type', 'amount', 'category_id', 'date', 'note', 'source'],
  goals: ['title', 'target', 'saved', 'deadline', 'icon', 'color'],
  books: ['title', 'author', 'category', 'total_pages', 'read_pages', 'description', 'file_id', 'file_name', 'file_size', 'cover_id', 'finished_at'],
  courses: ['name', 'teacher', 'room', 'description', 'color', 'notes'],
  tasks: ['course_id', 'title', 'kind', 'due_date', 'due_time', 'done', 'done_at'],
  timetable: ['title', 'weekday', 'start', 'end', 'kind', 'location', 'course_id'],
  projects: ['title', 'status', 'deadline', 'tags', 'link', 'description', 'subtasks'],
  notes: ['title', 'content', 'color', 'pinned', 'tag'],
  plans: ['title', 'date', 'time', 'done', 'done_at'],
  challenges: ['title', 'icon', 'color', 'days', 'start_date', 'goal', 'checkins', 'stopped'],
};
export const KINDS = Object.keys(FIELDS);

const state = {
  userId: null,
  user: null,
  cursor: 0,
  data: {},
  outbox: new Map(),
  lastSync: 0,
  localFiles: new Set(),
};
KINDS.forEach((k) => { state.data[k] = new Map(); });

const listeners = new Set();
let pendingKinds = new Set();
let emitQueued = false;
let localChangeHook = () => {};

export const setLocalChangeHook = (fn) => { localChangeHook = fn; };

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit(kind) {
  pendingKinds.add(kind);
  if (emitQueued) return;
  emitQueued = true;
  queueMicrotask(() => {
    const kinds = pendingKinds;
    pendingKinds = new Set();
    emitQueued = false;
    listeners.forEach((fn) => { try { fn(kinds); } catch (e) { console.error(e); } });
  });
}

// ------------------------------------------------------------------ persistence

const stateKey = () => `state:${state.userId}`;
let saveTimer = null;

function persistNow() {
  if (!state.userId) return Promise.resolve();
  const snapshot = {
    v: 1,
    cursor: state.cursor,
    user: state.user,
    lastSync: state.lastSync,
    outbox: Array.from(state.outbox.values()),
    data: Object.fromEntries(KINDS.map((k) => [k, Array.from(state.data[k].values())])),
  };
  return kvSet(stateKey(), snapshot).catch((e) => console.warn('persist failed', e));
}

export function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistNow, 250);
}

export function flush() {
  clearTimeout(saveTimer);
  return persistNow();
}

window.addEventListener('pagehide', () => { if (state.userId) persistNow(); });

export async function load(userId) {
  state.userId = userId;
  KINDS.forEach((k) => state.data[k].clear());
  state.outbox.clear();
  state.cursor = 0;
  const snap = await kvGet(stateKey());
  if (snap && snap.v === 1) {
    state.cursor = snap.cursor || 0;
    state.user = snap.user || null;
    state.lastSync = snap.lastSync || 0;
    (snap.outbox || []).forEach((c) => state.outbox.set(c.id, c));
    KINDS.forEach((k) => (snap.data?.[k] || []).forEach((r) => state.data[k].set(r.id, r)));
  }
  KINDS.forEach(emit);
  return !!snap;
}

export async function reset() {
  const id = state.userId;
  state.userId = null;
  state.user = null;
  state.cursor = 0;
  state.lastSync = 0;
  state.outbox.clear();
  KINDS.forEach((k) => state.data[k].clear());
  if (id) await kvDel(`state:${id}`);
}

// ------------------------------------------------------------------ reads

export const getState = () => state;
export const getUser = () => state.user;

export function setUser(user) {
  state.user = user;
  persist();
  emit('user');
}

export function all(kind) {
  const out = [];
  state.data[kind].forEach((r) => { if (!r.deleted) out.push(r); });
  return out;
}

export function get(kind, id) {
  const r = id ? state.data[kind].get(id) : null;
  return r && !r.deleted ? r : null;
}

export const pendingCount = () => state.outbox.size;

// ------------------------------------------------------------------ writes

function pick(kind, record) {
  const data = {};
  FIELDS[kind].forEach((f) => { if (record[f] !== undefined) data[f] = record[f]; });
  return data;
}

function queue(kind, record) {
  state.outbox.set(record.id, {
    kind,
    id: record.id,
    created_at: record.created_at,
    updated_at: record.updated_at,
    deleted: !!record.deleted,
    data: record.deleted ? {} : pick(kind, record),
  });
}

function nextTs(prev) {
  const now = Date.now();
  return prev && prev.updated_at >= now ? prev.updated_at + 1 : now;
}

/** Create or update. Returns the stored record. */
export function put(kind, values, { silent = false } = {}) {
  const id = values.id || uuid();
  const prev = state.data[kind].get(id);
  const record = { ...(prev && !prev.deleted ? prev : {}), ...values, id, deleted: false };
  record.created_at = prev?.created_at || Date.now();
  record.updated_at = nextTs(prev);
  state.data[kind].set(id, record);
  queue(kind, record);
  persist();
  emit(kind);
  if (!silent) localChangeHook();
  return record;
}

export function putMany(kind, list) {
  const out = list.map((v) => put(kind, v, { silent: true }));
  localChangeHook();
  return out;
}

export function remove(kind, id) {
  const prev = state.data[kind].get(id);
  if (!prev || prev.deleted) return null;
  const record = { ...prev, deleted: true, updated_at: nextTs(prev) };
  state.data[kind].set(id, record);
  queue(kind, record);
  if (kind === 'courses') {
    all('tasks').filter((t) => t.course_id === id).forEach((t) => remove('tasks', t.id));
    all('timetable').filter((it) => it.course_id === id).forEach((it) => put('timetable', { id: it.id, course_id: null }, { silent: true }));
  }
  persist();
  emit(kind);
  localChangeHook();
  return prev;
}

/** Undo a deletion (used by the toast "Undo" action). */
export function restore(kind, record) {
  if (!record) return;
  put(kind, { ...record, deleted: false });
}

// ------------------------------------------------------------------ sync plumbing

/** Merge server changes. Local edits that are newer and still unsent win. */
export function applyRemote(changes) {
  const touched = new Set();
  for (const ch of changes) {
    if (!state.data[ch.kind]) continue;
    const pending = state.outbox.get(ch.id);
    if (pending && pending.updated_at > ch.updated_at) continue;
    if (pending) state.outbox.delete(ch.id);
    const record = ch.deleted
      ? { ...(state.data[ch.kind].get(ch.id) || {}), id: ch.id, deleted: true, updated_at: ch.updated_at }
      : { ...ch.data, id: ch.id, created_at: ch.created_at, updated_at: ch.updated_at, deleted: false };
    state.data[ch.kind].set(ch.id, record);
    touched.add(ch.kind);
  }
  touched.forEach(emit);
  if (touched.size) persist();
}

export function takeOutbox(limit = 500) {
  return Array.from(state.outbox.values()).slice(0, limit);
}

export function ackOutbox(sent, acceptedIds, rejected) {
  const byId = new Map(sent.map((c) => [c.id, c.updated_at]));
  const done = new Set([...acceptedIds, ...rejected.map((r) => r.id)]);
  done.forEach((id) => {
    const cur = state.outbox.get(id);
    if (cur && cur.updated_at === byId.get(id)) state.outbox.delete(id);
  });
  persist();
}

export function setCursor(cursor) {
  state.cursor = cursor;
  state.lastSync = Date.now();
  persist();
  emit('sync');
}

// ------------------------------------------------------------------ helpers used by pages

export function categoriesOf(type) {
  return all('categories').filter((c) => c.type === type).sort((a, b) => (a.sort || 0) - (b.sort || 0));
}

export function fallbackCategory(type) {
  const key = type === 'income' ? 'other_income' : 'other_expense';
  return all('categories').find((c) => c.key === key) || null;
}

export function setLocalFiles(keys) {
  state.localFiles = new Set(keys);
  emit('files');
}

export function markLocalFile(key, present) {
  if (present) state.localFiles.add(key);
  else state.localFiles.delete(key);
  emit('files');
}

export const hasLocalFile = (key) => state.localFiles.has(key);
