// Challenges: "N days of X". One check-in per day, status, streaks and a plan-vs-result chart.
import { challengeDone, challengeEnd, challengeStatus, streaks } from '../core/activity.js';
import { $, html, on, raw, setHTML } from '../core/dom.js';
import * as D from '../core/dates.js';
import { confettiFrom, ringSvg } from '../core/fx.js';
import { dateShort, t, weekdayShort } from '../core/i18n.js';
import { icon } from '../core/icons.js';
import * as store from '../core/store.js';
import { confirmDialog, emptyState, openModal, toast } from '../core/ui.js';

const TONES = ['indigo', 'violet', 'rose', 'amber', 'emerald', 'sky'];
const EMOJIS = ['🔥', '🏃', '📚', '💪', '🧘', '💧', '🥗', '🚭', '💰', '🧠', '✍️', '🌅', '🕌', '🎯', '🗣️', '💻', '🎸', '😴'];
const LENGTHS = [7, 21, 30, 66, 100];
const ui = { filter: 'active' };
let root = null;

const pctOf = (c) => Math.min(100, Math.round((challengeDone(c) / Math.max(1, c.days)) * 100));

function dayIndex(c, day = D.today()) {
  return Math.min(c.days, Math.max(0, D.diffDays(c.start_date, day) + 1));
}

/** Toggle a check-in; returns true when this completed the challenge. */
export function toggleCheckin(id, day = D.today()) {
  const c = store.get('challenges', id);
  if (!c || day < c.start_date || day > challengeEnd(c) || day > D.today()) return false;
  const before = challengeStatus(c);
  const set = new Set(c.checkins || []);
  if (set.has(day)) set.delete(day); else set.add(day);
  const next = store.put('challenges', { id, checkins: [...set].sort() });
  return before !== 'done' && challengeStatus(next) === 'done';
}

export function checkinButton(c, { small = false } = {}) {
  const today = D.today();
  const status = challengeStatus(c);
  if (status !== 'active' && !(status === 'done' && (c.checkins || []).includes(today))) return '';
  const on_ = (c.checkins || []).includes(today);
  return html`<button type="button" class="btn ${on_ ? 'btn-good' : 'btn-primary'} ${small ? 'btn-sm' : ''}" data-checkin="${c.id}" aria-pressed="${on_}">
    ${icon('check', small ? 16 : 18)}${on_ ? t('ch.checked') : t('ch.checkin')}</button>`;
}

function statusPill(c) {
  const st = challengeStatus(c);
  return html`<span class="pill ch-st ch-st-${st}">${t(`ch.st.${st}`)}</span>`;
}

function subline(c) {
  const st = challengeStatus(c);
  if (st === 'planned') return t('ch.startsIn', { n: D.diffDays(D.today(), c.start_date) });
  if (st === 'active') return `${t('ch.dayOf', { d: dayIndex(c), n: c.days })} · ${t('ch.left', { n: Math.max(0, D.diffDays(D.today(), challengeEnd(c))) })}`;
  return `${dateShort(c.start_date)} – ${dateShort(challengeEnd(c))}`;
}

/** Last 14 days (or fewer) as dots: done / missed / today / future. */
function dots(c) {
  const today = D.today();
  const end = challengeEnd(c);
  const last = today < end ? today : end;
  const from = D.addDays(last, -13) < c.start_date ? c.start_date : D.addDays(last, -13);
  const set = new Set(c.checkins || []);
  const out = [];
  for (let d = from; d <= last && out.length < 14; d = D.addDays(d, 1)) {
    out.push(html`<i class="${set.has(d) ? 'on' : d === today ? 'today' : 'miss'}" data-tip="${dateShort(d)}"></i>`);
  }
  return html`<div class="ch-dots" aria-hidden="true">${out}</div>`;
}

export function challengeCard(c) {
  const done = challengeDone(c);
  const s = streaks(c);
  return html`
    <article class="card ch-card tone-${c.color || 'indigo'}">
      <button type="button" class="ch-head" data-open-ch="${c.id}">
        <span class="ch-emoji">${c.icon || '🔥'}</span>
        <span class="ch-titles"><b>${c.title}</b><small class="muted">${c.goal || subline(c)}</small></span>
        ${statusPill(c)}
      </button>
      <div class="ch-mid">
        <div class="ch-ring">${raw(ringSvg(pctOf(c), { size: 92, stroke: 9 }))}<span><b>${done}</b><small>/${c.days}</small></span></div>
        <div class="ch-facts">
          <span>${c.goal ? subline(c) : t('ch.daysN', { n: c.days })}</span>
          <span class="ch-streak">${icon('flame', 15)}${t('ch.streak')}: <b>${s.current}</b></span>
          ${dots(c)}
        </div>
      </div>
      <div class="ch-actions">${checkinButton(c, { small: true })}
        <button type="button" class="btn btn-ghost btn-sm" data-open-ch="${c.id}">${icon('chart', 16)}${t('ch.progress')}</button></div>
    </article>`;
}

// ------------------------------------------------------------------ chart

function lineChart(c) {
  const W = 640;
  const H = 200;
  const pad = { l: 34, r: 12, t: 12, b: 26 };
  const n = c.days;
  const today = D.today();
  const lastIdx = Math.min(n, dayIndex(c, today));
  const set = new Set(c.checkins || []);
  const x = (i) => pad.l + (i / Math.max(1, n)) * (W - pad.l - pad.r);
  const y = (v) => H - pad.b - (v / Math.max(1, n)) * (H - pad.t - pad.b);
  const fact = [[x(0), y(0)]];
  let acc = 0;
  for (let i = 1; i <= lastIdx; i++) {
    if (set.has(D.addDays(c.start_date, i - 1))) acc += 1;
    fact.push([x(i), y(acc)]);
  }
  const path = (pts) => pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('');
  const area = fact.length > 1 ? `${path(fact)}L${fact[fact.length - 1][0].toFixed(1)},${y(0).toFixed(1)}Z` : '';
  const ticks = [0, Math.round(n / 2), n];
  const xl = [1, Math.ceil(n / 2), n];
  return raw(`<svg class="ch-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${t('ch.chart')}">
    ${ticks.map((v) => `<line class="cp-grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="cp-ax" x="${pad.l - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${v}</text>`).join('')}
    ${xl.map((d) => `<text class="cp-ax" x="${x(d).toFixed(1)}" y="${H - 6}" text-anchor="middle">${d}</text>`).join('')}
    <path class="cp-plan" d="M${x(0)},${y(0)}L${x(n)},${y(n)}"/>
    ${area ? `<path class="cp-area" d="${area}"/><path class="cp-fact" d="${path(fact)}"/>` : ''}
    ${fact.length > 1 ? `<circle class="cp-dot" cx="${fact[fact.length - 1][0].toFixed(1)}" cy="${fact[fact.length - 1][1].toFixed(1)}" r="5"/>` : ''}
  </svg>`);
}

function calendar(c) {
  const today = D.today();
  const set = new Set(c.checkins || []);
  const cells = [];
  for (let i = 0; i < c.days; i++) {
    const d = D.addDays(c.start_date, i);
    const cls = set.has(d) ? 'on' : d > today ? 'future' : d === today ? 'today' : 'miss';
    cells.push(html`<button type="button" class="ch-day ${cls}" data-day="${d}" ${d > today ? 'disabled' : ''}
      aria-pressed="${set.has(d)}" data-tip="${weekdayShort(D.weekday(d))}, ${dateShort(d)}">${i + 1}</button>`);
  }
  return html`<div class="ch-cal">${cells}</div>`;
}

function detailView(c) {
  const done = challengeDone(c);
  const s = streaks(c);
  const passed = Math.max(1, dayIndex(c));
  const rate = challengeStatus(c) === 'planned' ? 0 : Math.round((done / passed) * 100);
  return html`
    <div class="ch-detail tone-${c.color || 'indigo'}">
      <div class="ch-detail-head"><span class="ch-emoji ch-emoji-lg">${c.icon || '🔥'}</span>
        <div><p class="muted small">${subline(c)}</p>${c.goal ? html`<p>${c.goal}</p>` : ''}</div>${statusPill(c)}</div>
      <div class="ch-stats">
        <div><b>${done}/${c.days}</b><span>${t('ch.progress')}</span></div>
        <div><b>${s.current}</b><span>${t('ch.streak')}</span></div>
        <div><b>${s.best}</b><span>${t('ch.best')}</span></div>
        <div><b>${rate}%</b><span>${t('ch.rate')}</span></div>
      </div>
      <h4>${t('ch.chart')}</h4>
      <div class="legend"><span class="lg-item"><i class="lg-swatch lg-plan"></i>${t('ch.plan')}</span><span class="lg-item"><i class="lg-swatch lg-fact"></i>${t('ch.fact')}</span></div>
      ${lineChart(c)}
      <h4>${t('ch.calendar')} <small class="muted">· ${t('ch.toggleHint')}</small></h4>
      ${calendar(c)}
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost btn-danger-text" data-ch-del>${icon('trash', 18)}${t('common.delete')}</button>
        <button type="button" class="btn btn-ghost" data-ch-stop>${c.stopped ? t('ch.resume') : t('ch.stop')}</button>
        <button type="button" class="btn btn-soft" data-ch-edit>${icon('edit', 18)}${t('common.edit')}</button>
        ${checkinButton(c)}
      </div>
    </div>`;
}

export function openChallenge(id) {
  const c0 = store.get('challenges', id);
  if (!c0) return;
  let unsub = () => {};
  const m = openModal({ title: c0.title, wide: true, content: detailView(c0), onClose: () => unsub() });
  const repaint = () => {
    const c = store.get('challenges', id);
    if (!c) { m.close(); return; }
    m.setTitle(c.title);
    setHTML(m.body, detailView(c));
  };
  unsub = store.subscribe((kinds) => { if (kinds.has('challenges')) repaint(); });
  on(m.body, 'click', '[data-day]', (e, b) => {
    if (toggleCheckin(id, b.dataset.day)) { confettiFrom(b, 120); toast(t('ch.congrats'), { tone: 'success' }); }
  });
  on(m.body, 'click', '[data-checkin]', (e, b) => {
    if (toggleCheckin(id)) { confettiFrom(b, 120); toast(t('ch.congrats'), { tone: 'success' }); }
  });
  on(m.body, 'click', '[data-ch-stop]', () => { const c = store.get('challenges', id); if (c) store.put('challenges', { id, stopped: !c.stopped }); });
  on(m.body, 'click', '[data-ch-edit]', () => { m.close(); openChallengeSheet(store.get('challenges', id)); });
  on(m.body, 'click', '[data-ch-del]', async () => {
    if (!(await confirmDialog({ title: t('ch.deleteQ') }))) return;
    const removed = store.remove('challenges', id);
    m.close();
    toast(t('common.deleted'), { action: { label: t('common.undo'), fn: () => store.restore('challenges', removed) } });
  });
}

export function openChallengeSheet(c = null) {
  const days = c ? c.days : 30;
  const m = openModal({
    title: c ? t('ch.edit') : t('ch.new'),
    content: html`<form class="form" novalidate>
      <label class="field"><span class="field-label">${t('ch.title')}</span>
        <input class="input" name="title" required maxlength="120" value="${c ? c.title : ''}" placeholder="${t('ch.titlePh')}"></label>
      <div class="field"><span class="field-label">${t('common.icon')}</span>
        <div class="chips emoji-chips">${EMOJIS.map((e) => html`<label class="chip chip-emoji"><input type="radio" name="icon" value="${e}" ${(c ? c.icon : '🔥') === e ? 'checked' : ''}><span>${e}</span></label>`)}</div></div>
      <div class="field"><span class="field-label">${t('ch.days')}</span>
        <div class="chips">${LENGTHS.map((n) => html`<label class="chip"><input type="radio" name="len" value="${n}" ${days === n ? 'checked' : ''}><span>${t('ch.daysN', { n })}</span></label>`)}
          <label class="chip"><input type="radio" name="len" value="custom" ${LENGTHS.includes(days) ? '' : 'checked'}><span>${t('ch.custom')}</span></label></div>
        <input class="input input-sm ch-custom" name="custom" type="number" inputmode="numeric" min="1" max="366" value="${days}" ${LENGTHS.includes(days) ? 'hidden' : ''} aria-label="${t('ch.days')}"></div>
      <div class="form-row">
        <label class="field"><span class="field-label">${t('ch.start')}</span><input class="input" type="date" name="start" value="${c ? c.start_date : D.today()}" required></label>
      </div>
      <label class="field"><span class="field-label">${t('ch.goal')}</span>
        <input class="input" name="goal" maxlength="300" value="${c ? c.goal : ''}" placeholder="${t('ch.goalPh')}"></label>
      <div class="field"><span class="field-label">${t('common.color')}</span>
        <div class="swatches">${TONES.map((tone) => html`<label class="swatch tone-${tone}"><input type="radio" name="color" value="${tone}" ${(c ? c.color : 'indigo') === tone ? 'checked' : ''} aria-label="${tone}"><span></span></label>`)}</div></div>
      <p class="form-error" hidden></p>
      <div class="modal-actions"><button class="btn btn-primary">${t('common.save')}</button></div></form>`,
  });
  const form = $('form', m.body);
  const el = form.elements;
  form.addEventListener('change', (e) => {
    if (e.target.name === 'len') el.custom.hidden = e.target.value !== 'custom';
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fail = (msg) => { const b = $('.form-error', form); b.textContent = msg; b.hidden = !msg; };
    const title = el.title.value.trim();
    if (!title) return fail(t('err.required'));
    const len = el.len.value === 'custom' ? Math.round(Number(el.custom.value)) : Number(el.len.value);
    if (!(len >= 1 && len <= 366)) return fail(t('err.invalid'));
    if (!D.isDate(el.start.value)) return fail(t('err.required'));
    const record = store.put('challenges', {
      ...(c ? { id: c.id } : { checkins: [], stopped: false }),
      title, icon: el.icon.value || '🔥', color: el.color.value || 'indigo', days: len,
      start_date: el.start.value, goal: el.goal.value.trim(),
    });
    m.close();
    if (!c) openChallenge(record.id);
  });
}

export function bindChallengeActions(scope) {
  on(scope, 'click', '[data-checkin]', (e, b) => {
    if (toggleCheckin(b.dataset.checkin)) { confettiFrom(b, 120); toast(t('ch.congrats'), { tone: 'success' }); }
  });
  on(scope, 'click', '[data-open-ch]', (e, b) => openChallenge(b.dataset.openCh));
}

// ------------------------------------------------------------------ page

function view() {
  const list = store.all('challenges');
  if (!list.length) {
    return html`<section class="card">${emptyState('flame', t('ch.empty'), html`<button class="btn btn-primary" data-new-ch>${icon('plus', 18)}${t('ch.new')}</button>`)}</section>`;
  }
  const isActive = (c) => ['active', 'planned'].includes(challengeStatus(c));
  const shown = list
    .filter((c) => (ui.filter === 'active' ? isActive(c) : ui.filter === 'done' ? !isActive(c) : true))
    .sort((a, b) => (isActive(b) - isActive(a)) || b.start_date.localeCompare(a.start_date));
  const active = list.filter((c) => challengeStatus(c) === 'active');
  const doneToday = active.filter((c) => (c.checkins || []).includes(D.today())).length;
  return html`
    <section class="stats">
      <div class="card stat"><span class="stat-value">${active.length}</span><span class="stat-label">${t('ch.filter.active')}</span></div>
      <div class="card stat"><span class="stat-value">${doneToday}/${active.length}</span><span class="stat-label">${t('ch.checked')}</span></div>
      <div class="card stat"><span class="stat-value">${list.filter((c) => challengeStatus(c) === 'done').length}</span><span class="stat-label">${t('ch.st.done')}</span></div>
      <div class="card stat"><span class="stat-value">${Math.max(0, ...list.map((c) => streaks(c).best))}</span><span class="stat-label">${t('ch.best')}</span></div>
    </section>
    <div class="toolbar"><div class="chips chips-scroll">
      ${[['active', t('ch.filter.active')], ['done', t('ch.filter.done')], ['all', t('common.all')]].map(([k, label]) => html`<button type="button" class="chip-btn ${ui.filter === k ? 'active' : ''}" data-ch-filter="${k}">${label}</button>`)}
    </div></div>
    ${shown.length ? html`<div class="ch-grid">${shown.map(challengeCard)}</div>` : html`<section class="card">${emptyState('search', t('common.nothingFound'))}</section>`}`;
}

function paint() {
  if (root) setHTML($('[data-region]', root), view());
}

export default {
  id: 'challenges',
  deps: ['challenges'],
  title: () => t('nav.challenges'),
  mount(el, params) {
    root = el;
    setHTML(el, html`
      <header class="page-head"><h1>${t('nav.challenges')}</h1>
        <div class="page-actions"><button type="button" class="btn btn-primary hide-mobile" data-new-ch>${icon('plus', 18)}${t('ch.new')}</button></div></header>
      <div data-region></div>`);
    paint();
    bindChallengeActions(el);
    on(el, 'click', '[data-new-ch]', () => openChallengeSheet());
    on(el, 'click', '[data-ch-filter]', (e, b) => { ui.filter = b.dataset.chFilter; paint(); });
    if (params && params[0] && store.get('challenges', params[0])) openChallenge(params[0]);
  },
  update() { paint(); },
  unmount() { root = null; },
  fab() { openChallengeSheet(); },
};
