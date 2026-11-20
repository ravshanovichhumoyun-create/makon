// Background sync: push the outbox, pull everything newer than the cursor.
import { api } from './api.js';
import { flushImages } from './images.js';
import * as store from './store.js';

let syncing = false;
let again = false;
let status = navigator.onLine ? 'idle' : 'offline';
let retryTimer = null;
let retryDelay = 5000;
let interval = null;
const statusListeners = new Set();

export const getStatus = () => status;
export function onStatus(fn) {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

function setStatus(s) {
  if (s === status) return;
  status = s;
  statusListeners.forEach((fn) => fn(s));
}

export async function syncNow() {
  if (!store.getState().userId) return;
  if (syncing) { again = true; return; }
  if (!navigator.onLine) { setStatus('offline'); return; }
  syncing = true;
  setStatus('syncing');
  clearTimeout(retryTimer);
  try {
    let rounds = 0;
    do {
      const sent = store.takeOutbox(500);
      const res = await api.post('/api/sync', { cursor: store.getState().cursor, changes: sent }, { timeout: 60000 });
      store.ackOutbox(sent, res.accepted || [], res.rejected || []);
      if (res.rejected && res.rejected.length) console.warn('sync rejected', res.rejected);
      store.applyRemote(res.changes || []);
      store.setCursor(res.cursor);
      rounds += 1;
      if (sent.length < 500) break;
    } while (rounds < 20 && store.pendingCount() > 0);
    retryDelay = 5000;
    setStatus('ok');
    flushImages();
  } catch (e) {
    setStatus(navigator.onLine ? 'error' : 'offline');
    if (e.status !== 401) {
      retryTimer = setTimeout(syncNow, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 120000);
    }
  } finally {
    syncing = false;
    if (again) { again = false; setTimeout(syncNow, 50); }
  }
}

let debounceTimer = null;
export function scheduleSync(ms = 1200) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(syncNow, ms);
}

let listening = false;

export function startSync() {
  store.setLocalChangeHook(() => scheduleSync());
  if (!listening) {
    listening = true;
    window.addEventListener('online', () => { setStatus('idle'); syncNow(); });
    window.addEventListener('offline', () => setStatus('offline'));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') syncNow();
      else if (store.pendingCount() > 0) syncNow();
    });
    window.addEventListener('focus', () => scheduleSync(300));
  }
  clearInterval(interval);
  interval = setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 60000);
  syncNow();
}

export function stopSync() {
  clearInterval(interval);
  clearTimeout(retryTimer);
  clearTimeout(debounceTimer);
  store.setLocalChangeHook(() => {});
}
