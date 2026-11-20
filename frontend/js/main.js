// Bootstrap: theme, language, service worker, session, app lock.
import { api, getToken, setToken, setUnauthorizedHandler } from './core/api.js';
import { appctl, getPrefs, setPrefs } from './core/appctl.js';
import { $, isNative } from './core/dom.js';
import { clearAll, fileKeys, requestPersistence } from './core/idb.js';
import { setLang, t } from './core/i18n.js';
import { disableLock, lockConfig, showLock, watchVisibility } from './core/lock.js';
import * as store from './core/store.js';
import { startSync, stopSync, syncNow } from './core/sync.js';
import { initTooltips, toast } from './core/ui.js';
import { rerender, startApp } from './app.js';
import { renderAuth } from './pages/auth.js';
import { setLibraryConfig } from './pages/library.js';

const host = $('#app');
const darkQuery = matchMedia('(prefers-color-scheme: dark)');

function applyTheme() {
  const pref = getPrefs().theme || 'auto';
  const resolved = pref === 'auto' ? (darkQuery.matches ? 'dark' : 'light') : pref;
  const rootEl = document.documentElement;
  const changed = rootEl.dataset.resolvedTheme && rootEl.dataset.resolvedTheme !== resolved;
  rootEl.dataset.theme = pref;
  rootEl.dataset.resolvedTheme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = resolved === 'dark' ? '#0f1322' : '#f4f2f8';
  if (changed) store.KINDS.forEach((k) => store.emit(k)); // charts pick colours per theme
}

function tokenUserId(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.sub || null;
  } catch (_) {
    return null;
  }
}

async function logout({ skipSync = false } = {}) {
  if (!skipSync && store.pendingCount() > 0 && navigator.onLine) {
    try { await syncNow(); } catch (_) { /* best effort */ }
  }
  stopSync();
  await store.reset();
  await clearAll();
  disableLock();
  try { ['makon.imgq', 'makon.weather'].forEach((k) => localStorage.removeItem(k)); } catch (_) { /* ignore */ }
  setToken('');
  location.hash = '';
  location.reload();
}

async function enterApp(userId) {
  await store.load(userId);
  if (lockConfig(userId)) await showLock(userId, { onForgot: () => logout({ skipSync: true }) });
  startApp(host);
  startSync();
  watchVisibility(userId, () => showLock(userId, { onForgot: () => logout({ skipSync: true }) }));
  fileKeys().then((keys) => store.setLocalFiles(keys.filter((k) => String(k).startsWith('book:'))));
  requestPersistence();
  api.get('/api/auth/me').then((me) => {
    store.setUser(me);
    const lang = getPrefs().lang || me.lang;
    if (lang !== document.documentElement.lang) { setLang(lang); rerender(); }
  }).catch(() => { /* offline: cached profile is used */ });
}

function showAuth() {
  renderAuth(host, async ({ token, user }) => {
    setToken(token);
    setPrefs({ lang: user.lang });
    setLang(user.lang);
    await store.load(user.id);
    store.setUser(user);
    await store.flush();
    enterApp(user.id);
  });
}

let updateRequested = false;

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.register('/sw.js').then((reg) => {
    const offer = (worker) => {
      toast(t('app.update'), {
        duration: 60000,
        action: { label: t('app.reload'), fn: async () => { updateRequested = true; await store.flush(); worker.postMessage('skipWaiting'); } },
      });
    };
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker);
      });
    });
    setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
  }).catch((e) => console.warn('sw', e));
  // Reload only when the user asked for the update. The very first install also fires
  // controllerchange (clients.claim) and must never reload the page mid-task.
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!updateRequested || reloading) return;
    reloading = true;
    location.reload();
  });
}

function boot() {
  applyTheme();
  darkQuery.addEventListener?.('change', applyTheme);
  const prefs = getPrefs();
  setLang(prefs.lang || 'uz');
  appctl.applyTheme = applyTheme;
  appctl.rerender = rerender;
  appctl.logout = logout;
  initTooltips();
  if (isNative()) {
    // the app ships its own files: no service worker; links to other sites open outside the app
    document.documentElement.classList.add('is-native');
    document.addEventListener('click', (e) => {
      const a = e.target.closest && e.target.closest('a[target="_blank"]');
      if (!a || !/^https?:/i.test(a.href)) return;
      e.preventDefault();
      window.location.href = a.href;
    });
  } else {
    registerServiceWorker();
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    appctl.installPrompt = e;
    store.emit('user');
  });
  api.get('/api/config', { timeout: 60000 }).then((cfg) => {
    appctl.config = cfg;
    setLibraryConfig(cfg);
    store.emit('user');
  }).catch(() => { /* offline */ });

  // Session expired / password changed elsewhere: sign in again, but keep unsent local changes
  // (they stay in IndexedDB under this user and are pushed after the next login).
  let expired = false;
  setUnauthorizedHandler(async () => {
    if (expired) return;
    expired = true;
    stopSync();
    toast(t('err.session'), { tone: 'error' });
    await store.flush();
    setToken('');
    setTimeout(() => location.reload(), 1500);
  });

  const token = getToken();
  const userId = token ? tokenUserId(token) : null;
  if (userId) enterApp(userId);
  else { setToken(''); showAuth(); }
  document.documentElement.classList.remove('booting');
}

boot();
