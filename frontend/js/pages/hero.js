// Home hero: living scene (or the user's own background), big clock, weather, 3D balance card
// and pinned notes — all on one picture.
import { api } from '../core/api.js';
import { getPrefs, setPrefs } from '../core/appctl.js';
import { $, html, on, raw, setHTML } from '../core/dom.js';
import * as D from '../core/dates.js';
import * as F from '../core/finance.js';
import { dateLong, money, monthTitle, t } from '../core/i18n.js';
import { icon } from '../core/icons.js';
import { cachedUrl, forgetImage, hydrateImages, resizeImage, saveImage } from '../core/images.js';
import * as store from '../core/store.js';
import { errorText, openModal, toast } from '../core/ui.js';
import { cachedWeather, describe, loadWeather, openCityPicker, place } from '../core/weather.js';

export const BG_PRESETS = ['aurora', 'sunset', 'ocean', 'forest', 'night', 'peach'];

export function timeOfDay(h = new Date().getHours()) {
  if (h >= 5 && h < 11) return 'morning';
  if (h >= 11 && h < 17) return 'day';
  if (h >= 17 && h < 21) return 'evening';
  return 'night';
}

/** Scene time from the real sunrise / sunset of the weather city when known, else from the clock. */
export function sceneTime(now = new Date()) {
  const w = cachedWeather();
  const toMin = (s) => { const m = /^(\d{2}):(\d{2})$/.exec(s || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const rise = w && toMin(w.sunrise);
  const set = w && toMin(w.sunset);
  if (rise === null || set === null || rise === undefined || set === undefined || set <= rise) return timeOfDay(now.getHours());
  const m = now.getHours() * 60 + now.getMinutes();
  if (m < rise - 30 || m >= set + 40) return 'night';
  if (m < rise + 150) return 'morning';
  if (m < set - 90) return 'day';
  return 'evening';
}

const pad = (n) => String(n).padStart(2, '0');

// ------------------------------------------------------------------ background

function scene(tod) {
  const night = tod === 'night';
  const stars = night
    ? Array.from({ length: 26 }, (_, i) => `<span class="star" style="--x:${(i * 37 + 11) % 100}%;--y:${(i * 53 + 7) % 55}%;--d:${(i % 6) * 0.5}s"></span>`).join('')
    : '';
  const birds = night ? '' : `<div class="birds">${[0, 1, 2].map((i) => `<svg class="bird b${i}" viewBox="0 0 24 10"><path d="M1 6 Q6 0 12 6 Q18 0 23 6"/></svg>`).join('')}</div>`;
  return raw(`<div class="scene ${tod}" aria-hidden="true">
    <div class="sc-sky"></div>
    ${stars}
    ${night ? '<div class="moon"><i></i><i></i><i></i></div>' : '<div class="sun"><div class="rays"></div></div>'}
    <div class="cloud c1"></div><div class="cloud c2"></div><div class="cloud c3"></div>
    ${birds}
    <svg class="hills far" viewBox="0 0 1200 300" preserveAspectRatio="none"><path d="M0 210 C 120 150 240 175 380 150 C 520 125 640 190 800 160 C 940 132 1080 170 1200 140 L1200 300 L0 300 Z"/></svg>
    <svg class="hills mid" viewBox="0 0 1200 300" preserveAspectRatio="none"><path d="M0 245 C 180 200 330 235 520 212 C 700 188 840 240 1010 214 C 1100 202 1160 210 1200 205 L1200 300 L0 300 Z"/></svg>
    <svg class="hills near" viewBox="0 0 1200 300" preserveAspectRatio="none"><path d="M0 278 C 200 250 400 272 620 256 C 840 240 1010 268 1200 252 L1200 300 L0 300 Z"/></svg>
  </div>`);
}

function background(user, tod) {
  const bg = user.background || '';
  if (bg.startsWith('img:')) {
    const id = bg.slice(4);
    const url = cachedUrl(id);
    return html`<div class="hero-photo ${url ? 'img-ready' : ''}" data-bg-img="${id}" style="${url ? `background-image:url("${url}")` : ''}"></div>
      <div class="hero-shade"></div>`;
  }
  if (bg.startsWith('g:') && BG_PRESETS.includes(bg.slice(2))) {
    return html`<div class="hero-grad grad-${bg.slice(2)}" aria-hidden="true"><i class="orb o1"></i><i class="orb o2"></i><i class="orb o3"></i></div>`;
  }
  return scene(tod);
}

/** Text over a photo or the night sky needs light ink. */
function inkClass(user) {
  const bg = user.background || '';
  if (bg.startsWith('img:')) return 'ink-light';
  if (bg === 'g:night' || bg === 'g:ocean' || bg === 'g:forest') return 'ink-light';
  return ''; // the living scene follows the app theme (pastel in light mode, deep blue in dark mode)
}

// ------------------------------------------------------------------ pieces

export function avatarHtml(user, cls = '') {
  const id = user && user.avatar_id;
  const letter = ((user && user.name) || '?').slice(0, 1).toUpperCase();
  if (!id) return html`<span class="avatar ${cls}">${letter}</span>`;
  const url = cachedUrl(id);
  return html`<span class="avatar avatar-photo ${cls} ${url ? 'img-ready' : ''}" data-has-img><span>${letter}</span><img data-img="${id}" alt="" ${url ? raw(`src="${url}"`) : ''}></span>`;
}

function greeting(user) {
  const h = new Date().getHours();
  const key = h < 5 ? 'today.night' : h < 12 ? 'today.morning' : h < 18 ? 'today.day' : 'today.evening';
  return t(key, { name: (user.name || '').split(' ')[0] });
}

function weatherHtml() {
  const w = cachedWeather();
  const p = place();
  if (!w) {
    return html`<button type="button" class="weather is-empty" data-weather aria-label="${t('w.title')}">
      <span class="w-emoji">🌡️</span><span class="w-info"><b>${t('w.title')}</b><small>${p.city}</small></span></button>`;
  }
  const d = describe(w.code, w.is_day);
  const deg = (v) => (v === null || v === undefined ? '—' : `${Math.round(v)}°`);
  return html`<button type="button" class="weather tone-${d.tone}" data-weather aria-label="${t('w.title')}: ${deg(w.temp)}, ${t(d.key)}"
      data-tip="${[t('w.feels', { t: deg(w.feels) }), w.wind != null ? t('w.wind', { v: Math.round(w.wind) }) : '', w.humidity != null ? t('w.humidity', { v: w.humidity }) : ''].filter(Boolean).join(' · ')}">
    <span class="w-emoji">${d.emoji}</span>
    <span class="w-temp">${deg(w.temp)}</span>
    <span class="w-info"><b>${t(d.key)}</b><small>${p.city} · ↑${deg(w.max)} ↓${deg(w.min)}</small></span>
  </button>`;
}

function cardHtml(user) {
  const txs = store.all('transactions');
  const all = F.totals(txs);
  const today = D.today();
  const month = F.totals(F.inRange(txs, D.startOfMonth(today), D.endOfMonth(today)));
  const hide = !!getPrefs().hideMoney;
  const show = (v, opts) => (hide ? '••• •••' : money(v, opts));
  const [y, m] = today.split('-').map(Number);
  return html`
    <div class="bank-wrap">
      <span class="bc-ghost g2"></span><span class="bc-ghost g1"></span>
      <div class="bank-card" data-tilt>
        <div class="bc-flow"></div><div class="bc-holo"></div><div class="bc-shine"></div>
        <div class="bc-row"><span class="bc-brand"><span class="logo">✦</span>Makon</span>
          <button type="button" class="bc-eye" data-hide-money aria-label="${hide ? t('home.show') : t('home.hide')}">${icon(hide ? 'eyeOff' : 'eye', 18)}</button></div>
        <div class="bc-row"><span class="bc-chip" aria-hidden="true"><i></i></span><span class="bc-wave" aria-hidden="true">${raw('<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8.5 8a6 6 0 0 1 0 8M12 5.5a10 10 0 0 1 0 13M15.5 3a14 14 0 0 1 0 18"/></svg>')}</span></div>
        <div class="bc-body"><span class="bc-label">${t('home.balance')}</span>
          <span class="bc-amount ${all.balance < 0 ? 'neg' : ''}">${show(all.balance)}</span></div>
        <div class="bc-row bc-foot"><span>${user.name || ''}</span><span>${monthTitle(y, m)}</span></div>
      </div>
    </div>
    <div class="hero-mini">
      <div><span>${t('home.monthIn')}</span><b class="pos">${show(month.income, { sign: true })}</b></div>
      <div><span>${t('home.monthOut')}</span><b>${show(month.expense)}</b></div>
    </div>`;
}

function notesHtml() {
  const notes = store.all('notes').sort((a, b) => (b.pinned - a.pinned) || b.updated_at - a.updated_at).slice(0, 3);
  return html`<div class="hero-notes">
    ${notes.map((n, i) => html`<button type="button" class="mini-note note-${n.color || 'amber'}" style="--rot:${[-1.2, 0.8, -0.5][i]}deg" data-note="${n.id}">
      ${n.pinned ? html`<span class="mn-pin">${icon('pin', 13)}</span>` : ''}<b>${n.title || t('notes.untitled')}</b><span>${String(n.content || '').slice(0, 80)}</span></button>`)}
    <button type="button" class="mini-note mini-add" data-new-note aria-label="${t('notes.new')}">${icon('plus', 20)}<span>${t('notes.new')}</span></button>
  </div>`;
}

function dayPct(d = new Date()) {
  return ((d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400) * 100;
}

export function heroView() {
  const user = store.getUser() || {};
  const now = new Date();
  const tod = sceneTime(now);
  const pct = dayPct(now);
  return html`
    <section class="hero ${inkClass(user)}" data-hero data-tod="${tod}">
      <div class="hero-layer">${background(user, tod)}</div>
      <div class="hero-in">
        <div class="hero-main">
          <div class="hero-top">
            <span class="hero-date">${icon('calendar', 15)}${dateLong(D.today())}</span>
            <button type="button" class="hero-btn" data-change-bg aria-label="${t('home.changeBg')}" data-tip="${t('home.changeBg')}">${icon('image', 18)}</button>
          </div>
          <div class="hero-greet">${avatarHtml(user, 'avatar-lg')}<h1>${greeting(user)}</h1></div>
          <div class="hero-clock" aria-label="${pad(now.getHours())}:${pad(now.getMinutes())}">
            <span data-clock>${pad(now.getHours())}:${pad(now.getMinutes())}</span><span class="hero-sec" data-sec>${pad(now.getSeconds())}</span>
          </div>
          <div class="day-prog">
            <div class="dp-bar"><i data-dp style="width:${pct.toFixed(2)}%"></i><span class="dp-dot" data-dp-dot style="left:${pct.toFixed(2)}%">${tod === 'night' ? '🌙' : '☀️'}</span></div>
            <div class="dp-labels"><span>00:00</span><span><b data-dp-pct>${Math.floor(pct)}%</b> ${t('home.dayPassed')}</span><span>24:00</span></div>
          </div>
          <div data-weather-slot>${weatherHtml()}</div>
        </div>
        <div class="hero-side" data-card-slot>${cardHtml(user)}</div>
      </div>
      <div data-notes-slot>${notesHtml()}</div>
    </section>`;
}

/** Called every second by the page: only touches the clock text and the day bar. */
export function tickHero(root) {
  const hero = root && root.querySelector('[data-hero]');
  if (!hero) return;
  const d = new Date();
  const clock = $('[data-clock]', hero);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (clock && clock.textContent !== hm) clock.textContent = hm;
  const sec = $('[data-sec]', hero);
  if (sec) sec.textContent = pad(d.getSeconds());
  const pct = dayPct(d);
  const bar = $('[data-dp]', hero);
  if (bar) bar.style.width = `${pct.toFixed(2)}%`;
  const dot = $('[data-dp-dot]', hero);
  if (dot) dot.style.left = `${pct.toFixed(2)}%`;
  const label = $('[data-dp-pct]', hero);
  if (label) label.textContent = `${Math.floor(pct)}%`;
}

/** Re-render parts that depend on data without rebuilding the whole picture. */
export function refreshHero(root, kinds) {
  const hero = root && root.querySelector('[data-hero]');
  if (!hero) return false;
  const user = store.getUser() || {};
  const tod = sceneTime();
  if (kinds.has('user') || hero.dataset.tod !== tod) return false; // background / name changed: full repaint
  if (kinds.has('transactions')) setHTML($('[data-card-slot]', hero), cardHtml(user));
  if (kinds.has('notes')) setHTML($('[data-notes-slot]', hero), notesHtml());
  if (kinds.has('weather')) setHTML($('[data-weather-slot]', hero), weatherHtml());
  return true;
}

// ------------------------------------------------------------------ actions

async function patchMe(body) {
  const me = await api.patch('/api/auth/me', body);
  store.setUser(me);
  return me;
}

export function openBackgroundSheet() {
  const user = store.getUser() || {};
  const current = user.background || '';
  const photoId = current.startsWith('img:') ? current.slice(4) : null;
  const m = openModal({
    title: t('bg.title'),
    content: html`
      <div class="bg-grid">
        <button type="button" class="bg-opt ${!current ? 'active' : ''}" data-bg="">
          <span class="bg-prev prev-scene">${scene(sceneTime())}</span><span>${t('bg.scene')}</span></button>
        ${BG_PRESETS.map((g) => html`<button type="button" class="bg-opt ${current === `g:${g}` ? 'active' : ''}" data-bg="g:${g}">
          <span class="bg-prev grad-${g}"></span><span>${t(`bg.g.${g}`)}</span></button>`)}
        ${photoId ? html`<button type="button" class="bg-opt active" data-bg="${current}">
          <span class="bg-prev" data-bg-img="${photoId}"></span><span>${t('bg.upload')}</span></button>` : ''}
        <label class="bg-opt bg-upload">
          <span class="bg-prev">${icon('upload', 26)}</span><span>${t('bg.upload')}</span>
          <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" data-bg-file hidden></label>
      </div>
      <p class="muted small">${t('bg.uploadHint')}</p>
      <p class="form-error" hidden></p>`,
  });
  hydrateImages(m.body);
  const err = $('.form-error', m.body);
  const fail = (msg) => { err.textContent = msg; err.hidden = !msg; };
  const busy = (on_) => m.body.classList.toggle('is-busy', on_);
  on(m.body, 'click', '[data-bg]', async (e, b) => {
    const value = b.dataset.bg;
    if (value === current) { m.close(); return; }
    busy(true);
    try {
      await patchMe({ background: value });
      if (photoId) forgetImage(photoId);
      m.close();
      toast(t('bg.saved'), { tone: 'success' });
    } catch (ex) { fail(errorText(ex)); busy(false); }
  });
  $('[data-bg-file]', m.body).addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!navigator.onLine) { fail(t('bg.needOnline')); return; }
    busy(true);
    try {
      const blob = await resizeImage(file, 'background');
      const id = await saveImage(blob, 'background', { wait: true });
      await patchMe({ background: `img:${id}` });
      if (photoId) forgetImage(photoId);
      m.close();
      toast(t('bg.saved'), { tone: 'success' });
    } catch (ex) { fail(errorText(ex)); busy(false); }
  });
}

export function bindHero(el, { onNote, onNewNote } = {}) {
  on(el, 'click', '[data-change-bg]', () => openBackgroundSheet());
  on(el, 'click', '[data-weather]', () => openCityPicker());
  on(el, 'click', '[data-hide-money]', () => {
    setPrefs({ hideMoney: !getPrefs().hideMoney });
    store.emit('transactions');
  });
  if (onNote) on(el, 'click', '[data-note]', (e, b) => onNote(b.dataset.note));
  if (onNewNote) on(el, 'click', '[data-new-note]', () => onNewNote());
  loadWeather().then((w) => { if (w) store.emit('weather'); });
}
