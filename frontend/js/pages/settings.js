import { api, apiBase, request } from '../core/api.js';
import { appctl, getPrefs, setPrefs } from '../core/appctl.js';
import { seriesColor } from '../core/charts.js';
import { $, downloadBlob, html, isNative, on, setHTML } from '../core/dom.js';
import * as D from '../core/dates.js';
import { categoryName } from '../core/finance.js';
import { LANGS, getLang, setLang, t, timeAgo } from '../core/i18n.js';
import { icon, telegramIcon } from '../core/icons.js';
import { forgetImage, hydrateImages, resizeImage, saveImage } from '../core/images.js';
import * as importer from '../core/importer.js';
import { disableLock, lockAvailable, lockConfig, setPin, setTimeoutMinutes } from '../core/lock.js';
import * as store from '../core/store.js';
import { getStatus, onStatus, syncNow } from '../core/sync.js';
import { confirmDialog, errorText, openModal, toast } from '../core/ui.js';
import { openCityPicker, place } from '../core/weather.js';
import { BG_PRESETS, avatarHtml, openBackgroundSheet } from './hero.js';
import { openCalendarSheet } from './study.js';

const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948', '#8d6e63', '#0e7490', '#898781'];
const EMOJIS = ['🛒', '☕', '🚕', '🎓', '📚', '📱', '🛍️', '💊', '🏠', '🎬', '📦', '💼', '💻', '👪', '🎁', '⚽', '✈️', '🐾', '💇', '🧾', '🚗', '🎮', '💰', '➕'];
let root = null;
let offStatus = null;
let linkPoll = null;

const user = () => store.getUser() || {};

async function patchMe(body) {
  const res = await api.patch('/api/auth/me', body);
  store.setUser(res);
  return res;
}

function row(label, control, { hint = '', ic = '' } = {}) {
  return html`<div class="set-row">
    <div class="set-label">${ic ? icon(ic, 18) : ''}<div><span>${label}</span>${hint ? html`<small class="muted">${hint}</small>` : ''}</div></div>
    <div class="set-control">${control}</div></div>`;
}

function syncText(status) {
  const pending = store.pendingCount();
  if (status === 'offline') return pending ? t('sync.offlinePending', { n: pending }) : t('sync.offline');
  if (status === 'syncing') return t('sync.syncing');
  if (status === 'error') return t('sync.error');
  const last = store.getState().lastSync;
  return last ? t('sync.ok', { when: timeAgo(last) }) : t('sync.never');
}

function bgLabel(u) {
  const bg = u.background || '';
  if (bg.startsWith('img:')) return t('bg.upload');
  if (bg.startsWith('g:') && BG_PRESETS.includes(bg.slice(2))) return t(`bg.g.${bg.slice(2)}`);
  return t('bg.scene');
}

async function changePhoto(file) {
  const old = user().avatar_id;
  try {
    const blob = await resizeImage(file, 'avatar');
    const id = await saveImage(blob, 'avatar', { wait: true });
    await patchMe({ avatar_id: id });
    if (old) forgetImage(old);
    toast(t('common.saved'), { tone: 'success' });
  } catch (err) { toast(errorText(err), { tone: 'error' }); }
}

function view() {
  const u = user();
  const prefs = getPrefs();
  const theme = prefs.theme || 'auto';
  const tg = appctl.config.telegram || {};
  const lock = lockConfig(store.getState().userId);
  const cats = [...store.categoriesOf('expense'), ...store.categoriesOf('income')];
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  return html`
    <section class="card set-card">
      <h3>${icon('user', 18)} ${t('set.profile')}</h3>
      <div class="photo-row">
        ${avatarHtml(u, 'avatar-xl')}
        <div class="row-gap">
          <label class="btn btn-soft btn-sm">${icon('camera', 16)}${t('set.photoPick')}<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" data-photo-file hidden></label>
          ${u.avatar_id ? html`<button type="button" class="btn btn-ghost btn-sm btn-danger-text" data-photo-remove>${icon('trash', 16)}${t('set.photoRemove')}</button>` : ''}
        </div>
      </div>
      <form class="inline-form" data-name-form>
        <label class="field"><span class="field-label">${t('auth.name')}</span><input class="input" name="name" maxlength="80" value="${u.name || ''}" required></label>
        <button class="btn btn-soft btn-sm">${t('common.save')}</button>
      </form>
      ${row(t('auth.email'), html`<span class="muted">${u.email || ''}</span>`, { ic: 'mail' })}
    </section>

    <section class="card set-card">
      <h3>${icon('globe', 18)} ${t('set.appearance')}</h3>
      ${row(t('set.language'), html`<div class="seg seg-sm">
        ${LANGS.map((l) => html`<button type="button" class="seg-btn ${getLang() === l ? 'active' : ''}" data-lang="${l}" lang="${l}">${t(`lang.${l}`)}</button>`)}</div>`)}
      ${row(t('set.background'), html`<button type="button" class="btn btn-soft btn-sm" data-bg-open>${icon('image', 16)}${bgLabel(u)}</button>`, { ic: 'image' })}
      ${row(t('set.city'), html`<button type="button" class="btn btn-soft btn-sm" data-city>${icon('mapPin', 16)}${u.lat != null ? place().city : t('set.cityNone')}</button>`, { ic: 'sun' })}
      ${row(t('set.theme'), html`<div class="seg seg-sm">
        ${[['auto', 'monitor'], ['light', 'sun'], ['dark', 'moon']].map(([k, ic]) => html`<button type="button" class="seg-btn ${theme === k ? 'active' : ''}" data-theme="${k}" aria-label="${t(`set.theme.${k}`)}">${icon(ic, 16)}<span>${t(`set.theme.${k}`)}</span></button>`)}</div>`)}
    </section>

    <section class="card set-card">
      <h3>${telegramIcon(18)} Telegram</h3>
      ${!tg.enabled ? html`<p class="muted small">${t('tg.disabled')}</p>` : html`
        ${row(t('tg.bot'), u.telegram && u.telegram.linked
          ? html`<span class="state state-ok">${icon('check', 14)}${t('tg.linked')}${u.telegram.username ? ` · @${u.telegram.username}` : ''}</span>
                 <button type="button" class="btn btn-ghost btn-sm" data-tg-unlink>${t('tg.unlink')}</button>`
          : html`<button type="button" class="btn btn-primary btn-sm" data-tg-link>${telegramIcon(16)}${t('tg.link')}</button>`, { hint: `${t('tg.hint')}. ${t('tg.resetHint')}` })}
        ${u.telegram && u.telegram.linked ? html`
          ${row(t('tg.digest'), html`<label class="switch-row"><input type="checkbox" class="switch" data-digest ${u.digest_enabled ? 'checked' : ''}><input type="time" class="input input-sm" data-digest-time value="${u.digest_time || '07:30'}" aria-label="${t('tg.digestTime')}"></label>`, { hint: t('tg.digestHint'), ic: 'sun' })}
          ${row(t('tg.remind'), html`<select class="input input-sm select" data-remind>
            ${[0, 15, 30, 60, 120, 180].map((n) => html`<option value="${n}" ${Number(u.remind_minutes) === n ? 'selected' : ''}>${n ? t('tg.before', { n }) : t('common.off')}</option>`)}</select>`, { ic: 'bell' })}` : ''}`}
    </section>

    <section class="card set-card">
      <h3>${icon('calendar', 18)} ${t('cal.title')}</h3>
      ${row(t('cal.short'), html`<button type="button" class="btn btn-soft btn-sm" data-calendar>${icon('link', 16)}${t('cal.button')}</button>`, { hint: t('cal.hint') })}
    </section>

    <section class="card set-card">
      <h3>${icon('tag', 18)} ${t('set.categories')}</h3>
      <div class="cat-list">
        ${cats.map((c) => html`<button type="button" class="cat-item" data-cat="${c.id}">
          <span class="tx-ic" style="--c:${seriesColor(c.color)}">${c.icon || '📦'}</span>
          <span>${categoryName(c)}</span><small class="muted">${t(`tx.${c.type}`)}</small></button>`)}
      </div>
      <div class="row-gap">
        <button type="button" class="btn btn-soft btn-sm" data-new-cat="expense">${icon('plus', 16)}${t('cat.newExpense')}</button>
        <button type="button" class="btn btn-ghost btn-sm" data-new-cat="income">${icon('plus', 16)}${t('cat.newIncome')}</button>
      </div>
    </section>

    <section class="card set-card">
      <h3>${icon('shield', 18)} ${t('set.security')}</h3>
      ${row(t('lock.title'), lockAvailable()
        ? (lock ? html`<select class="input input-sm select" data-lock-timeout aria-label="${t('lock.after')}">
              ${[0, 1, 5, 15, 60].map((n) => html`<option value="${n}" ${lock.timeout === n ? 'selected' : ''}>${n ? t('lock.afterN', { n }) : t('lock.immediately')}</option>`)}</select>
            <button type="button" class="btn btn-ghost btn-sm" data-lock-off>${t('common.off')}</button>`
          : html`<button type="button" class="btn btn-soft btn-sm" data-lock-on>${icon('lock', 16)}${t('lock.enable')}</button>`)
        : html`<span class="muted small">${t('lock.needHttps')}</span>`, { hint: t('lock.hint') })}
      ${row(t('set.password'), html`<button type="button" class="btn btn-soft btn-sm" data-password>${icon('key', 16)}${t('set.change')}</button>`)}
      ${row(t('set.otherDevices'), html`<button type="button" class="btn btn-ghost btn-sm" data-logout-all>${icon('logout', 16)}${t('set.signOutOthers')}</button>`)}
    </section>

    <section class="card set-card">
      <h3>${icon('database', 18)} ${t('set.data')}</h3>
      ${row(t('set.sync'), html`<span class="muted small" data-sync-text>${syncText(getStatus())}</span><button type="button" class="btn-icon" data-sync-now aria-label="${t('set.syncNow')}">${icon('sync', 18)}</button>`, { ic: 'cloud' })}
      ${row(t('set.backup'), html`<button type="button" class="btn btn-soft btn-sm" data-backup>${icon('download', 16)}JSON</button>`, { hint: t('set.backupHint') })}
      ${row(t('set.import'), html`<label class="btn btn-soft btn-sm">${icon('upload', 16)}${t('set.chooseFile')}<input type="file" accept="application/json,.json" data-import hidden></label>`, { hint: t('set.importHint') })}
    </section>

    <section class="card set-card">
      <h3>${icon('phone', 18)} ${t('set.app')}</h3>
      ${isNative() ? '' : standalone ? row(t('set.installed'), html`<span class="state state-ok">${icon('check', 14)}</span>`)
        : appctl.installPrompt ? row(t('set.install'), html`<button type="button" class="btn btn-primary btn-sm" data-install>${icon('download', 16)}${t('set.installBtn')}</button>`, { hint: t('set.installHint') })
        : row(t('set.install'), html`<span class="muted small">${isIos ? t('set.iosHint') : t('set.browserHint')}</span>`)}
      ${!isNative() && appctl.config.android_apk ? row(t('set.android'), html`<a class="btn btn-soft btn-sm" href="${appctl.config.android_apk}" download="Makon.apk">${icon('download', 16)}APK</a>`, { hint: t('set.androidHint') }) : ''}
      ${row(t('set.privacy'), html`<a class="btn btn-ghost btn-sm" href="${apiBase()}/privacy" target="_blank" rel="noopener">${icon('external', 16)}${t('common.open')}</a>`)}
      ${row(t('set.version'), html`<span class="muted small">${appctl.config.version || '—'}</span>`)}
    </section>

    <section class="card set-card">
      <div class="row-gap">
        <button type="button" class="btn btn-soft" data-logout>${icon('logout', 18)}${t('set.logout')}</button>
        <button type="button" class="btn btn-ghost btn-danger-text" data-delete-account>${icon('trash', 18)}${t('set.deleteAccount')}</button>
      </div>
    </section>`;
}

// ------------------------------------------------------------------ sheets

function openCategorySheet(cat = null, type = 'expense') {
  const isFallback = cat && (cat.key === 'other_expense' || cat.key === 'other_income');
  const m = openModal({
    title: cat ? t('cat.edit') : type === 'income' ? t('cat.newIncome') : t('cat.newExpense'),
    content: html`<form class="form" novalidate>
      <label class="field"><span class="field-label">${t('cat.name')}</span><input class="input" name="name" maxlength="60" value="${cat ? categoryName(cat) : ''}" required></label>
      <div class="field"><span class="field-label">${t('common.icon')}</span>
        <div class="chips emoji-chips">${EMOJIS.map((e) => html`<label class="chip chip-emoji"><input type="radio" name="icon" value="${e}" ${(cat ? cat.icon : '📦') === e ? 'checked' : ''}><span>${e}</span></label>`)}</div></div>
      <div class="field"><span class="field-label">${t('common.color')}</span>
        <div class="swatches">${PALETTE.map((c) => html`<label class="swatch"><input type="radio" name="color" value="${c}" ${(cat ? cat.color : PALETTE[0]).toLowerCase() === c ? 'checked' : ''} aria-label="${c}"><span style="background:${seriesColor(c)}"></span></label>`)}</div></div>
      <p class="form-error" hidden></p>
      <div class="modal-actions">
        ${cat && !isFallback ? html`<button type="button" class="btn btn-ghost btn-danger-text" data-del>${icon('trash', 18)}${t('common.delete')}</button>` : ''}
        <button class="btn btn-primary">${t('common.save')}</button></div></form>`,
  });
  const form = $('form', m.body);
  const el = form.elements;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = el.name.value.trim();
    if (!name) { const b = $('.form-error', form); b.textContent = t('err.required'); b.hidden = false; return; }
    const builtInName = cat && cat.key && !cat.name && name === categoryName(cat);
    store.put('categories', {
      ...(cat ? { id: cat.id } : { type, key: null, monthly_limit: null, sort: 100 + store.all('categories').length }),
      name: builtInName ? '' : name, icon: el.icon.value || '📦', color: el.color.value || PALETTE[0],
    });
    m.close();
  });
  form.addEventListener('click', async (e) => {
    if (!e.target.closest('[data-del]')) return;
    const txs = store.all('transactions').filter((x) => x.category_id === cat.id);
    const ok = await confirmDialog({ title: t('cat.deleteQ'), text: txs.length ? t('cat.deleteText', { n: txs.length }) : '' });
    if (!ok) return;
    const fallback = store.fallbackCategory(cat.type);
    if (txs.length && fallback) store.putMany('transactions', txs.map((x) => ({ id: x.id, category_id: fallback.id })));
    store.remove('categories', cat.id);
    m.close();
  });
}

function openPasswordSheet() {
  const m = openModal({
    title: t('set.password'),
    className: 'modal-small',
    content: html`<form class="form" novalidate>
      <label class="field"><span class="field-label">${t('set.currentPassword')}</span><input class="input" type="password" name="current" autocomplete="current-password" required></label>
      <label class="field"><span class="field-label">${t('set.newPassword')}</span><input class="input" type="password" name="new" autocomplete="new-password" minlength="8" required><span class="field-hint">${t('auth.passwordHint')}</span></label>
      <p class="form-error" hidden></p>
      <div class="modal-actions"><button class="btn btn-primary">${t('common.save')}</button></div></form>`,
  });
  const form = $('form', m.body);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const box = $('.form-error', form);
    if (form.elements.new.value.length < 8) { box.textContent = t('auth.passwordHint'); box.hidden = false; return; }
    try {
      const res = await api.post('/api/auth/password', { current: form.elements.current.value, new: form.elements.new.value });
      const { setToken } = await import('../core/api.js');
      setToken(res.token);
      store.setUser(res.user);
      m.close();
      toast(t('set.passwordChanged'), { tone: 'success' });
    } catch (err) { box.textContent = errorText(err); box.hidden = false; }
  });
}

function openPinSheet() {
  const m = openModal({
    title: t('lock.enable'),
    className: 'modal-small',
    content: html`<form class="form" novalidate>
      <label class="field"><span class="field-label">${t('lock.newPin')}</span><input class="input input-lg pin-input" name="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" required><span class="field-hint">${t('lock.pinHint')}</span></label>
      <label class="field"><span class="field-label">${t('lock.repeat')}</span><input class="input input-lg pin-input" name="pin2" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" required></label>
      <p class="form-error" hidden></p>
      <div class="modal-actions"><button class="btn btn-primary">${t('common.save')}</button></div></form>`,
  });
  const form = $('form', m.body);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const box = $('.form-error', form);
    const pin = form.elements.pin.value;
    if (!/^\d{4,6}$/.test(pin)) { box.textContent = t('lock.pinHint'); box.hidden = false; return; }
    if (pin !== form.elements.pin2.value) { box.textContent = t('lock.mismatch'); box.hidden = false; return; }
    await setPin(store.getState().userId, pin, 5);
    m.close();
    toast(t('lock.enabled'), { tone: 'success' });
    paint();
  });
}

async function linkTelegram() {
  try {
    const res = await api.post('/api/telegram/link');
    const m = openModal({
      title: 'Telegram',
      className: 'modal-small',
      content: html`<p class="muted">${t('tg.linkText')}</p>
        <div class="modal-actions"><a class="btn btn-primary btn-wide" href="${res.url}" target="_blank" rel="noopener" data-open-tg>${telegramIcon(18)}${t('tg.open')}</a></div>`,
    });
    clearInterval(linkPoll);
    let tries = 0;
    linkPoll = setInterval(async () => {
      tries += 1;
      if (tries > 60) { clearInterval(linkPoll); return; }
      try {
        const me = await api.get('/api/auth/me');
        if (me.telegram && me.telegram.linked) {
          clearInterval(linkPoll);
          store.setUser(me);
          m.close();
          toast(t('tg.linkedToast'), { tone: 'success' });
        }
      } catch (_) { /* keep polling */ }
    }, 3000);
  } catch (err) { toast(errorText(err), { tone: 'error' }); }
}

async function importFile(file) {
  let json;
  try { json = JSON.parse(await file.text()); } catch (_) { toast(t('set.importBad'), { tone: 'error' }); return; }
  const kind = importer.detect(json);
  if (!kind) { toast(t('set.importBad'), { tone: 'error' }); return; }
  let includeSamples = false;
  const plan = () => (kind === 'legacy' ? importer.planLegacy(json, { includeSamples }) : importer.planMakon(json));
  let p = plan();
  const summary = () => html`<ul class="import-list">${Object.entries(p.records).filter(([, l]) => l.length).map(([k, l]) => html`<li><span>${t(`kind.${k}`)}</span><b>${l.length}</b></li>`)}</ul>`;
  const m = openModal({
    title: t('set.import'),
    className: 'modal-small',
    content: html`<div data-summary>${summary()}</div>
      ${kind === 'legacy' && p.samples ? html`<label class="switch-row"><input type="checkbox" class="switch" data-samples><span>${t('set.importSamples', { n: p.samples })}</span></label>` : ''}
      ${kind === 'legacy' ? html`<p class="muted small">${t('set.importLegacyNote')}</p>` : ''}
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-close>${t('common.cancel')}</button><button type="button" class="btn btn-primary" data-go>${t('set.importGo')}</button></div>`,
  });
  m.body.addEventListener('change', (e) => {
    if (e.target.matches('[data-samples]')) { includeSamples = e.target.checked; p = plan(); setHTML($('[data-summary]', m.body), summary()); }
  });
  on(m.body, 'click', '[data-go]', () => {
    const n = importer.countRecords(p.records);
    importer.applyPlan(p.records);
    m.close();
    toast(t('set.imported', { n }), { tone: 'success' });
  });
}

// ------------------------------------------------------------------ page

function paint() {
  if (!root) return;
  const region = $('[data-region]', root);
  setHTML(region, view());
  hydrateImages(region);
}

export default {
  id: 'settings',
  deps: ['user', 'categories'],
  title: () => t('nav.settings'),
  mount(el) {
    root = el;
    setHTML(el, html`<header class="page-head"><h1>${t('nav.settings')}</h1></header><div data-region></div>`);
    paint();
    offStatus = onStatus((s) => { const n = $('[data-sync-text]', el); if (n) n.textContent = syncText(s); });

    el.addEventListener('submit', async (e) => {
      if (!e.target.matches('[data-name-form]')) return;
      e.preventDefault();
      const name = e.target.elements.name.value.trim();
      if (!name) return;
      try { await patchMe({ name }); toast(t('common.saved'), { tone: 'success' }); } catch (err) { toast(errorText(err), { tone: 'error' }); }
    });
    on(el, 'click', '[data-lang]', async (e, b) => {
      const lang = b.dataset.lang;
      setPrefs({ lang });
      setLang(lang);
      appctl.rerender();
      try { await patchMe({ lang }); } catch (_) { /* saved locally; profile updates next time */ }
    });
    on(el, 'click', '[data-theme]', (e, b) => { setPrefs({ theme: b.dataset.theme }); appctl.applyTheme(); paint(); });
    on(el, 'click', '[data-tg-link]', () => linkTelegram());
    on(el, 'click', '[data-tg-unlink]', async () => {
      if (!(await confirmDialog({ title: t('tg.unlinkQ'), ok: t('tg.unlink') }))) return;
      try { await api.post('/api/telegram/unlink'); store.setUser(await api.get('/api/auth/me')); } catch (err) { toast(errorText(err), { tone: 'error' }); }
    });
    el.addEventListener('change', async (e) => {
      try {
        if (e.target.matches('[data-digest]')) await patchMe({ digest_enabled: e.target.checked });
        else if (e.target.matches('[data-digest-time]') && D.isTime(e.target.value)) await patchMe({ digest_time: e.target.value });
        else if (e.target.matches('[data-remind]')) await patchMe({ remind_minutes: Number(e.target.value) });
        else if (e.target.matches('[data-lock-timeout]')) { setTimeoutMinutes(store.getState().userId, Number(e.target.value)); return; }
        else if (e.target.matches('[data-import]')) { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); return; }
        else if (e.target.matches('[data-photo-file]')) { const f = e.target.files[0]; e.target.value = ''; if (f) changePhoto(f); return; }
        else return;
        toast(t('common.saved'), { tone: 'success' });
      } catch (err) { toast(errorText(err), { tone: 'error' }); paint(); }
    });
    on(el, 'click', '[data-calendar]', () => openCalendarSheet());
    on(el, 'click', '[data-bg-open]', () => openBackgroundSheet());
    on(el, 'click', '[data-city]', () => openCityPicker());
    on(el, 'click', '[data-photo-remove]', async () => {
      const old = user().avatar_id;
      try { await patchMe({ avatar_id: null }); if (old) forgetImage(old); } catch (err) { toast(errorText(err), { tone: 'error' }); }
    });
    on(el, 'click', '[data-cat]', (e, b) => { const c = store.get('categories', b.dataset.cat); if (c) openCategorySheet(c); });
    on(el, 'click', '[data-new-cat]', (e, b) => openCategorySheet(null, b.dataset.newCat));
    on(el, 'click', '[data-lock-on]', () => openPinSheet());
    on(el, 'click', '[data-lock-off]', () => { disableLock(); paint(); });
    on(el, 'click', '[data-password]', () => openPasswordSheet());
    on(el, 'click', '[data-logout-all]', async () => {
      if (!(await confirmDialog({ title: t('set.signOutOthersQ'), ok: t('set.signOutOthers'), danger: false }))) return;
      try {
        const res = await api.post('/api/auth/logout-all');
        const { setToken } = await import('../core/api.js');
        setToken(res.token);
        toast(t('common.done'), { tone: 'success' });
      } catch (err) { toast(errorText(err), { tone: 'error' }); }
    });
    on(el, 'click', '[data-sync-now]', () => syncNow());
    on(el, 'click', '[data-backup]', () => {
      const blob = new Blob([JSON.stringify(importer.backupJson(), null, 2)], { type: 'application/json' });
      downloadBlob(blob, `makon-backup-${D.today()}.json`);
    });
    on(el, 'click', '[data-install]', async () => {
      const ev = appctl.installPrompt;
      if (!ev) return;
      ev.prompt();
      try { await ev.userChoice; } catch (_) { /* ignore */ }
      appctl.installPrompt = null;
      paint();
    });
    on(el, 'click', '[data-logout]', async () => {
      const pending = store.pendingCount();
      if (!(await confirmDialog({ title: t('set.logoutQ'), text: pending ? t('set.logoutPending', { n: pending }) : '', ok: t('set.logout'), danger: !!pending }))) return;
      appctl.logout();
    });
    on(el, 'click', '[data-delete-account]', () => {
      const m = openModal({
        title: t('set.deleteAccount'),
        className: 'modal-small',
        content: html`<form class="form"><p class="muted">${t('set.deleteText')}</p>
          <label class="field"><span class="field-label">${t('auth.password')}</span><input class="input" type="password" name="password" autocomplete="current-password" required></label>
          <p class="form-error" hidden></p>
          <div class="modal-actions"><button class="btn btn-danger">${t('set.deleteForever')}</button></div></form>`,
      });
      const form = $('form', m.body);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await request('POST', '/api/auth/delete', { body: { password: form.elements.password.value } });
          m.close();
          appctl.logout({ skipSync: true });
        } catch (err) { const b = $('.form-error', form); b.textContent = errorText(err); b.hidden = false; }
      });
    });
  },
  update() {
    const active = document.activeElement;
    if (active && root && root.contains(active) && active.matches('input[name=name]')) return;
    paint();
  },
  unmount() { if (offStatus) offStatus(); clearInterval(linkPoll); root = null; },
};
