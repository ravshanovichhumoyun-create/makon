// App shell: sidebar (desktop), tab bar (phone), router and live updates.
import { $, html, on, setHTML } from './core/dom.js';
import { t, timeAgo } from './core/i18n.js';
import { icon } from './core/icons.js';
import * as store from './core/store.js';
import { getStatus, onStatus, syncNow } from './core/sync.js';
import { hydrateImages } from './core/images.js';
import { closeAllModals, hasOpenModal } from './core/ui.js';
import challenges from './pages/challenges.js';
import finance from './pages/finance.js';
import library from './pages/library.js';
import more from './pages/more.js';
import notes from './pages/notes.js';
import projects from './pages/projects.js';
import settings from './pages/settings.js';
import study from './pages/study.js';
import today from './pages/today.js';
import { avatarHtml } from './pages/hero.js';

const PAGES = { today, finance, study, library, challenges, projects, notes, settings, more };
const SIDE = [
  ['today', 'today'], ['finance', 'wallet'], ['study', 'study'], ['library', 'book'], ['challenges', 'flame'], ['projects', 'layers'], ['notes', 'note'],
];
const TABS = [['today', 'today'], ['finance', 'wallet'], ['study', 'study'], ['library', 'book'], ['more', 'grid']];
const MORE_PAGES = new Set(['challenges', 'projects', 'notes', 'settings', 'more']);

let host = null;
let current = null;
let currentName = '';
let unsub = null;
let offStatus = null;

function shell() {
  const user = store.getUser() || {};
  return html`
    <div class="shell">
      <aside class="sidebar" aria-label="${t('nav.main')}">
        <a class="brand" href="#/today"><span class="logo">✦</span><div><b>Makon</b><small>${t('brand.tagline')}</small></div></a>
        <nav class="side-nav">
          ${SIDE.map(([id, ic]) => html`<a class="nav-item" href="#/${id}" data-nav="${id}">${icon(ic, 20)}<span>${t(`nav.${id}`)}</span></a>`)}
        </nav>
        <div class="side-foot">
          <button type="button" class="sync-pill" data-sync>${icon('cloud', 16)}<span data-sync-label></span></button>
          <a class="nav-item" href="#/settings" data-nav="settings" data-side-user>${sideUser(user)}</a>
        </div>
      </aside>
      <main class="main" id="main" tabindex="-1">
        <div class="offline-bar" data-offline hidden>${icon('wifiOff', 16)}<span>${t('sync.offlineBar')}</span></div>
        <div class="page-host" data-page-host></div>
      </main>
      <nav class="tabbar" aria-label="${t('nav.main')}">
        ${TABS.map(([id, ic]) => html`<a class="tab-item" href="#/${id}" data-tab="${id}">${icon(ic, 22)}<span>${t(`nav.${id}`)}</span></a>`)}
      </nav>
      <button type="button" class="fab" data-fab aria-label="${t('common.add')}" hidden>${icon('plus', 26)}</button>
    </div>`;
}

function sideUser(user) {
  return html`${avatarHtml(user, 'avatar-sm')}<span class="side-user">${user.name || ''}</span>${icon('settings', 18)}`;
}

function paintSideUser() {
  const el = $('[data-side-user]', host);
  if (!el) return;
  setHTML(el, sideUser(store.getUser() || {}));
  hydrateImages(el);
}

function paintSync(status) {
  const label = $('[data-sync-label]', host);
  const pill = $('[data-sync]', host);
  if (!label || !pill) return;
  const pending = store.pendingCount();
  let text;
  if (status === 'offline') text = pending ? t('sync.offlinePending', { n: pending }) : t('sync.offline');
  else if (status === 'syncing') text = t('sync.syncing');
  else if (status === 'error') text = t('sync.error');
  else text = store.getState().lastSync ? t('sync.ok', { when: timeAgo(store.getState().lastSync) }) : t('sync.syncing');
  label.textContent = text;
  pill.dataset.state = status;
  const bar = $('[data-offline]', host);
  if (bar) bar.hidden = status !== 'offline';
}

function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const name = PAGES[parts[0]] ? parts[0] : 'today';
  const params = parts.slice(1);
  if (hasOpenModal()) closeAllModals();
  if (current && current.unmount) current.unmount();
  const pageHost = $('[data-page-host]', host);
  const el = document.createElement('div');
  el.className = `page page-${name}`;
  pageHost.replaceChildren(el);
  current = PAGES[name];
  const sameSection = currentName === name;
  currentName = name;
  current.mount(el, params);
  document.title = `${current.title()} · Makon`;
  host.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === name));
  host.querySelectorAll('[data-tab]').forEach((a) => a.classList.toggle('active', a.dataset.tab === name || (a.dataset.tab === 'more' && MORE_PAGES.has(name))));
  $('[data-fab]', host).hidden = !current.fab;
  if (!sameSection) window.scrollTo(0, 0);
}

export function startApp(root) {
  host = root;
  setHTML(host, shell());
  hydrateImages(host);
  if (unsub) unsub();
  unsub = store.subscribe((kinds) => {
    if (kinds.has('sync')) paintSync(getStatus());
    if (kinds.has('user')) paintSideUser();
    if (!current || !current.update) return;
    if (current.deps.some((d) => kinds.has(d))) {
      try { current.update(kinds); } catch (e) { console.error(e); }
    }
  });
  if (offStatus) offStatus();
  offStatus = onStatus(paintSync);
  on(host, 'click', '[data-fab]', () => { if (current && current.fab) current.fab(); });
  on(host, 'click', '[data-sync]', () => syncNow());
  window.removeEventListener('hashchange', route);
  window.addEventListener('hashchange', route);
  route();
  paintSync(getStatus());
  setInterval(() => paintSync(getStatus()), 30000);
}

/** Re-render everything (language change). */
export function rerender() {
  if (!host) return;
  const name = location.hash;
  setHTML(host, shell());
  hydrateImages(host);
  currentName = '';
  current = null;
  if (location.hash !== name) location.hash = name;
  route();
  paintSync(getStatus());
}
