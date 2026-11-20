// Tiny IndexedDB wrapper: a key-value store for app state and a blob store for PDFs.
const DB_NAME = 'makon';
const VERSION = 1;
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('no-idb'));
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('idb-blocked'));
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function run(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('idb-abort'));
  }));
}

export const kvGet = (key) => run('kv', 'readonly', (s) => s.get(key)).catch(() => undefined);
export const kvSet = (key, value) => run('kv', 'readwrite', (s) => s.put(value, key));
export const kvDel = (key) => run('kv', 'readwrite', (s) => s.delete(key)).catch(() => undefined);

export const fileGet = (key) => run('files', 'readonly', (s) => s.get(key)).catch(() => undefined);
export const fileSet = (key, blob) => run('files', 'readwrite', (s) => s.put(blob, key));
export const fileDel = (key) => run('files', 'readwrite', (s) => s.delete(key)).catch(() => undefined);
export const fileKeys = () => run('files', 'readonly', (s) => s.getAllKeys()).catch(() => []);

export function clearAll() {
  return Promise.all([
    run('kv', 'readwrite', (s) => s.clear()).catch(() => undefined),
    run('files', 'readwrite', (s) => s.clear()).catch(() => undefined),
  ]);
}

export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) await navigator.storage.persist();
  } catch (_) { /* optional */ }
}
